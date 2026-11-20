import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "@openmill/core";
import {
  getJob,
  insertJob,
  insertRun,
  latestRun,
  openDb,
  updateJob,
  updateRun,
  type Db,
} from "@openmill/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claudeAgent } from "./agent/claude.ts";
import type { Agent } from "./agent/types.ts";
import { branchState } from "./git.ts";
import type { GitHub } from "./github.ts";
import type { Host } from "./host/types.ts";
import { Mill } from "./mill.ts";
import { jobDir, resolvePaths, type Paths } from "./paths.ts";
import type { Terminal, TerminalBlock } from "./terminal/types.ts";

vi.mock("./notifier/index.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./notifier/index.ts")>()),
  createNotify: () => () => {},
}));

vi.mock("./git.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./git.ts")>()),
  branchState: vi.fn<(typeof import("./git.ts"))["branchState"]>(),
}));

let home: string;
let db: Db;
let paths: Paths;

const repo = "/src/app";

function terminal(blocks: TerminalBlock[] | Error): Terminal {
  return {
    ready: vi.fn<Terminal["ready"]>(async () => ({ ok: true })),
    spawn: vi.fn<Terminal["spawn"]>(),
    close: vi.fn<Terminal["close"]>(async () => {}),
    list: vi.fn<Terminal["list"]>(async () => {
      if (blocks instanceof Error) {
        throw blocks;
      }

      return blocks;
    }),
    focus: vi.fn<Terminal["focus"]>(),
    capture: vi.fn<Terminal["capture"]>(async (blockId) => `screen of ${blockId}`),
  };
}

function github(drafts: Record<string, string> = {}): GitHub {
  return {
    findOpenDraft: async (_repo, branch) => drafts[branch],
    graphql: vi.fn<GitHub["graphql"]>(),
    graphqlResetAt: vi.fn<GitHub["graphqlResetAt"]>(),
    editPrBase: vi.fn<GitHub["editPrBase"]>(),
    token: vi.fn<GitHub["token"]>().mockRejectedValue(new Error("no token in tests")),
  };
}

function job(id: string, state: string, blockId: string | null, terminalName?: string): number {
  const row = insertJob(db, {
    id,
    repoPath: repo,
    docPath: `/docs/${id}.md`,
    docSnapshot: "",
    branchName: `openmill/${id}`,
    worktreePath: `/wt/${id}`,
    state,
    terminal: terminalName,
    sessionId: `session-${id}`,
  });

  insertRun(db, {
    jobKey: row.key,
    agent: "claude",
    effort: "medium",
    sessionId: `session-${id}`,
    blockId,
  });

  return row.key;
}

function editTurn(id: string, blockId: string): number {
  const key = job(id, "running", blockId);

  updateJob(db, key, { prUrl: "https://github.com/o/r/pull/1" });
  updateRun(db, latestRun(db, key)?.id as number, {
    endedAt: new Date(),
    result: { status: "done" },
  });

  return key;
}

function mill(term: Terminal, gh = github(), herdr = terminal([])): Mill {
  return new Mill({
    db,
    paths,
    config: DEFAULT_CONFIG,
    notifiers: [],
    terminals: { rex: term, herdr, tmux: terminal([]) },
    host: {} as Host,
    agents: { claude: claudeAgent, codex: {} as Agent },
    github: gh,
    hookCommand: ["openmill"],
  });
}

async function reconcile(term: Terminal, gh = github(), herdr = terminal([])): Promise<void> {
  const instance = mill(term, gh, herdr);

  await instance.reconcile();
  await instance.close();
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "openmill-mill-"));
  db = openDb(":memory:");
  vi.stubEnv("OPENMILL_HOME", home);
  paths = resolvePaths();
});

afterEach(() => {
  vi.unstubAllEnvs();
  db.$client.close();
  rmSync(home, { recursive: true, force: true });
});

describe("startup reconciliation", () => {
  it("leaves running and waiting jobs with live windows alone", async () => {
    const running = job("login", "running", "block:a");
    const waiting = job("signup", "needs_input", "block:b");
    const term = terminal([
      { blockId: "block:a", label: "login", alive: true },
      { blockId: "block:b", label: "signup", alive: true },
    ]);

    await reconcile(term);

    expect(getJob(db, running)?.state).toBe("running");
    expect(getJob(db, waiting)?.state).toBe("needs_input");
    expect(term.close).not.toHaveBeenCalled();
  });

  it("finishes a job whose Stop fired while the server was down", async () => {
    const key = job("login", "running", "block:a");

    await reconcile(
      terminal([{ blockId: "block:a", label: "login", alive: true }]),
      github({ "openmill/login": "https://github.com/o/r/pull/1" }),
    );

    expect(getJob(db, key)).toMatchObject({
      state: "done",
      prUrl: "https://github.com/o/r/pull/1",
    });
  });

  it("fails a running job whose window is gone or whose agent exited", async () => {
    const gone = job("login", "running", "block:a");
    const exited = job("signup", "running", "block:b");

    await reconcile(terminal([{ blockId: "block:b", label: "signup", alive: false }]));

    expect(getJob(db, gone)?.state).toBe("failed");
    expect(getJob(db, exited)?.state).toBe("failed");
    expect(latestRun(db, exited)?.result?.reason).toMatch(/window closed/);
    expect(latestRun(db, exited)?.endedAt).toBeInstanceOf(Date);

    const capture = join(jobDir(paths, repo, "signup"), "runs", `${latestRun(db, exited)?.id}.txt`);

    expect(readFileSync(capture, "utf8")).toBe("screen of block:b");
  });

  it("fails only the jobs whose terminal can't be reached", async () => {
    const key = job("login", "running", "block:a");
    const done = job("signup", "done", "block:b");
    const herdrJob = job("search", "running", "w1:p2", "herdr");

    await reconcile(
      terminal(new Error("rex not found")),
      github(),
      terminal([{ blockId: "w1:p2", label: "search", alive: true }]),
    );

    expect(getJob(db, key)?.state).toBe("failed");
    expect(latestRun(db, key)?.result?.reason).toBe("rex not found");
    expect(getJob(db, done)?.state).toBe("done");
    expect(getJob(db, herdrJob)?.state).toBe("running");
  });

  describe("edit turns", () => {
    it("finishes as done when the branch is clean and pushed", async () => {
      const key = editTurn("login", "block:a");

      vi.mocked(branchState).mockResolvedValue({ progressed: true, unpushed: false, dirty: false });
      await reconcile(terminal([{ blockId: "block:a", label: "login", alive: true }]));

      expect(getJob(db, key)).toMatchObject({ state: "done", blockedReason: null });
    });

    it("moves to needs_input instead of failed when unpushed work outlives its window", async () => {
      const key = editTurn("login", "block:a");

      vi.mocked(branchState).mockResolvedValue({ progressed: true, unpushed: true, dirty: false });
      await reconcile(terminal([]));

      expect(getJob(db, key)).toMatchObject({
        state: "needs_input",
        blockedReason: "the session ended with uncommitted or unpushed edits",
      });
      expect(latestRun(db, key)?.result).toEqual({ status: "done" });
    });
  });
});

describe("hooks from T3 Code threads", () => {
  it("map to the latest run in the thread when there's no run id, and ignore unknown threads", async () => {
    const key = job("login", "running", "mcp:thread-1", "t3code");
    const instance = mill(terminal([]));
    const payload = { session_id: "s1", transcript_path: "/t/login.jsonl", prompt: "go" };

    await expect(
      instance.hook({ threadId: "mcp:unknown" }, "UserPromptSubmit", payload),
    ).resolves.toBeNull();
    expect(latestRun(db, key)?.transcriptPath).toBeNull();

    await instance.hook({ threadId: "mcp:thread-1" }, "UserPromptSubmit", payload);
    await instance.close();

    expect(latestRun(db, key)?.transcriptPath).toBe("/t/login.jsonl");
  });
});

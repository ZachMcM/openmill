import { DEFAULT_CONFIG } from "@openmill/core";
import { insertJob, openDb, type Db } from "@openmill/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHub } from "./github.ts";
import { PrWatcher } from "./watcher.ts";

let db: Db;
let github: GitHub;
let watcher: PrWatcher;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function pull(sha: string): Response {
  return Response.json({ head: { sha }, mergeable: true }, { headers: { etag: `"${sha}"` } });
}

function respond(...responses: Response[]): void {
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }

  fetchMock.mockImplementation(async () => new Response(null, { status: 304 }));
}

beforeEach(() => {
  vi.useFakeTimers();
  db = openDb(":memory:");
  insertJob(db, {
    id: "login",
    repoPath: "/src/app",
    docPath: "/docs/login.md",
    docSnapshot: "",
    branchName: "openmill/login",
    worktreePath: "/wt/login",
    state: "done",
    prUrl: "https://github.com/o/r/pull/1",
  });
  github = {
    findOpenDraft: vi.fn<GitHub["findOpenDraft"]>(),
    graphql: vi.fn<GitHub["graphql"]>().mockRejectedValue(new Error("stubbed")),
    graphqlResetAt: vi.fn<GitHub["graphqlResetAt"]>(),
    editPrBase: vi.fn<GitHub["editPrBase"]>(),
    token: vi.fn<GitHub["token"]>().mockResolvedValue("secret"),
  };
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  watcher = new PrWatcher({
    db,
    github,
    config: () => DEFAULT_CONFIG,
    onChange: () => {},
    onMergeable: () => {},
    log: () => {},
    debug: () => {},
  });
});

afterEach(async () => {
  await watcher.close();
  db.$client.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function start(): Promise<void> {
  watcher.wake();
  await vi.advanceTimersByTimeAsync(0);
}

describe("PR fast lane", () => {
  it("makes no GraphQL call on a 304", async () => {
    respond(new Response(null, { status: 304 }));
    await start();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(github.graphql).not.toHaveBeenCalled();
  });

  it("fetches the PR once on a 200", async () => {
    respond(pull("a"));
    await start();

    expect(github.graphql).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/o/r/pulls/1");
  });

  it("joins 200s within 2 seconds into one immediate and one trailing fetch", async () => {
    respond(pull("a"), pull("b"));
    await start();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(github.graphql).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(github.graphql).toHaveBeenCalledTimes(2);
  });

  it("stops requests until Retry-After on a 429", async () => {
    respond(new Response(null, { status: 429, headers: { "retry-after": "30" } }));
    await start();
    await vi.advanceTimersByTimeAsync(29_000);

    expect(fetchMock).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reads the token again after a 401", async () => {
    respond(new Response(null, { status: 401 }));
    await start();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(github.token).toHaveBeenCalledTimes(2);
  });
});

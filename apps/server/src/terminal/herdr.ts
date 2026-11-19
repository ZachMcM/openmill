import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { TERMINAL_CHECKS } from "@openmill/core";
import { runChecks, shellQuote } from "../agent/shared.ts";
import { exec } from "../exec.ts";
import type { Terminal, TerminalBlock } from "./types.ts";

const WORKSPACE_LABEL = "openmill";
const CAPTURE_LINES = "1000";

interface Pane {
  pane_id: string;
  tab_id: string;
}

interface Workspace {
  workspace_id: string;
  label: string;
}

interface WorkspaceCreated {
  workspace: Workspace;
  tab: { tab_id: string };
  root_pane: Pane;
}

export function parseBlocks(tabList: unknown, paneList: unknown): Omit<TerminalBlock, "alive">[] {
  const { tabs } = tabList as { tabs: Array<{ tab_id: string; label: string }> };
  const { panes } = paneList as { panes: Pane[] };
  const labels = new Map(tabs.map((tab) => [tab.tab_id, tab.label]));

  return panes.map((pane) => ({ blockId: pane.pane_id, label: labels.get(pane.tab_id) ?? "" }));
}

// A pane keeps its shell after the command exits, so the command is alive while the shell isn't
// the foreground process.
export function paneAlive(processInfo: unknown): boolean {
  const { process_info: info } = processInfo as {
    process_info: { foreground_process_group_id: number; shell_pid: number };
  };

  return info.foreground_process_group_id !== info.shell_pid;
}

// A server auto-started inside a herdr pane would otherwise talk to that pane's herdr session.
function herdrEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("HERDR_")),
  );
}

async function herdr(args: string[]): Promise<string> {
  try {
    return await exec("herdr", args, homedir(), herdrEnv());
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") {
      throw new Error("herdr not found", { cause: error });
    }

    throw error;
  }
}

async function herdrJson<T>(args: string[]): Promise<T> {
  return (JSON.parse(await herdr(args)) as { result: T }).result;
}

// herdr reads a pane's command as typed input, so a long or multi-line command goes through a
// script that deletes itself.
async function launchScript(command: string[], env: Record<string, string>): Promise<string> {
  const path = join(tmpdir(), `openmill-${randomUUID()}.sh`);
  const argv = [
    "env",
    ...Object.entries(env).map(([name, value]) => `${name}=${value}`),
    ...command,
  ];

  await writeFile(path, `rm -f -- "$0"\nexec ${argv.map(shellQuote).join(" ")}\n`, { mode: 0o600 });

  return path;
}

export function createHerdrTerminal(workspaceFile: string): Terminal {
  let spawning: Promise<unknown> = Promise.resolve();

  async function findWorkspace(): Promise<string | undefined> {
    const { workspaces } = await herdrJson<{ workspaces: Workspace[] }>(["workspace", "list"]);
    const stored = (await readFile(workspaceFile, "utf8").catch(() => "")).trim();
    const found =
      workspaces.find((workspace) => workspace.workspace_id === stored) ??
      workspaces.find((workspace) => workspace.label === WORKSPACE_LABEL);

    if (found && found.workspace_id !== stored) {
      await writeFile(workspaceFile, found.workspace_id);
    }

    return found?.workspace_id;
  }

  async function openPane(label: string, cwd: string, replace?: string): Promise<Pane> {
    const workspace = await findWorkspace();

    if (workspace && replace) {
      const split = await herdrJson<{ pane: Pane }>([
        "pane",
        "split",
        replace,
        "--direction",
        "right",
        "--cwd",
        cwd,
        "--no-focus",
      ]).catch(() => undefined);

      if (split) {
        await herdr(["pane", "close", replace]).catch(() => {});

        return split.pane;
      }
    }

    if (workspace) {
      const created = await herdrJson<{ root_pane: Pane }>([
        "tab",
        "create",
        "--workspace",
        workspace,
        "--cwd",
        cwd,
        "--label",
        label,
        "--no-focus",
      ]);

      return created.root_pane;
    }

    const created = await herdrJson<WorkspaceCreated>([
      "workspace",
      "create",
      "--cwd",
      cwd,
      "--label",
      WORKSPACE_LABEL,
      "--no-focus",
    ]);

    await writeFile(workspaceFile, created.workspace.workspace_id);
    await herdr(["tab", "rename", created.tab.tab_id, label]);

    return created.root_pane;
  }

  return {
    ready() {
      return runChecks(TERMINAL_CHECKS.herdr);
    },

    spawn({ label, cwd, command, env, replace }) {
      // Spawns run one at a time so two jobs can't both create the openmill workspace.
      const next = spawning
        .catch(() => {})
        .then(async () => {
          const pane = await openPane(label, cwd, replace);

          await herdr([
            "pane",
            "run",
            pane.pane_id,
            `sh ${shellQuote(await launchScript(command, env))}`,
          ]);

          return pane.pane_id;
        });

      spawning = next;

      return next;
    },

    async close(blockId) {
      await herdr(["pane", "close", blockId]);
    },

    async list() {
      const workspace = await findWorkspace();

      if (!workspace) {
        return [];
      }

      const [tabs, panes] = await Promise.all([
        herdrJson(["tab", "list", "--workspace", workspace]),
        herdrJson(["pane", "list", "--workspace", workspace]),
      ]);

      return Promise.all(
        parseBlocks(tabs, panes).map(async (block): Promise<TerminalBlock> => ({
          ...block,
          alive: await herdrJson(["pane", "process-info", "--pane", block.blockId]).then(
            paneAlive,
            () => false,
          ),
        })),
      );
    },

    async focus(blockId) {
      const { pane } = await herdrJson<{ pane: Pane }>(["pane", "get", blockId]);

      await herdr(["tab", "focus", pane.tab_id]);
    },

    async capture(blockId) {
      return herdr([
        "pane",
        "read",
        blockId,
        "--source",
        "recent-unwrapped",
        "--lines",
        CAPTURE_LINES,
      ]);
    },
  };
}

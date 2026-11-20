import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { TERMINAL_CHECKS } from "@openmill/core";
import { runChecks } from "../agent/shared.ts";
import { exec } from "../exec.ts";
import type { Terminal, TerminalBlock } from "./types.ts";

const SESSION_NAME = "openmill";
const CAPTURE_START = "-1000";
const ATTACH_HINT = `no tmux client attached; run "tmux attach -t ${SESSION_NAME}"`;

function rows(output: string): string[][] {
  return output
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.split("\t"));
}

export function parsePanes(output: string): TerminalBlock[] {
  return rows(output).map(([blockId = "", label = "", dead]) => ({
    blockId,
    label,
    alive: dead === "0",
  }));
}

// A server auto-started inside a tmux pane would otherwise target that pane's client and session.
function tmuxEnv(): NodeJS.ProcessEnv {
  const { TMUX: _tmux, TMUX_PANE: _pane, ...env } = process.env;

  return env;
}

async function tmux(args: string[]): Promise<string> {
  try {
    return await exec("tmux", args, homedir(), tmuxEnv());
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") {
      throw new Error("tmux not found", { cause: error });
    }

    throw error;
  }
}

function launchArgs(cwd: string, command: string[], env: Record<string, string>): string[] {
  return [
    "-c",
    cwd,
    ...Object.entries(env).flatMap(([name, value]) => ["-e", `${name}=${value}`]),
    "--",
    ...command,
  ];
}

// Chained in the same invocation so a command that exits at once can't take its window with it.
function remainOnExit(target: string): string[] {
  return [";", "set-option", "-w", "-t", target, "remain-on-exit", "on"];
}

export function createTmuxTerminal(sessionFile: string): Terminal {
  let spawning: Promise<unknown> = Promise.resolve();

  async function findSession(): Promise<string | undefined> {
    const sessions = await tmux(["list-sessions", "-F", "#{session_id}\t#{session_name}"]).then(
      rows,
      () => [],
    );
    const stored = (await readFile(sessionFile, "utf8").catch(() => "")).trim();
    const found =
      sessions.find(([id]) => id === stored) ?? sessions.find(([, name]) => name === SESSION_NAME);
    const id = found?.[0];

    if (id && id !== stored) {
      await writeFile(sessionFile, id);
    }

    return id;
  }

  async function openWindow(
    label: string,
    cwd: string,
    command: string[],
    env: Record<string, string>,
  ): Promise<string> {
    const session = await findSession();
    const launch = launchArgs(cwd, command, env);

    if (session) {
      // A chained command without -t targets the session's current window, so the new window goes
      // last, where {end} finds it.
      const last = `${session}:{end}`;
      const output = await tmux([
        "new-window",
        "-d",
        "-a",
        "-t",
        last,
        "-n",
        label,
        "-P",
        "-F",
        "#{pane_id}",
        ...launch,
        ...remainOnExit(last),
      ]);

      return output.trim();
    }

    const output = await tmux([
      "new-session",
      "-d",
      "-s",
      SESSION_NAME,
      "-n",
      label,
      "-P",
      "-F",
      "#{session_id}\t#{pane_id}",
      ...launch,
      ...remainOnExit(`=${SESSION_NAME}:`),
    ]);
    const [sessionId = "", paneId = ""] = output.trim().split("\t");

    await writeFile(sessionFile, sessionId);

    return paneId;
  }

  return {
    ready() {
      return runChecks(TERMINAL_CHECKS.tmux);
    },

    spawn({ label, cwd, command, env, replace }) {
      // Spawns run one at a time so two jobs can't both create the openmill session.
      const next = spawning
        .catch(() => {})
        .then(async () => {
          if (replace) {
            const respawned = await tmux([
              "respawn-pane",
              "-k",
              "-t",
              replace,
              ...launchArgs(cwd, command, env),
            ]).then(
              () => true,
              () => false,
            );

            if (respawned) {
              return replace;
            }
          }

          return openWindow(label, cwd, command, env);
        });

      spawning = next;

      return next;
    },

    async close(blockId) {
      await tmux(["kill-pane", "-t", blockId]);
    },

    async list() {
      const session = await findSession();

      if (!session) {
        return [];
      }

      return parsePanes(
        await tmux([
          "list-panes",
          "-s",
          "-t",
          session,
          "-F",
          "#{pane_id}\t#{window_name}\t#{pane_dead}",
        ]),
      );
    },

    async focus(blockId) {
      await tmux(["select-window", "-t", blockId]);
      await tmux(["select-pane", "-t", blockId]);

      const clients = rows(
        await tmux(["list-clients", "-F", "#{client_activity}\t#{client_name}"]),
      ).sort(([a], [b]) => Number(b) - Number(a));
      const client = clients[0]?.[1];

      if (!client) {
        throw new Error(ATTACH_HINT);
      }

      await tmux(["switch-client", "-c", client, "-t", blockId]);
    },

    async capture(blockId) {
      return tmux(["capture-pane", "-p", "-J", "-S", CAPTURE_START, "-t", blockId]);
    },
  };
}

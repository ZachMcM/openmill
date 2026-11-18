import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { exec } from "../exec.ts";
import type { Terminal, TerminalBlock } from "./types.ts";

const SESSION_LABEL = "openmill";

interface SessionList {
  sessions: Array<{ session_id: string; label: string }>;
}

interface WindowList {
  windows: Array<{ label: string; layers: Array<{ blocks: Array<{ block_id: string }> }> }>;
}

interface Created {
  session_id?: string;
  block_ids?: string[];
  initial_windows?: Array<{ block_ids: string[] }>;
}

// The server may have been auto-started from inside a Rex pane, and its agents belong in the
// default local Rex server, not in whatever session that pane was in.
function rexEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("REX_")),
  );
}

async function rex(args: string[]): Promise<string> {
  try {
    return await exec("rex", args, homedir(), rexEnv());
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") {
      throw new Error("rex not found", { cause: error });
    }

    throw error;
  }
}

async function rexJson<T>(args: string[]): Promise<T> {
  return JSON.parse(await rex([...args, "--json"])) as T;
}

function firstBlock(created: Created): string {
  const block = created.block_ids?.[0] ?? created.initial_windows?.[0]?.block_ids[0];

  if (!block) {
    throw new Error("rex didn't return a block id");
  }

  return block;
}

// Claude sessions in Rex may rename the session they run in, so the session is remembered by id.
export function createRexTerminal(sessionFile: string): Terminal {
  let spawning: Promise<unknown> = Promise.resolve();

  async function findSession(): Promise<string | undefined> {
    const { sessions } = await rexJson<SessionList>(["ls"]);
    const stored = (await readFile(sessionFile, "utf8").catch(() => "")).trim();
    const found =
      sessions.find((session) => session.session_id === stored) ??
      sessions.find((session) => session.label === SESSION_LABEL);

    if (found && found.session_id !== stored) {
      await writeFile(sessionFile, found.session_id);
    }

    return found?.session_id;
  }

  async function requireSession(): Promise<string> {
    const session = await findSession();

    if (!session) {
      throw new Error(`the ${SESSION_LABEL} rex session is gone`);
    }

    return session;
  }

  return {
    spawn({ label, cwd, command, env }) {
      const argv = [
        "-c",
        cwd,
        "--keep-open",
        "--json",
        "--",
        "env",
        ...Object.entries(env).map(([name, value]) => `${name}=${value}`),
        ...command,
      ];

      // Spawns run one at a time so two jobs can't both create the openmill session.
      const next = spawning
        .catch(() => {})
        .then(async () => {
          const session = await findSession();
          const prefix = session
            ? ["window", "new", "-s", session, label, "--focus=false"]
            : ["new", SESSION_LABEL, "--window", label];
          const created = JSON.parse(await rex([...prefix, ...argv])) as Created;

          if (!session && created.session_id) {
            await writeFile(sessionFile, created.session_id);
          }

          return firstBlock(created);
        });

      spawning = next;

      return next;
    },

    async close(blockId) {
      await rex(["block", "close", "-s", await requireSession(), blockId]);
    },

    async list() {
      const session = await findSession();

      if (!session) {
        return [];
      }

      const { windows } = await rexJson<WindowList>(["window", "ls", "-s", session]);
      const blocks = windows.flatMap((window) =>
        window.layers.flatMap((layer) =>
          layer.blocks.map((block) => ({ blockId: block.block_id, label: window.label })),
        ),
      );

      return Promise.all(
        blocks.map(async (block): Promise<TerminalBlock> => {
          const alive = await rex(["block", "call", "-s", session, "-b", block.blockId, "process"])
            .then((stdout) => {
              const { last_exit: lastExit } = JSON.parse(stdout) as { last_exit?: unknown };

              return lastExit === null || lastExit === undefined;
            })
            .catch(() => false);

          return { ...block, alive };
        }),
      );
    },

    async focus(blockId) {
      await rex(["focus", "-s", await requireSession(), blockId]);
    },

    async capture(blockId) {
      return rex(["capture", "-s", await requireSession(), "-b", blockId, "--trim", "--unwrap"]);
    },
  };
}

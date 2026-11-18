import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import type { Server } from "node:net";
import { createAdaptorServer } from "@hono/node-server";
import { openDb } from "@openmill/db";
import { createApp } from "./app.ts";
import { readConfig } from "./config-store.ts";
import { ghCli } from "./github.ts";
import { claudeHarness } from "./harness/claude.ts";
import { Mill } from "./mill.ts";
import { resolvePaths } from "./paths.ts";

export interface ServerOptions {
  version: string;
  log?: (message: string) => void;
}

export interface RunningServer {
  closed: Promise<void>;
  close(): Promise<void>;
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const paths = resolvePaths();

  await mkdir(paths.home, { recursive: true, mode: 0o700 });
  acquireLock(paths.pid);

  let db: ReturnType<typeof openDb>;
  let mill: Mill;

  try {
    db = openDb(paths.db);
    mill = new Mill({
      db,
      paths,
      config: await readConfig(paths.config),
      harnesses: { claude: claudeHarness },
      github: ghCli,
      log: options.log,
      debug: process.env.OPENMILL_DEBUG ? options.log : undefined,
    });
  } catch (error) {
    rmSync(paths.pid, { force: true });
    throw error;
  }

  let closing: Promise<void> | undefined;
  const closed = Promise.withResolvers<void>();

  function close(): Promise<void> {
    closing ??= (async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await mill.close();
      db.$client.close();
      rmSync(paths.pid, { force: true });
      closed.resolve();
    })();

    return closing;
  }

  const server = createAdaptorServer({
    fetch: createApp(mill, { version: options.version, onShutdown: () => void close() }).fetch,
  }) as Server;

  await listen(server, paths.socket);
  mill.recover();

  return { closed: closed.promise, close };
}

async function listen(server: Server, socket: string): Promise<void> {
  if (process.platform !== "win32") {
    // The pid lock is held, so any socket file left behind belongs to a dead server.
    rmSync(socket, { force: true });
  }

  const umask = process.umask(0o177);

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socket, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } finally {
    process.umask(umask);
  }

  if (process.platform !== "win32") {
    await chmod(socket, 0o600);
  }
}

function acquireLock(path: string): void {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, "wx", 0o600);

      writeSync(fd, String(process.pid));
      closeSync(fd);

      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      const pid = Number(readFileSync(path, "utf8").trim());

      if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) {
        throw new Error(`an openmill server is already running (pid ${pid})`, { cause: error });
      }

      rmSync(path, { force: true });
    }
  }

  throw new Error(`could not take the server lock at ${path}`);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

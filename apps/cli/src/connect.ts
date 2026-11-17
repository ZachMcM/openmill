import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { resolvePaths } from "@openmill/server";
import { createClient, type Client } from "@openmill/server/client";
import pkg from "../package.json" with { type: "json" };
import { command, spin, warn } from "./ui.ts";

const TIMEOUT_MS = 10_000;

type Status = Awaited<ReturnType<Awaited<ReturnType<Client["status"]["$get"]>>["json"]>>;

export async function serverStatus(client: Client): Promise<Partial<Status> | undefined> {
  try {
    const res = await client.status.$get();

    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}

export async function isRunning(client: Client): Promise<boolean> {
  return (await serverStatus(client)) !== undefined;
}

async function waitFor(condition: () => Promise<boolean>, isDone = () => false): Promise<boolean> {
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline && !isDone()) {
    if (await condition()) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return false;
}

export async function stopServer(client: Client): Promise<void> {
  await client.shutdown.$post();

  if (!(await waitFor(async () => !(await isRunning(client))))) {
    throw new Error("the openmill server didn't stop");
  }
}

export function localClient(): Client {
  return createClient(resolvePaths().socket);
}

export async function connect(): Promise<Client> {
  const client = localClient();
  const status = await serverStatus(client);

  if (status) {
    if (status.version === pkg.version) {
      return client;
    }

    if ((status.running ?? 0) > 0) {
      warn(
        `the server is running openmill ${status.version ?? "(unknown)"}, not ${pkg.version}. ` +
          `Run ${command("openmill server stop")} once its jobs finish.`,
      );

      return client;
    }

    await spin("restarting the openmill server", () => stopServer(client));
  }

  return spin("starting the openmill server", () => start(client));
}

async function start(client: Client): Promise<Client> {
  const paths = resolvePaths();

  mkdirSync(paths.home, { recursive: true, mode: 0o700 });

  const log = openSync(paths.log, "a");
  const child = spawn(
    process.execPath,
    [...process.execArgv, process.argv[1] as string, "server", "run"],
    {
      detached: true,
      stdio: ["ignore", log, log],
      windowsHide: true,
    },
  );

  child.unref();

  if (
    await waitFor(
      () => isRunning(client),
      () => child.exitCode !== null,
    )
  ) {
    return client;
  }

  throw new Error(`the openmill server didn't start; see ${paths.log}`);
}

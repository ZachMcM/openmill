import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { resolvePaths } from "@openmill/server";
import { createClient, type Client } from "@openmill/server/client";

const START_TIMEOUT_MS = 10_000;

export async function isRunning(client: Client): Promise<boolean> {
  try {
    return (await client.status.$get()).ok;
  } catch {
    return false;
  }
}

export function localClient(): Client {
  return createClient(resolvePaths().socket);
}

export async function connect(): Promise<Client> {
  const paths = resolvePaths();
  const client = localClient();

  if (await isRunning(client)) {
    return client;
  }

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

  const deadline = Date.now() + START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await isRunning(client)) {
      return client;
    }

    if (child.exitCode !== null) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`the openmill server didn't start; see ${paths.log}`);
}

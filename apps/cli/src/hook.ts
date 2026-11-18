import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { resolvePaths } from "@openmill/server";
import { connect } from "./connect.ts";
import { unwrap } from "./output.ts";

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

export async function hook(event: string, input: string): Promise<void> {
  try {
    const runId = Number(process.env.OPENMILL_RUN_ID);

    if (!Number.isInteger(runId) || runId <= 0) {
      throw new Error("OPENMILL_RUN_ID isn't set");
    }

    const payload: unknown = JSON.parse(input);
    const client = await connect();
    const { output } = await unwrap(
      client.hooks[":event"].$post({ param: { event }, json: { runId, payload } }),
    );

    if (output !== null && output !== undefined) {
      process.stdout.write(`${JSON.stringify(output)}\n`);
    }
  } catch (error) {
    const { home } = resolvePaths();
    const line = `${new Date().toISOString()} ${event}: ${(error as Error).message ?? String(error)}\n`;

    await mkdir(home, { recursive: true, mode: 0o700 })
      .then(() => appendFile(join(home, "hook.log"), line))
      .catch(() => {});
  }
}

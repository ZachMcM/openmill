import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { resolvePaths } from "@openmill/server";
import { connect, isRunning, localClient } from "./connect.ts";
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
    const payload: unknown = JSON.parse(input);
    const runId = Number(process.env.OPENMILL_RUN_ID);
    const threadId = process.env.T3CODE_THREAD_ID;
    let request;

    if (Number.isInteger(runId) && runId > 0) {
      request = (await connect()).hooks[":event"].$post({
        param: { event },
        json: { runId, payload },
      });
    } else {
      // Every T3 thread runs these hooks, including the ones people start by hand, so only a run
      // openmill started may start the server.
      const client = localClient();

      if (!threadId || !(await isRunning(client))) {
        return;
      }

      request = client.hooks[":event"].$post({ param: { event }, json: { threadId, payload } });
    }

    const { output } = await unwrap(request);

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

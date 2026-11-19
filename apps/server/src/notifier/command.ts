import { exec } from "node:child_process";
import type { Notifier } from "./types.ts";

const TIMEOUT_MS = 10_000;

export function createCommand(command: string): Notifier {
  return {
    send: (payload) =>
      new Promise((resolve, reject) => {
        const child = exec(command, { timeout: TIMEOUT_MS }, (error) => {
          if (!error) {
            resolve();
          } else {
            reject(error.killed ? new Error(`timed out after ${TIMEOUT_MS / 1000}s`) : error);
          }
        });

        // A command that exits without reading stdin makes the write fail with EPIPE.
        child.stdin?.on("error", () => {});
        child.stdin?.end(JSON.stringify(payload));
      }),
  };
}

import type { JobState } from "@openmill/core";
import ora from "ora";
import pc from "picocolors";

const STATE_COLORS: Record<JobState, (text: string) => string> = {
  queued: pc.blue,
  running: pc.cyan,
  needs_input: pc.yellow,
  awaiting_push: pc.magenta,
  done: pc.green,
  failed: pc.red,
  blocked: pc.yellow,
  cancelled: pc.dim,
  merged: pc.greenBright,
  closed: pc.dim,
};

export function state(value: string): string {
  return (STATE_COLORS[value as JobState] ?? pc.reset)(value);
}

export function warn(message: string): void {
  console.error(`${pc.yellow("warning:")} ${message}`);
}

export function fail(message: string): void {
  console.error(`${pc.red("error:")} ${message}`);
}

export async function spin<T>(text: string, task: () => Promise<T>): Promise<T> {
  const spinner = ora({ text, stream: process.stderr, isSilent: !process.stderr.isTTY }).start();

  try {
    return await task();
  } finally {
    spinner.stop();
  }
}

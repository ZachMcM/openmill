import * as p from "@clack/prompts";
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

export function jobState(job: { state: string; waitingSince: number | null }): string {
  if (job.waitingSince === null) {
    return state(job.state);
  }

  return `${state(job.state)}, ${pc.yellow(`waiting for permission (${age(job.waitingSince)})`)}`;
}

export function age(since: number): string {
  const minutes = Math.floor((Date.now() - since) / 60_000);
  const hours = Math.floor(minutes / 60);

  if (minutes < 60) {
    return `${minutes}m`;
  }

  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
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

export class Cancelled extends Error {}

export function answer<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    throw new Cancelled();
  }

  return value as Exclude<T, symbol>;
}

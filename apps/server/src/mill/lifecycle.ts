import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SESSION_STATES,
  canTransition,
  notificationFor,
  type JobState,
  type NotificationEvent,
} from "@openmill/core";
import {
  getJob,
  updateJob,
  updateRun,
  type Job,
  type NewJob,
  type Run,
  type RunResultRecord,
} from "@openmill/db";
import { notificationPayload } from "../notify.ts";
import { jobDir } from "../paths.ts";
import type { MillContext } from "./context.ts";

export const SESSION_OPEN_REASON =
  "someone is still using the previous session in the job's window; follow-ups start when it stops";

interface Transition {
  from?: readonly JobState[];
  to: JobState;
  fields?: Partial<NewJob>;
}

export function transition(
  ctx: MillContext,
  key: number,
  { from, to, fields = {} }: Transition,
): Job | undefined {
  const job = getJob(ctx.db, key);
  const state = job?.state as JobState | undefined;

  if (!job || !state || (from && !from.includes(state)) || !canTransition(state, to)) {
    return undefined;
  }

  updateJob(ctx.db, key, { ...fields, state: to });

  return job;
}

export function inSession(job: Job): boolean {
  return (
    SESSION_STATES.includes(job.state as JobState) &&
    !(job.state === "needs_input" && job.blockedReason !== null)
  );
}

export function finish(ctx: MillContext, key: number, prUrl: string): void {
  transition(ctx, key, { to: "done", fields: { prUrl, blockedReason: null } });
}

export async function fail(
  ctx: MillContext,
  key: number,
  run: Run | undefined,
  reason: string,
): Promise<void> {
  const job = getJob(ctx.db, key);

  if (!job || !SESSION_STATES.includes(job.state as JobState)) {
    return;
  }

  if (run) {
    await endRun(ctx, job, run, { status: "failed", reason });
  }

  const previous = transition(ctx, key, {
    from: SESSION_STATES,
    to: "failed",
    fields: { blockedReason: null },
  });

  if (previous) {
    notify(ctx, key, previous.state as JobState, "failed", reason);
  }
}

export function needsInput(ctx: MillContext, key: number, reason: string, exhausted = false): void {
  if (
    transition(ctx, key, { from: ["done"], to: "needs_input", fields: { blockedReason: reason } })
  ) {
    notify(ctx, key, "done", "needs_input", reason, exhausted);
  }
}

export function awaitPush(ctx: MillContext, key: number): void {
  if (transition(ctx, key, { from: ["running"], to: "awaiting_push" })) {
    notify(ctx, key, "running", "awaiting_push", null);
  }
}

export async function endRun(
  ctx: MillContext,
  job: Job,
  run: Run,
  result: RunResultRecord,
): Promise<void> {
  if (run.blockId) {
    try {
      await mkdir(join(jobDir(ctx.paths, job.repoPath, job.id), "runs"), { recursive: true });
      await writeFile(capturePath(ctx, job, run), await ctx.terminal.capture(run.blockId));
    } catch (error) {
      ctx.log(`saving the window of ${job.id} failed: ${String(error)}`);
    }
  }

  updateRun(ctx.db, run.id, { endedAt: run.endedAt ?? new Date(), result });
}

export async function closeWindow(ctx: MillContext, run: Run): Promise<void> {
  if (!run.blockId) {
    return;
  }

  await ctx.terminal
    .close(run.blockId)
    .catch((error: unknown) => ctx.log(`closing window ${run.blockId} failed: ${String(error)}`));
}

export async function findDraft(ctx: MillContext, job: Job): Promise<string | undefined> {
  return ctx.github.findOpenDraft(job.repoPath, job.branchName).catch((error: unknown) => {
    ctx.log(`gh pr list for ${job.id} failed: ${String(error)}`);

    return undefined;
  });
}

export function capturePath(ctx: MillContext, job: Job, run: Run): string {
  return join(jobDir(ctx.paths, job.repoPath, job.id), "runs", `${run.id}.txt`);
}

export function notify(
  ctx: MillContext,
  key: number,
  from: JobState,
  to: JobState,
  reason: string | null,
  exhausted = false,
): void {
  const event = notificationFor(from, to, exhausted);

  if (event) {
    send(ctx, event, key, reason);
  }
}

export function send(
  ctx: MillContext,
  event: NotificationEvent,
  key: number,
  reason: string | null,
): void {
  const job = getJob(ctx.db, key);

  if (!job) {
    return;
  }

  try {
    ctx.notifier(notificationPayload(event, job, reason), ctx.config);
  } catch (error) {
    ctx.log(`notification for ${job.id} failed: ${String(error)}`);
  }
}

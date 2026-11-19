import {
  SESSION_STATES,
  WATCHED_STATES,
  conflictReason,
  decideConflict,
  decideFollowup,
  prNotificationFor,
  stackedOn,
  pushModeFor,
  type FollowupDecision,
  type JobState,
  type PrEvent,
  type PrObservation,
  type PrState,
} from "@openmill/core";
import {
  getJob,
  getObservation,
  latestRun,
  listJobs,
  listRuns,
  updateJob,
  updateObservation,
  type Job,
  type NextRunRecord,
  type RestackRecord,
  type Run,
} from "@openmill/db";
import { fastForward, fetchBranch, git, removeWorktree, withRepoLock } from "../git.ts";
import type { MillContext } from "./context.ts";
import {
  SESSION_OPEN_REASON,
  closeWindow,
  endRun,
  finish,
  needsInput,
  send,
  terminalFor,
  transition,
} from "./lifecycle.ts";

const PR_STATE_EVENTS: ReadonlyArray<[PrEvent, JobState]> = [
  ["merged", "merged"],
  ["closed", "closed"],
  ["reopened", "done"],
];

export function applyPrEvents(
  ctx: MillContext,
  key: number,
  events: PrEvent[],
  observation: PrObservation,
): void {
  const job = getJob(ctx.db, key);

  if (!job) {
    return;
  }

  ctx.log(`${job.id} PR events: ${events.join(", ")}`);

  if (!WATCHED_STATES.includes(job.state as JobState)) {
    return;
  }

  const next = PR_STATE_EVENTS.find(([event]) => events.includes(event))?.[1];

  if (next && transition(ctx, key, { to: next, fields: { nextRun: null } }) && next !== "done") {
    void prEnded(ctx, job, next, observation);
  }
}

export function applyMergeable(ctx: MillContext, key: number, mergeable: boolean | null): void {
  const job = getJob(ctx.db, key);

  if (!job?.prBaseBranch) {
    return;
  }

  const decision = decideConflict({
    state: job.state as JobState,
    restacking: job.restack !== null,
    blockedReason: job.blockedReason,
    base: job.prBaseBranch,
    mergeable,
  });

  if (decision === "flag") {
    needsInput(ctx, key, conflictReason(job.prBaseBranch));
  } else if (decision === "clear") {
    transition(ctx, key, { from: ["needs_input"], to: "done", fields: { blockedReason: null } });
  }
}

async function prEnded(
  ctx: MillContext,
  job: Job,
  state: JobState,
  observation: PrObservation,
): Promise<void> {
  const run = latestRun(ctx.db, job.key);
  const live = SESSION_STATES.includes(job.state as JobState) && run?.blockId && !run.endedAt;

  if (run && live) {
    await endRun(ctx, job, run, { status: "done" });
    await closeWindow(ctx, job, run);
    send(
      ctx,
      "session_closed",
      job.key,
      `the PR ${state} while openmill was working on it, so its session was closed`,
    );
  }

  if (state === "merged") {
    if (job.prBaseBranch) {
      markDependents(ctx, job, { base: job.prBaseBranch, cut: observation.headSha });
    }

    await cleanUpMerged(ctx, job);
  }

  if (live) {
    ctx.schedule();
  }
}

export function followUp(ctx: MillContext): void {
  for (const job of listJobs(ctx.db)) {
    if (job.state !== "done") {
      continue;
    }

    notifyReady(ctx, job);

    if (ctx.preparing.has(job.key)) {
      continue;
    }

    const { restack } = job;

    if (restack) {
      inBackground(ctx, job, () => restackJob(ctx, job.key, restack));
    } else if (decide(ctx, job).action !== "none") {
      inBackground(ctx, job, () => prepareFollowup(ctx, job.key));
    }
  }
}

export async function completeFollowup(ctx: MillContext, key: number, run: Run): Promise<void> {
  if (run.kind === "restack" && run.startSha) {
    try {
      await landRestack(ctx, key, run.startSha);
    } catch (error) {
      ctx.log(`retargeting ${getJob(ctx.db, key)?.id} after its restack failed: ${String(error)}`);
    }
  }

  finish(ctx, key, getJob(ctx.db, key)?.prUrl as string);
}

function observationOf(ctx: MillContext, job: Job): PrObservation | undefined {
  const row = getObservation(ctx.db, job.key);

  return row && row.prUrl === job.prUrl ? { ...row, state: row.state as PrState } : undefined;
}

function notifyReady(ctx: MillContext, job: Job): void {
  const observation = observationOf(ctx, job);

  if (
    observation &&
    getObservation(ctx.db, job.key)?.readyNotifiedSha !== observation.headSha &&
    prNotificationFor(job.state as JobState, observation) === "ready_for_review"
  ) {
    updateObservation(ctx.db, job.key, { readyNotifiedSha: observation.headSha });
    send(ctx, "ready_for_review", job.key, "every check passed");
  }
}

function decide(ctx: MillContext, job: Job): FollowupDecision {
  return decideFollowup({
    state: job.state as JobState,
    observation: observationOf(ctx, job),
    runs: listRuns(ctx.db, job.key),
    attempts: ctx.config.followup_attempts,
    staleHead: ctx.staleHeads.get(job.key),
  });
}

function inBackground(ctx: MillContext, job: Job, task: () => Promise<void>): void {
  ctx.preparing.add(job.key);

  void task()
    .catch((error: unknown) => {
      ctx.log(`follow-up for ${job.id} failed: ${String(error)}`);
      needsInput(ctx, job.key, (error as { detail?: string }).detail ?? String(error));
    })
    .finally(() => {
      ctx.preparing.delete(job.key);
      ctx.schedule();
    });
}

async function prepareFollowup(ctx: MillContext, key: number): Promise<void> {
  const job = getJob(ctx.db, key);

  if (!job) {
    return;
  }

  const remoteHead = await withRepoLock(job.repoPath, () => fetchBranch(job));
  const observed = getObservation(ctx.db, key)?.headSha;

  if (observed && observed !== remoteHead) {
    ctx.staleHeads.set(key, observed);
  }

  const current = getJob(ctx.db, key);
  const decision = current ? decide(ctx, current) : { action: "none" as const };

  if (decision.action === "none") {
    return;
  }

  if (decision.action === "exhausted") {
    needsInput(ctx, key, decision.reason, true);

    return;
  }

  if (await sessionBusy(ctx, job)) {
    needsInput(ctx, key, SESSION_OPEN_REASON);

    return;
  }

  const synced = await fastForward(job.worktreePath, job.branchName);

  if ("problem" in synced) {
    needsInput(ctx, key, synced.problem);

    return;
  }

  queueRun(ctx, key, {
    kind: "followup",
    trigger: decision.trigger,
    gate: pushModeFor(decision.trigger, ctx.config) === "wait" ? "closed" : null,
    startSha: synced.head,
    resume: false,
  });
}

async function restackJob(
  ctx: MillContext,
  key: number,
  { base, cut }: RestackRecord,
): Promise<void> {
  const job = getJob(ctx.db, key);

  if (!job) {
    return;
  }

  const cwd = job.worktreePath;

  if (await sessionBusy(ctx, job)) {
    needsInput(ctx, key, SESSION_OPEN_REASON);

    return;
  }

  const landed = await withRepoLock(job.repoPath, async () => {
    await fetchBranch(job);

    const synced = await fastForward(cwd, job.branchName);

    if ("problem" in synced) {
      needsInput(ctx, key, synced.problem);

      return undefined;
    }

    try {
      await git(cwd, ["rebase", "--onto", `origin/${base}`, cut]);
    } catch {
      await git(cwd, ["rebase", "--abort"]).catch(() => {});

      return { conflict: true, head: synced.head };
    }

    try {
      await git(cwd, ["push", "--force-with-lease", "origin", job.branchName]);
    } catch (error) {
      await git(cwd, ["reset", "--hard", synced.head]);

      throw error;
    }

    return { conflict: false, head: synced.head };
  });

  if (!landed) {
    return;
  }

  if (!landed.conflict) {
    await landRestack(ctx, key, landed.head);

    return;
  }

  if (await sessionBusy(ctx, job)) {
    needsInput(ctx, key, SESSION_OPEN_REASON);

    return;
  }

  queueRun(ctx, key, {
    kind: "restack",
    trigger: null,
    gate: ctx.config.review_push === "wait" ? "closed" : null,
    startSha: landed.head,
    resume: false,
  });
}

async function landRestack(ctx: MillContext, key: number, before: string): Promise<void> {
  const job = getJob(ctx.db, key);
  const restack = job?.restack;

  if (!job || !restack) {
    return;
  }

  if (job.prUrl && job.prBaseBranch !== restack.base) {
    await ctx.github.editPrBase(job.repoPath, job.prUrl, restack.base);
  }

  updateJob(ctx.db, key, {
    baseBranch: `origin/${restack.base}`,
    prBaseBranch: restack.base,
    restack: null,
  });
  markDependents(ctx, job, { base: job.branchName, cut: before });
}

function markDependents(ctx: MillContext, parent: Job, restack: RestackRecord): void {
  for (const job of listJobs(ctx.db)) {
    if (!stackedOn(job, parent)) {
      continue;
    }

    updateJob(ctx.db, job.key, { restack });

    // The fast lane can report the conflict a parent merge causes before the watcher sees the merge.
    if (job.blockedReason === conflictReason(parent.branchName)) {
      transition(ctx, job.key, {
        from: ["needs_input"],
        to: "done",
        fields: { blockedReason: null },
      });
    }
  }
}

function queueRun(ctx: MillContext, key: number, nextRun: NextRunRecord): void {
  transition(ctx, key, { from: ["done"], to: "queued", fields: { nextRun } });
}

async function sessionBusy(ctx: MillContext, job: Job): Promise<boolean> {
  const run = latestRun(ctx.db, job.key);

  if (!run?.blockId || !run.busy) {
    return false;
  }

  return (await terminalFor(ctx, job).list()).some(
    (block) => block.blockId === run.blockId && block.alive,
  );
}

async function cleanUpMerged(ctx: MillContext, job: Job): Promise<void> {
  try {
    await withRepoLock(job.repoPath, () =>
      removeWorktree(job.repoPath, job.worktreePath, job.branchName),
    );
  } catch (error) {
    ctx.log(`cleaning up merged job ${job.id} failed: ${String(error)}`);
  }
}

import type { Config, PushMode } from "./config.ts";
import { checksFinished, failingChecks, type PrObservation } from "./observation.ts";
import type { JobState } from "./states.ts";

export type RunKind = "feature" | "followup" | "restack";

export interface FollowupTrigger {
  reviewId: string | null;
  threads: string[];
  checks: string[];
  headSha: string;
}

export interface PastRun {
  kind: RunKind;
  trigger: FollowupTrigger | null;
  startSha?: string | null;
  restack?: { base: string; cut: string; baseSha?: string } | null;
}

export interface FollowupInput {
  state: JobState;
  observation: PrObservation | undefined;
  runs: readonly PastRun[];
  attempts: number;
  staleHead?: string;
}

export type FollowupDecision =
  | { action: "none" }
  | { action: "run"; trigger: FollowupTrigger }
  | { action: "exhausted"; reason: string };

function problem(trigger: FollowupTrigger): string {
  return JSON.stringify([[...trigger.checks].sort(), [...trigger.threads].sort()]);
}

// Resuming a run, after a restart or an approval, copies its trigger, so it isn't a new attempt.
export function followupAttempts(runs: readonly PastRun[], trigger: FollowupTrigger): number {
  const attempts = new Set<string>();

  for (const run of runs.toReversed()) {
    if (run.kind !== "followup" || !run.trigger || problem(run.trigger) !== problem(trigger)) {
      break;
    }

    attempts.add(`${run.trigger.reviewId}|${run.trigger.headSha}`);
  }

  return attempts.size;
}

export function conflictAttempts(runs: readonly PastRun[], base: string, baseSha: string): number {
  const attempts = new Set<string | null | undefined>();

  for (const run of runs.toReversed()) {
    if (run.kind !== "restack" || run.restack?.base !== base || run.restack.baseSha !== baseSha) {
      break;
    }

    attempts.add(run.startSha);
  }

  return attempts.size;
}

function openItems(trigger: FollowupTrigger): string {
  return [
    trigger.checks.length > 0 ? `failing checks ${trigger.checks.join(", ")}` : undefined,
    trigger.threads.length > 0 ? `unresolved threads ${trigger.threads.join(", ")}` : undefined,
  ]
    .filter(Boolean)
    .join("; ");
}

export function decideFollowup(input: FollowupInput): FollowupDecision {
  const { observation, runs } = input;

  if (input.state !== "done" || observation?.state !== "OPEN") {
    return { action: "none" };
  }

  const followups = runs.flatMap((run) =>
    run.kind === "followup" && run.trigger ? [run.trigger] : [],
  );
  // Replies to threads show up as new reviews by the replier, so only new threads count.
  const handled = new Set(followups.flatMap((trigger) => trigger.threads));
  const threads = observation.unresolvedThreads.filter((thread) => !handled.has(thread));
  const review =
    observation.latestReviewId !== null &&
    threads.length > 0 &&
    !followups.some((trigger) => trigger.reviewId === observation.latestReviewId);
  const failing = observation.headSha === input.staleHead ? [] : failingChecks(observation.checks);
  const ci =
    failing.length > 0 &&
    !followups.some(
      (trigger) => trigger.headSha === observation.headSha && trigger.checks.length > 0,
    );

  if (!review && !ci) {
    return { action: "none" };
  }

  const trigger: FollowupTrigger = {
    reviewId: review ? observation.latestReviewId : null,
    threads: review ? threads : [],
    checks: ci ? failing : [],
    headSha: observation.headSha,
  };
  const attempts = followupAttempts(runs, trigger);

  if (attempts >= input.attempts) {
    return {
      action: "exhausted",
      reason: `${attempts} follow-up runs didn't fix ${openItems(trigger)}`,
    };
  }

  return { action: "run", trigger };
}

export function triggerCleared(trigger: FollowupTrigger, observation: PrObservation): boolean {
  const failing = failingChecks(observation.checks);
  const checksPassed =
    trigger.checks.length === 0 ||
    (checksFinished(observation.checks) &&
      !trigger.checks.some((check) => failing.includes(check)));

  return (
    checksPassed &&
    !trigger.threads.some((thread) => observation.unresolvedThreads.includes(thread))
  );
}

export function pushModeFor(
  trigger: FollowupTrigger,
  config: Pick<Config, "review_push" | "ci_push">,
): PushMode {
  const review = trigger.reviewId !== null && config.review_push === "wait";
  const ci = trigger.checks.length > 0 && config.ci_push === "wait";

  return review || ci ? "wait" : "auto";
}

export interface BranchState {
  progressed: boolean;
  unpushed: boolean;
  dirty: boolean;
}

export type FollowupOutcome = "done" | "awaiting_push" | "block" | "needs_input";

export function followupOutcome(
  branch: BranchState,
  gateClosed: boolean,
  stopHookActive: boolean,
): FollowupOutcome {
  if (branch.progressed && !branch.dirty) {
    if (!branch.unpushed) {
      return "done";
    }

    if (gateClosed) {
      return "awaiting_push";
    }
  }

  return stopHookActive ? "needs_input" : "block";
}

export function editTurnOutcome(
  branch: BranchState,
  stopHookActive: boolean,
): "done" | "block" | "needs_input" {
  if (!branch.dirty && !branch.unpushed) {
    return "done";
  }

  return stopHookActive ? "needs_input" : "block";
}

export const JOB_STATES = [
  "queued",
  "running",
  "needs_input",
  "paused",
  "done",
  "failed",
  "blocked",
  "cancelled",
] as const;

export type JobState = (typeof JOB_STATES)[number];

const TRANSITIONS: Record<JobState, readonly JobState[]> = {
  queued: ["running", "blocked", "queued", "cancelled"],
  running: ["done", "needs_input", "failed", "paused", "queued"],
  needs_input: ["queued", "done", "cancelled"],
  paused: ["queued", "done", "cancelled"],
  failed: ["queued", "done", "cancelled"],
  done: ["queued", "cancelled"],
  blocked: ["queued", "blocked", "cancelled"],
  cancelled: [],
};

export function assertTransition(from: JobState, to: JobState): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(`cannot move a job from ${from} to ${to}`);
  }
}

export const BLOCKING_STATES: readonly JobState[] = ["failed", "needs_input", "cancelled"];

export const REQUEUEABLE_STATES: readonly JobState[] = ["paused", "needs_input", "failed"];

export const HAND_OFF_STATES: readonly JobState[] = REQUEUEABLE_STATES;

export const UPDATABLE_STATES: readonly JobState[] = ["queued", "blocked"];

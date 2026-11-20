export const JOB_STATES = [
  "queued",
  "running",
  "needs_input",
  "awaiting_push",
  "done",
  "failed",
  "blocked",
  "cancelled",
  "merged",
  "closed",
] as const;

export type JobState = (typeof JOB_STATES)[number];

export const FINISHED_STATES: readonly JobState[] = ["merged", "cancelled", "closed"];

const TRANSITIONS: Record<JobState, readonly JobState[]> = {
  queued: ["running", "blocked", "queued", "cancelled", "merged", "closed"],
  running: [
    "done",
    "needs_input",
    "awaiting_push",
    "failed",
    "queued",
    "cancelled",
    "merged",
    "closed",
  ],
  needs_input: ["running", "done", "failed", "queued", "cancelled", "merged", "closed"],
  awaiting_push: ["running", "queued", "merged", "closed", "cancelled"],
  failed: ["queued", "done", "cancelled", "merged", "closed"],
  done: ["queued", "needs_input", "cancelled", "merged", "closed"],
  blocked: ["queued", "blocked", "cancelled"],
  cancelled: [],
  merged: [],
  closed: ["done", "cancelled"],
};

export function canTransition(from: JobState, to: JobState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) {
    throw new Error(`cannot move a job from ${from} to ${to}`);
  }
}

export const BLOCKING_STATES: readonly JobState[] = [
  "failed",
  "needs_input",
  "cancelled",
  "closed",
];

export const REQUEUEABLE_STATES: readonly JobState[] = ["failed", "awaiting_push", "needs_input"];

export const HAND_OFF_STATES: readonly JobState[] = ["needs_input", "failed"];

export const SESSION_STATES: readonly JobState[] = ["running", "needs_input"];

export const CLEANABLE_STATES: readonly JobState[] = ["done", "merged", "closed", "cancelled"];

export const UPDATABLE_STATES: readonly JobState[] = ["queued", "blocked"];

// closed is watched too, since that is the only way to see the PR reopen.
export const WATCHED_STATES: readonly JobState[] = [
  "queued",
  "running",
  "needs_input",
  "awaiting_push",
  "done",
  "failed",
  "closed",
];

import { checksSucceeded, type PrEvent, type PrObservation } from "./observation.ts";
import type { JobState } from "./states.ts";

export const NOTIFICATION_EVENTS = [
  "needs_input",
  "needs_permission",
  "failed",
  "ready_for_review",
  "followup_ready",
  "followups_exhausted",
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

const TRANSITION_EVENTS: Partial<Record<JobState, NotificationEvent>> = {
  needs_input: "needs_input",
  failed: "failed",
  awaiting_push: "followup_ready",
};

export function notificationFor(
  from: JobState,
  to: JobState,
  exhausted = false,
): NotificationEvent | null {
  if (from === to) {
    return null;
  }

  return exhausted && to === "needs_input"
    ? "followups_exhausted"
    : (TRANSITION_EVENTS[to] ?? null);
}

export function prNotificationFor(
  state: JobState,
  event: PrEvent,
  observation: PrObservation,
): NotificationEvent | null {
  return state === "done" && event === "checks_finished" && checksSucceeded(observation.checks)
    ? "ready_for_review"
    : null;
}

import { checksSucceeded, type PrEvent, type PrObservation } from "./observation.ts";
import type { JobState } from "./states.ts";

export const NOTIFICATION_EVENTS = ["needs_input", "failed", "ready_for_review"] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

const TRANSITION_EVENTS: readonly JobState[] = ["needs_input", "failed"];

export function notificationFor(from: JobState, to: JobState): NotificationEvent | null {
  if (from === to) {
    return null;
  }

  return TRANSITION_EVENTS.includes(to) ? (to as NotificationEvent) : null;
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

import type { JobState } from "./states.ts";

export const NOTIFICATION_EVENTS = ["needs_input", "failed"] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export function notificationFor(from: JobState, to: JobState): NotificationEvent | null {
  if (from === to) {
    return null;
  }

  return (NOTIFICATION_EVENTS as readonly JobState[]).includes(to)
    ? (to as NotificationEvent)
    : null;
}

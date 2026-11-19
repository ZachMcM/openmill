import type { NotificationEvent } from "@openmill/core";

export interface NotificationPayload {
  event: NotificationEvent;
  job: string;
  repo: string;
  state: string;
  reason: string | null;
  pr_url: string | null;
  open: string;
}

export interface Notifier {
  send(payload: NotificationPayload): Promise<void>;
}

export const NOTIFIER_TYPES = ["discord", "slack"] as const;

export type NotifierType = (typeof NOTIFIER_TYPES)[number];

export const NOTIFIER_LABELS: Record<NotifierType, string> = {
  discord: "Discord",
  slack: "Slack",
};

export const NOTIFIER_NAME = /^[A-Za-z0-9][\w.-]*$/;

export const NOTIFIER_NAME_HINT =
  "start with a letter or number and use only letters, numbers, dots, dashes, and underscores";

export interface NotifierEntry {
  name: string;
  type: NotifierType;
  url: string;
}

export const EVENT_LABELS: Record<NotificationEvent, string> = {
  needs_input: "needs input",
  needs_permission: "waiting for permission",
  failed: "failed",
  ready_for_review: "ready for review",
  followup_ready: "follow-up ready to push",
  followups_exhausted: "follow-ups exhausted",
  pr_opened: "draft PR opened",
};

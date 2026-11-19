import { basename } from "node:path";
import { EVENT_LABELS, type NotificationPayload } from "./types.ts";

const REASON_LIMIT = 300;

export const TEST_TITLE = "openmill is connected";
export const TEST_BODY = "You'll get messages here when a job needs you or opens a PR.";

export function title(payload: NotificationPayload): string {
  const label = EVENT_LABELS[payload.event];

  return `${label.charAt(0).toUpperCase()}${label.slice(1)} · ${payload.job}`;
}

export function repoName(payload: NotificationPayload): string {
  return basename(payload.repo);
}

export function reason(payload: NotificationPayload): string | undefined {
  const text = payload.reason?.replace(/\s+/g, " ").trim();

  if (!text) {
    return undefined;
  }

  return text.length > REASON_LIMIT ? `${text.slice(0, REASON_LIMIT - 1).trimEnd()}…` : text;
}

export function matchedPrefix(url: string, prefixes: readonly string[]): string | undefined {
  return prefixes.find((prefix) => url.startsWith(prefix));
}

import { TEST_BODY, TEST_TITLE, reason, repoName, matchedPrefix, title } from "./message.ts";
import type { NotificationPayload } from "./types.ts";

export const WEBHOOK_PREFIXES = ["https://hooks.slack.com/services/"];

export function isWebhookUrl(url: string): boolean {
  return matchedPrefix(url, WEBHOOK_PREFIXES) !== undefined;
}

function escape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function mrkdwn(text: string) {
  return { type: "mrkdwn", text };
}

function message(heading: string, body: string | undefined, context: string[]) {
  return {
    text: escape(body ? `${heading}: ${body}` : heading),
    blocks: [
      { type: "header", text: { type: "plain_text", text: heading } },
      ...(body ? [{ type: "section", text: mrkdwn(escape(body)) }] : []),
      ...(context.length > 0 ? [{ type: "context", elements: context.map(mrkdwn) }] : []),
    ],
  };
}

export function format(payload: NotificationPayload) {
  return message(title(payload), reason(payload), [
    escape(repoName(payload)),
    ...(payload.pr_url ? [`<${escape(payload.pr_url)}|PR>`] : []),
    `\`${escape(payload.open)}\``,
  ]);
}

export function formatTest() {
  return message(TEST_TITLE, TEST_BODY, []);
}

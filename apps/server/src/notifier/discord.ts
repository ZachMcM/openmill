import type { NotificationEvent } from "@openmill/core";
import { TEST_BODY, TEST_TITLE, reason, repoName, matchedPrefix, title } from "./message.ts";
import type { NotificationPayload } from "./types.ts";

const RED = 0xe5484d;
const YELLOW = 0xf5a524;
const GREEN = 0x30a46c;
const BLUE = 0x3e63dd;

const COLORS: Record<NotificationEvent, number> = {
  failed: RED,
  followups_exhausted: RED,
  needs_input: YELLOW,
  needs_permission: YELLOW,
  ready_for_review: GREEN,
  pr_opened: GREEN,
  followup_ready: BLUE,
};

export const WEBHOOK_PREFIXES = [
  "https://discord.com/api/webhooks/",
  "https://discordapp.com/api/webhooks/",
];

export function isWebhookUrl(url: string): boolean {
  return matchedPrefix(url, WEBHOOK_PREFIXES) !== undefined;
}

export function format(payload: NotificationPayload) {
  return {
    embeds: [
      {
        title: title(payload),
        url: payload.pr_url ?? undefined,
        description: reason(payload),
        color: COLORS[payload.event],
        fields: [
          { name: "Repo", value: repoName(payload), inline: true },
          { name: "Open", value: `\`${payload.open}\``, inline: true },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

export function formatTest() {
  return {
    embeds: [{ title: TEST_TITLE, description: TEST_BODY, color: GREEN }],
    allowed_mentions: { parse: [] },
  };
}

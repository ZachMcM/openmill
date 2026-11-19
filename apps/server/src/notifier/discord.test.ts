import { describe, expect, it } from "vitest";
import { format, isWebhookUrl } from "./discord.ts";
import type { NotificationPayload } from "./types.ts";

const payload: NotificationPayload = {
  event: "needs_input",
  job: "add-auth",
  repo: "/src/app",
  state: "needs_input",
  reason: "@everyone should   sessions expire?",
  pr_url: null,
  open: "openmill open add-auth",
};

describe("format", () => {
  it("builds one embed that can't ping anyone", () => {
    expect(format(payload)).toEqual({
      embeds: [
        {
          title: "Needs input · add-auth",
          description: "@everyone should sessions expire?",
          color: 0xf5a524,
          fields: [
            { name: "Repo", value: "app", inline: true },
            { name: "Open", value: "`openmill open add-auth`", inline: true },
          ],
        },
      ],
      allowed_mentions: { parse: [] },
    });
  });

  it.each([
    ["failed", 0xe5484d],
    ["followups_exhausted", 0xe5484d],
    ["needs_permission", 0xf5a524],
    ["ready_for_review", 0x30a46c],
    ["pr_opened", 0x30a46c],
    ["followup_ready", 0x3e63dd],
  ] as const)("colors %s", (event, color) => {
    expect(format({ ...payload, event }).embeds[0]?.color).toBe(color);
  });

  it("links the PR and clips a long reason", () => {
    const [embed] = format({
      ...payload,
      event: "pr_opened",
      reason: "x".repeat(400),
      pr_url: "https://github.com/o/r/pull/1",
    }).embeds;

    expect(embed?.title).toBe("Draft PR opened · add-auth");
    expect(embed?.url).toBe("https://github.com/o/r/pull/1");
    expect(embed?.description).toHaveLength(300);
    expect(embed?.description?.endsWith("x…")).toBe(true);
  });
});

describe("isWebhookUrl", () => {
  it.each([
    ["https://discord.com/api/webhooks/1/abc", true],
    ["https://discordapp.com/api/webhooks/1/abc", true],
    ["http://discord.com/api/webhooks/1/abc", false],
    ["https://discord.example.com/api/webhooks/1/abc", false],
    ["https://hooks.slack.com/services/T/B/abc", false],
  ])("%s is %s", (url, expected) => {
    expect(isWebhookUrl(url)).toBe(expected);
  });
});

import { describe, expect, it } from "vitest";
import { format, isWebhookUrl } from "./slack.ts";
import type { NotificationPayload } from "./types.ts";

const payload: NotificationPayload = {
  event: "failed",
  job: "add-auth",
  repo: "/src/app",
  state: "failed",
  reason: "tests failed: <Login> & <Logout>",
  pr_url: "https://github.com/o/r/pull/1",
  open: "openmill open add-auth",
};

describe("format", () => {
  it("returns fallback text, a header, the reason, and context, escaped", () => {
    expect(format(payload)).toEqual({
      text: "Failed · add-auth: tests failed: &lt;Login&gt; &amp; &lt;Logout&gt;",
      blocks: [
        { type: "header", text: { type: "plain_text", text: "Failed · add-auth" } },
        {
          type: "section",
          text: { type: "mrkdwn", text: "tests failed: &lt;Login&gt; &amp; &lt;Logout&gt;" },
        },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: "app" },
            { type: "mrkdwn", text: "<https://github.com/o/r/pull/1|PR>" },
            { type: "mrkdwn", text: "`openmill open add-auth`" },
          ],
        },
      ],
    });
  });

  it("uses the title alone when there is no reason", () => {
    const message = format({ ...payload, event: "pr_opened", reason: null });

    expect(message.text).toBe("Draft PR opened · add-auth");
    expect(message.blocks.map((block) => block.type)).toEqual(["header", "context"]);
  });
});

describe("isWebhookUrl", () => {
  it.each([
    ["https://hooks.slack.com/services/T/B/abc", true],
    ["https://hooks.slack.com/workflows/T/abc", false],
    ["https://hooks.slack.example.com/services/T/B/abc", false],
    ["https://discord.com/api/webhooks/1/abc", false],
  ])("%s is %s", (url, expected) => {
    expect(isWebhookUrl(url)).toBe(expected);
  });
});

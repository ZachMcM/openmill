import { describe, expect, it } from "vitest";
import { maskUrl } from "./notifier-store.ts";

describe("maskUrl", () => {
  it("keeps the platform prefix and the last four characters", () => {
    expect(maskUrl("https://discord.com/api/webhooks/123/secret-a1b2")).toBe(
      "https://discord.com/api/webhooks/…a1b2",
    );
    expect(maskUrl("https://hooks.slack.com/services/T0/B0/xyz9")).toBe(
      "https://hooks.slack.com/services/…xyz9",
    );
  });
});

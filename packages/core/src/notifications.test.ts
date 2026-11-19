import { describe, expect, it } from "vitest";
import { notificationFor, prNotificationFor } from "./notifications.ts";
import type { PrObservation } from "./observation.ts";

describe("notificationFor", () => {
  it("notifies when a run hands the job to a human", () => {
    expect(notificationFor("running", "needs_input")).toBe("needs_input");
    expect(notificationFor("running", "failed")).toBe("failed");
  });

  it("says a follow-up is ready to push or has run out of attempts", () => {
    expect(notificationFor("running", "awaiting_push")).toBe("followup_ready");
    expect(notificationFor("done", "needs_input", true)).toBe("followups_exhausted");
    expect(notificationFor("done", "needs_input")).toBe("needs_input");
  });

  it("stays quiet for blocked and other transitions", () => {
    expect(notificationFor("queued", "blocked")).toBeNull();
    expect(notificationFor("needs_input", "running")).toBeNull();
    expect(notificationFor("running", "done")).toBeNull();
    expect(notificationFor("needs_input", "queued")).toBeNull();
    expect(notificationFor("failed", "failed")).toBeNull();
  });
});

describe("prNotificationFor", () => {
  const observation: PrObservation = {
    state: "OPEN",
    headSha: "a1",
    checks: {
      state: "SUCCESS",
      checks: [
        { name: "test", status: "COMPLETED", conclusion: "SUCCESS" },
        { name: "lint", status: "COMPLETED", conclusion: "SKIPPED" },
      ],
    },
    unresolvedThreads: [],
    latestReviewId: null,
  };
  const failing = {
    ...observation,
    checks: {
      state: "FAILURE",
      checks: [{ name: "test", status: "COMPLETED", conclusion: "FAILURE" }],
    },
  };

  it("says a done job is ready for review when every check passed", () => {
    expect(prNotificationFor("done", observation)).toBe("ready_for_review");
    expect(prNotificationFor("done", failing)).toBeNull();
    expect(prNotificationFor("closed", observation)).toBeNull();
  });
});

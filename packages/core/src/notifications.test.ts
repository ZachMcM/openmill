import { describe, expect, it } from "vitest";
import { notificationFor } from "./notifications.ts";

describe("notificationFor", () => {
  it("notifies when a run hands the job to a human", () => {
    expect(notificationFor("running", "needs_input")).toBe("needs_input");
    expect(notificationFor("running", "failed")).toBe("failed");
  });

  it("stays quiet for blocked, paused, and other transitions", () => {
    expect(notificationFor("queued", "blocked")).toBeNull();
    expect(notificationFor("running", "paused")).toBeNull();
    expect(notificationFor("running", "done")).toBeNull();
    expect(notificationFor("needs_input", "queued")).toBeNull();
    expect(notificationFor("failed", "failed")).toBeNull();
  });
});

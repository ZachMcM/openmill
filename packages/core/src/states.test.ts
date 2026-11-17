import { describe, expect, it } from "vitest";
import { canTransition } from "./states.ts";

describe("PR states", () => {
  it("moves done and paused jobs to merged or closed", () => {
    for (const from of ["done", "paused"] as const) {
      expect(canTransition(from, "merged")).toBe(true);
      expect(canTransition(from, "closed")).toBe(true);
    }

    expect(canTransition("running", "merged")).toBe(false);
  });

  it("lets a closed job reopen or be cancelled, and keeps merged terminal", () => {
    expect(canTransition("closed", "done")).toBe(true);
    expect(canTransition("closed", "cancelled")).toBe(true);
    expect(canTransition("closed", "queued")).toBe(false);
    expect(canTransition("merged", "done")).toBe(false);
    expect(canTransition("merged", "queued")).toBe(false);
  });
});

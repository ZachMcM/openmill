import { describe, expect, it } from "vitest";
import { canTransition } from "./states.ts";

describe("PR states", () => {
  it("moves done jobs to merged or closed", () => {
    expect(canTransition("done", "merged")).toBe(true);
    expect(canTransition("done", "closed")).toBe(true);
  });

  it("applies a merge or close from any live state", () => {
    for (const from of ["queued", "running", "needs_input", "failed"] as const) {
      expect(canTransition(from, "merged")).toBe(true);
      expect(canTransition(from, "closed")).toBe(true);
    }
  });

  it("lets a closed job reopen or be cancelled, and keeps merged terminal", () => {
    expect(canTransition("closed", "done")).toBe(true);
    expect(canTransition("closed", "cancelled")).toBe(true);
    expect(canTransition("closed", "queued")).toBe(false);
    expect(canTransition("closed", "merged")).toBe(false);
    expect(canTransition("merged", "done")).toBe(false);
    expect(canTransition("merged", "queued")).toBe(false);
  });
});

describe("session states", () => {
  it("moves a waiting job back to running when a human answers", () => {
    expect(canTransition("needs_input", "running")).toBe(true);
  });

  it("fails a running or waiting job whose session ended", () => {
    expect(canTransition("running", "failed")).toBe(true);
    expect(canTransition("needs_input", "failed")).toBe(true);
  });

  it("cancels a job with an open window", () => {
    expect(canTransition("running", "cancelled")).toBe(true);
    expect(canTransition("needs_input", "cancelled")).toBe(true);
  });

  it("requeues only from states with no live session", () => {
    expect(canTransition("failed", "queued")).toBe(true);
    expect(canTransition("cancelled", "queued")).toBe(false);
  });
});

describe("follow-up states", () => {
  it("parks a gated run in awaiting_push and leaves it when approved, re-queued, or the PR ends", () => {
    expect(canTransition("running", "awaiting_push")).toBe(true);

    for (const to of ["running", "queued", "merged", "closed", "cancelled"] as const) {
      expect(canTransition("awaiting_push", to)).toBe(true);
    }

    expect(canTransition("awaiting_push", "done")).toBe(false);
    expect(canTransition("done", "awaiting_push")).toBe(false);
  });

  it("asks a human from done when a follow-up can't start", () => {
    expect(canTransition("done", "needs_input")).toBe(true);
  });
});

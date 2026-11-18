import { describe, expect, it } from "vitest";
import { canTransition } from "./states.ts";

describe("PR states", () => {
  it("moves done jobs to merged or closed", () => {
    expect(canTransition("done", "merged")).toBe(true);
    expect(canTransition("done", "closed")).toBe(true);
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

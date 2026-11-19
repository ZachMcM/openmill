import { describe, expect, it } from "vitest";
import { conflictReason, decideConflict, type ConflictInput } from "./conflict.ts";

const done: ConflictInput = {
  state: "done",
  restacking: false,
  blockedReason: null,
  base: "main",
  mergeable: false,
};

const flagged: ConflictInput = {
  ...done,
  state: "needs_input",
  blockedReason: conflictReason("main"),
  mergeable: true,
};

describe("decideConflict", () => {
  it("flags a done job whose PR conflicts", () => {
    expect(decideConflict(done)).toBe("flag");
    expect(decideConflict({ ...done, state: "running" })).toBe("none");
  });

  it("never flags while a restack is pending", () => {
    expect(decideConflict({ ...done, restacking: true })).toBe("none");
  });

  it("changes nothing while GitHub is still computing mergeability", () => {
    expect(decideConflict({ ...done, mergeable: null })).toBe("none");
    expect(decideConflict({ ...flagged, mergeable: null })).toBe("none");
  });

  it("clears only the conflict reason once the PR merges cleanly", () => {
    expect(decideConflict(flagged)).toBe("clear");
    expect(decideConflict({ ...flagged, blockedReason: "the agent asked a question" })).toBe(
      "none",
    );
    expect(decideConflict({ ...flagged, base: "openmill/parent" })).toBe("none");
  });
});

import { describe, expect, it } from "vitest";
import { stopDecision } from "./stop.ts";

describe("stopDecision", () => {
  const url = "https://github.com/o/r/pull/1";

  it("finishes the job when the branch has a draft PR", () => {
    expect(stopDecision(url, false)).toEqual({ kind: "done", prUrl: url });
    expect(stopDecision(url, true)).toEqual({ kind: "done", prUrl: url });
  });

  it("blocks the first stop without a PR", () => {
    expect(stopDecision(undefined, false)).toEqual({ kind: "block" });
  });

  it("hands the job to a human when the agent stops again without a PR", () => {
    expect(stopDecision(undefined, true)).toEqual({ kind: "needs_input" });
  });
});

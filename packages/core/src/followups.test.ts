import { describe, expect, it } from "vitest";
import {
  decideFollowup,
  followupOutcome,
  followupAttempts,
  pushModeFor,
  type FollowupInput,
  type FollowupTrigger,
  type PastRun,
} from "./followups.ts";
import type { PrCheck, PrObservation } from "./observation.ts";

const passed: PrCheck = { name: "lint", status: "COMPLETED", conclusion: "SUCCESS" };
const failed: PrCheck = { name: "test", status: "COMPLETED", conclusion: "FAILURE" };
const running: PrCheck = { name: "test", status: "IN_PROGRESS", conclusion: null };

function observation(patch: Partial<PrObservation> = {}): PrObservation {
  return {
    state: "OPEN",
    headSha: "h1",
    checks: { state: "SUCCESS", checks: [passed] },
    unresolvedThreads: [],
    latestReviewId: null,
    ...patch,
  };
}

const reviewed = observation({ latestReviewId: "r1", unresolvedThreads: ["t1"] });
const red = observation({ checks: { state: "FAILURE", checks: [passed, failed] } });

function decide(patch: Partial<FollowupInput>) {
  return decideFollowup({ state: "done", observation: red, runs: [], attempts: 3, ...patch });
}

function followup(trigger: Partial<FollowupTrigger>): PastRun {
  return {
    kind: "followup",
    trigger: { reviewId: null, threads: [], checks: [], headSha: "h1", ...trigger },
  };
}

describe("decideFollowup", () => {
  it("runs for a trusted review with unresolved threads", () => {
    expect(decide({ observation: reviewed })).toEqual({
      action: "run",
      trigger: { reviewId: "r1", threads: ["t1"], checks: [], headSha: "h1" },
    });
    expect(decide({ observation: observation({ latestReviewId: "r1" }) })).toEqual({
      action: "none",
    });
  });

  it("runs for finished CI with a failed check", () => {
    expect(decide({})).toEqual({
      action: "run",
      trigger: { reviewId: null, threads: [], checks: ["test"], headSha: "h1" },
    });
    expect(
      decide({ observation: observation({ checks: { state: null, checks: [passed, running] } }) }),
    ).toEqual({ action: "none" });
  });

  it("covers a review and failed CI in one run", () => {
    expect(
      decide({ observation: { ...red, latestReviewId: "r1", unresolvedThreads: ["t1"] } }),
    ).toEqual({
      action: "run",
      trigger: { reviewId: "r1", threads: ["t1"], checks: ["test"], headSha: "h1" },
    });
  });

  it("skips what an earlier follow-up already took on", () => {
    expect(decide({ runs: [followup({ checks: ["test"] })] })).toEqual({ action: "none" });
    expect(decide({ observation: reviewed, runs: [followup({ reviewId: "r1" })] })).toEqual({
      action: "none",
    });
    expect(decide({ runs: [{ kind: "feature", trigger: null }] }).action).toBe("run");
  });

  it("ignores a new review that only replies on threads a follow-up already handled", () => {
    const runs = [followup({ reviewId: "r1", threads: ["t1"] })];

    expect(decide({ observation: { ...reviewed, latestReviewId: "r2" }, runs })).toEqual({
      action: "none",
    });
    expect(
      decide({
        observation: { ...reviewed, latestReviewId: "r2", unresolvedThreads: ["t1", "t2"] },
        runs,
      }),
    ).toEqual({
      action: "run",
      trigger: { reviewId: "r2", threads: ["t2"], checks: [], headSha: "h1" },
    });
  });

  it("ignores CI results for a head the branch has moved past", () => {
    expect(decide({ staleHead: "h1" })).toEqual({ action: "none" });
    expect(decide({ staleHead: "h0" }).action).toBe("run");
  });

  it("starts nothing for jobs outside done, and picks up again once done", () => {
    for (const state of ["running", "queued", "awaiting_push", "needs_input"] as const) {
      expect(decide({ state })).toEqual({ action: "none" });
    }

    expect(decide({ observation: { ...red, state: "MERGED" } })).toEqual({ action: "none" });
  });

  it("gives up after the configured attempts on the same problem", () => {
    const runs = [
      followup({ checks: ["test"], headSha: "h0" }),
      followup({ checks: ["test"], headSha: "h01" }),
    ];

    expect(decide({ runs }).action).toBe("run");
    expect(decide({ runs, attempts: 2 })).toEqual({
      action: "exhausted",
      reason: "2 follow-up runs didn't fix failing checks test",
    });
  });
});

describe("followupAttempts", () => {
  const trigger: FollowupTrigger = { reviewId: null, threads: [], checks: ["test"], headSha: "h3" };

  it("counts consecutive runs on the same failure", () => {
    expect(
      followupAttempts(
        [
          followup({ checks: ["test"], headSha: "h1" }),
          followup({ checks: ["test"], headSha: "h2" }),
        ],
        trigger,
      ),
    ).toBe(2);
  });

  it("resets when the set of failing checks and threads changes", () => {
    expect(
      followupAttempts(
        [
          followup({ checks: ["test"], headSha: "h1" }),
          followup({ checks: ["test", "lint"], headSha: "h2" }),
        ],
        trigger,
      ),
    ).toBe(0);
    expect(
      followupAttempts(
        [followup({ checks: ["test"], headSha: "h1" }), { kind: "feature", trigger: null }],
        trigger,
      ),
    ).toBe(0);
  });

  it("doesn't count a resumed run as another attempt", () => {
    const run = followup({ checks: ["test"], headSha: "h1" });

    expect(followupAttempts([run, run], trigger)).toBe(1);
  });
});

describe("pushModeFor", () => {
  const both: FollowupTrigger = {
    reviewId: "r1",
    threads: ["t1"],
    checks: ["test"],
    headSha: "h1",
  };
  const ciOnly: FollowupTrigger = { ...both, reviewId: null, threads: [] };

  it("waits when either gate covering the run says wait", () => {
    expect(pushModeFor(both, { review_push: "wait", ci_push: "auto" })).toBe("wait");
    expect(pushModeFor(both, { review_push: "auto", ci_push: "wait" })).toBe("wait");
    expect(pushModeFor(both, { review_push: "auto", ci_push: "auto" })).toBe("auto");
    expect(pushModeFor(ciOnly, { review_push: "wait", ci_push: "auto" })).toBe("auto");
  });
});

describe("followupOutcome", () => {
  const pushed = { progressed: true, unpushed: false, dirty: false };

  it("finishes when every new commit is pushed and the worktree is clean", () => {
    expect(followupOutcome(pushed, true, false)).toBe("done");
    expect(followupOutcome(pushed, false, false)).toBe("done");
  });

  it("waits for approval when a gated run has unpushed commits", () => {
    expect(followupOutcome({ ...pushed, unpushed: true }, true, false)).toBe("awaiting_push");
  });

  it("blocks the first stop, then asks a human, when nothing usable was committed", () => {
    for (const branch of [
      { ...pushed, progressed: false },
      { ...pushed, dirty: true },
      { ...pushed, unpushed: true },
    ]) {
      expect(followupOutcome(branch, false, false)).toBe("block");
      expect(followupOutcome(branch, false, true)).toBe("needs_input");
    }

    expect(followupOutcome({ ...pushed, progressed: false }, true, true)).toBe("needs_input");
  });
});

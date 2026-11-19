import { describe, expect, it } from "vitest";
import {
  checksSucceeded,
  diffObservation,
  failingChecks,
  observe,
  type PrCheck,
  type PrObservation,
  type PrSnapshot,
} from "./observation.ts";

const done: PrCheck = { name: "ci", status: "COMPLETED", conclusion: "SUCCESS" };
const pending: PrCheck = { name: "ci", status: "IN_PROGRESS", conclusion: null };

function observation(patch: Partial<PrObservation> = {}): PrObservation {
  return {
    state: "OPEN",
    headSha: "a1",
    checks: { state: "PENDING", checks: [pending] },
    unresolvedThreads: [],
    latestReviewId: null,
    ...patch,
  };
}

const finished = { state: "SUCCESS", checks: [done] };

describe("diffObservation", () => {
  it("reports merge, close, and reopen", () => {
    expect(diffObservation(observation(), observation({ state: "MERGED" }))).toEqual(["merged"]);
    expect(diffObservation(observation(), observation({ state: "CLOSED" }))).toEqual(["closed"]);
    expect(diffObservation(observation({ state: "CLOSED" }), observation())).toEqual(["reopened"]);
    expect(
      diffObservation(observation({ state: "CLOSED" }), observation({ state: "CLOSED" })),
    ).toEqual([]);
  });

  it("reports checks finishing once per head, and again after the head moves", () => {
    const before = observation({ checks: finished });

    expect(diffObservation(observation(), before)).toEqual(["checks_finished"]);
    expect(diffObservation(before, observation({ checks: finished }))).toEqual([]);
    expect(diffObservation(before, observation({ headSha: "b2" }))).toEqual(["head_moved"]);
    expect(diffObservation(before, observation({ headSha: "b2", checks: finished }))).toEqual([
      "head_moved",
      "checks_finished",
    ]);
  });

  it("reports a new review only when it leaves unresolved threads", () => {
    const reviewed = observation({ latestReviewId: "r1", unresolvedThreads: ["t1"] });

    expect(diffObservation(observation(), reviewed)).toEqual(["review_submitted"]);
    expect(diffObservation(reviewed, reviewed)).toEqual([]);
    expect(diffObservation(observation(), observation({ latestReviewId: "r1" }))).toEqual([]);
  });

  it("reports what is already true on the first observation", () => {
    expect(diffObservation(undefined, observation())).toEqual([]);
    expect(
      diffObservation(
        undefined,
        observation({
          state: "MERGED",
          checks: finished,
          latestReviewId: "r1",
          unresolvedThreads: ["t1"],
        }),
      ),
    ).toEqual(["merged", "checks_finished", "review_submitted"]);
  });

  it("ignores reviews and threads from untrusted authors", () => {
    const snapshot: PrSnapshot = {
      state: "OPEN",
      isDraft: true,
      headSha: "a1",
      baseRef: "main",
      checks: { state: null, checks: [] },
      threads: [
        { id: "t1", isResolved: false, author: { login: "stranger", association: "NONE" } },
        {
          id: "t2",
          isResolved: false,
          author: { login: "Coderabbitai[bot]", association: "NONE" },
        },
        { id: "t3", isResolved: true, author: { login: "owner", association: "OWNER" } },
      ],
      reviews: [
        {
          id: "r1",
          state: "COMMENTED",
          submittedAt: "2026-11-01T00:00:00Z",
          author: { login: "maintainer", association: "MEMBER" },
        },
        {
          id: "r2",
          state: "COMMENTED",
          submittedAt: "2026-11-02T00:00:00Z",
          author: { login: "stranger", association: "CONTRIBUTOR" },
        },
      ],
    };
    const untrustedOnly = { ...snapshot, threads: snapshot.threads.slice(0, 1) };

    expect(observe(snapshot, ["coderabbitai[bot]"])).toMatchObject({
      unresolvedThreads: ["t2"],
      latestReviewId: "r1",
    });
    expect(diffObservation(undefined, observe(untrustedOnly, []))).toEqual([]);
  });
});

describe("cancelled checks", () => {
  const cancelled: PrCheck = { name: "ci", status: "COMPLETED", conclusion: "CANCELLED" };
  const failure: PrCheck = { name: "ci", status: "COMPLETED", conclusion: "FAILURE" };

  it("ignores a cancelled run that a passing run of the same check replaced", () => {
    const checks = { state: "SUCCESS", checks: [cancelled, done] };

    expect(failingChecks(checks)).toEqual([]);
    expect(checksSucceeded(checks)).toBe(true);
  });

  it("reports a replacing run's failure once", () => {
    expect(failingChecks({ state: "FAILURE", checks: [cancelled, failure] })).toEqual(["ci"]);
  });

  it("treats a cancelled run with no replacement as unfinished", () => {
    const checks = { state: "FAILURE", checks: [cancelled] };

    expect(failingChecks(checks)).toEqual([]);
    expect(checksSucceeded(checks)).toBe(false);
  });
});

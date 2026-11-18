import { describe, expect, it } from "vitest";
import { jobsToStart, waitingUpdates, type SchedulableJob } from "./scheduling.ts";
import type { JobState } from "./states.ts";

const WITH_PR: readonly JobState[] = ["done", "merged", "closed"];

function jobs(
  states: Record<string, JobState>,
  withPr: readonly string[] = [],
): Map<string, SchedulableJob> {
  return new Map(
    Object.entries(states).map(([id, state]) => [
      id,
      {
        id,
        state,
        blockedReason: null,
        prUrl:
          WITH_PR.includes(state) || withPr.includes(id)
            ? `https://github.com/o/r/pull/${id}`
            : null,
      },
    ]),
  );
}

describe("scheduling", () => {
  const chain = new Map([
    ["a", []],
    ["b", ["a"]],
    ["c", ["b"]],
    ["d", []],
  ]);

  it("starts queued jobs with satisfied dependencies up to the free slots", () => {
    expect(
      jobsToStart(chain, jobs({ a: "queued", b: "queued", c: "queued", d: "queued" }), 5),
    ).toEqual(["a", "d"]);
    expect(
      jobsToStart(chain, jobs({ a: "done", b: "queued", c: "queued", d: "queued" }), 1),
    ).toEqual(["b"]);
    expect(
      jobsToStart(chain, jobs({ a: "running", b: "queued", c: "queued", d: "queued" }), 1),
    ).toEqual(["d"]);
    expect(
      jobsToStart(chain, jobs({ a: "queued", b: "queued", c: "queued", d: "queued" }), 0),
    ).toEqual([]);
  });

  it("blocks dependents of a failed job through the whole chain", () => {
    const updates = waitingUpdates(
      chain,
      jobs({ a: "failed", b: "queued", c: "queued", d: "queued" }),
    );

    expect(updates).toEqual(
      new Map([
        ["b", { state: "blocked", blockedReason: "dependency a is failed" }],
        ["c", { state: "blocked", blockedReason: "dependency b is blocked" }],
      ]),
    );
  });

  it("returns blocked jobs to queued once the dependency is requeued", () => {
    const blocked = new Map(jobs({ a: "queued", b: "blocked", c: "blocked", d: "done" }));

    expect(waitingUpdates(chain, blocked)).toEqual(
      new Map([
        ["b", { state: "queued", blockedReason: null }],
        ["c", { state: "queued", blockedReason: null }],
      ]),
    );
  });

  it("leaves jobs waiting on a running dependency queued", () => {
    expect(
      waitingUpdates(chain, jobs({ a: "running", b: "queued", c: "queued", d: "queued" })).size,
    ).toBe(0);
  });

  it("treats a dependency with a verified PR as satisfied even while it runs again", () => {
    expect(jobsToStart(chain, jobs({ a: "running", b: "queued" }, ["a"]), 1)).toEqual(["b"]);
    expect(jobsToStart(chain, jobs({ a: "needs_input", b: "queued" }, ["a"]), 1)).toEqual(["b"]);
    expect(jobsToStart(chain, jobs({ a: "merged", b: "queued" }), 1)).toEqual(["b"]);
    expect(waitingUpdates(chain, jobs({ a: "failed", b: "queued" }, ["a"])).size).toBe(0);
  });

  it("blocks dependents of a closed PR and requeues them when it reopens", () => {
    const closed = jobs({ a: "closed", b: "queued", c: "queued" });

    expect(jobsToStart(chain, closed, 5)).toEqual([]);
    expect(waitingUpdates(chain, closed)).toEqual(
      new Map([
        ["b", { state: "blocked", blockedReason: "dependency a is closed" }],
        ["c", { state: "blocked", blockedReason: "dependency b is blocked" }],
      ]),
    );
    expect(waitingUpdates(chain, jobs({ a: "done", b: "blocked", c: "blocked" }))).toEqual(
      new Map([
        ["b", { state: "queued", blockedReason: null }],
        ["c", { state: "queued", blockedReason: null }],
      ]),
    );
  });
});

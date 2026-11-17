import { describe, expect, it } from "vitest";
import { jobsToStart, waitingUpdates, type SchedulableJob } from "./scheduling.ts";
import type { JobState } from "./states.ts";

function jobs(states: Record<string, JobState>): Map<string, SchedulableJob> {
  return new Map(
    Object.entries(states).map(([id, state]) => [id, { id, state, blockedReason: null }]),
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

  it("leaves jobs waiting on a paused dependency queued", () => {
    expect(
      waitingUpdates(chain, jobs({ a: "paused", b: "queued", c: "queued", d: "queued" })).size,
    ).toBe(0);
  });
});

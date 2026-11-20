import { describe, expect, it } from "vitest";
import { filterJobs } from "./job-filter.ts";

const day = (n: number) => new Date(Date.UTC(2026, 10, n));

const jobs = [
  { id: "a", state: "running", repoPath: "/r1", updatedAt: day(10) },
  { id: "b", state: "merged", repoPath: "/r1", updatedAt: day(18) },
  { id: "c", state: "failed", repoPath: "/r2", updatedAt: day(18) },
  { id: "d", state: "cancelled", repoPath: "/r1", updatedAt: day(5) },
  { id: "e", state: "closed", repoPath: "/r2", updatedAt: day(19) },
  { id: "f", state: "queued", repoPath: "/r1", updatedAt: day(19) },
];

const ids = (result: { jobs: Array<{ id: string }> }) => result.jobs.map((job) => job.id);

describe("filterJobs", () => {
  it("hides finished jobs and counts only the ones the other filters kept", () => {
    expect(filterJobs(jobs, {})).toMatchObject({ hidden: 3 });
    expect(ids(filterJobs(jobs, {}))).toEqual(["a", "c", "f"]);

    const result = filterJobs(jobs, { since: day(15), repo: "/r1" });

    expect(ids(result)).toEqual(["f"]);
    expect(result.hidden).toBe(1);
  });

  it("shows exactly the named states, finished ones included", () => {
    expect(filterJobs(jobs, { states: ["merged"] })).toEqual({ jobs: [jobs[1]], hidden: 0 });
    expect(ids(filterJobs(jobs, { states: ["queued", "running"], all: true }))).toEqual(["a", "f"]);
  });

  it("shows every state with all", () => {
    expect(filterJobs(jobs, { all: true })).toEqual({ jobs, hidden: 0 });
  });

  it("keeps a job updated exactly at since", () => {
    expect(ids(filterJobs(jobs, { since: day(18), all: true }))).toEqual(["b", "c", "e", "f"]);
  });
});

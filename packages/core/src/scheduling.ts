import type { DependencyGraph } from "./graph.ts";
import { BLOCKING_STATES, type JobState } from "./states.ts";

export interface StackedJob {
  key: number;
  repoPath: string;
  branchName: string;
  prBaseBranch: string | null;
  state: string;
}

export function stackedOn(job: StackedJob, parent: StackedJob): boolean {
  return (
    job.repoPath === parent.repoPath &&
    job.key !== parent.key &&
    job.prBaseBranch === parent.branchName &&
    job.state !== "merged" &&
    job.state !== "cancelled"
  );
}

export interface SchedulableJob {
  id: string;
  state: JobState;
  blockedReason: string | null;
  prUrl: string | null;
}

function dependencySatisfied(job: SchedulableJob | undefined): boolean {
  return (
    job !== undefined && job.prUrl !== null && job.state !== "closed" && job.state !== "cancelled"
  );
}

export type WaitingState =
  | { state: "queued"; blockedReason: null }
  | { state: "blocked"; blockedReason: string };

function waitingState(
  graph: DependencyGraph,
  jobs: ReadonlyMap<string, SchedulableJob>,
  id: string,
): WaitingState {
  if (jobs.get(id)?.prUrl) {
    return { state: "queued", blockedReason: null };
  }

  for (const dep of graph.get(id) ?? []) {
    const job = jobs.get(dep);
    const state = job?.state;

    if (dependencySatisfied(job)) {
      continue;
    }

    if (state !== undefined && BLOCKING_STATES.includes(state)) {
      return { state: "blocked", blockedReason: `dependency ${dep} is ${state}` };
    }

    if (state === "blocked") {
      return { state: "blocked", blockedReason: `dependency ${dep} is blocked` };
    }
  }

  return { state: "queued", blockedReason: null };
}

export function waitingUpdates(
  graph: DependencyGraph,
  jobs: ReadonlyMap<string, SchedulableJob>,
): Map<string, WaitingState> {
  const current = new Map(jobs);
  const updates = new Map<string, WaitingState>();
  let changed = true;

  while (changed) {
    changed = false;

    for (const job of current.values()) {
      if (job.state !== "queued" && job.state !== "blocked") {
        continue;
      }

      const next = waitingState(graph, current, job.id);

      if (next.state !== job.state || next.blockedReason !== job.blockedReason) {
        current.set(job.id, { ...job, ...next });
        updates.set(job.id, next);
        changed = true;
      }
    }
  }

  return updates;
}

function dependenciesSatisfied(
  graph: DependencyGraph,
  jobs: ReadonlyMap<string, SchedulableJob>,
  id: string,
): boolean {
  return (
    Boolean(jobs.get(id)?.prUrl) ||
    (graph.get(id) ?? []).every((dep) => dependencySatisfied(jobs.get(dep)))
  );
}

export function jobsToStart(
  graph: DependencyGraph,
  jobs: ReadonlyMap<string, SchedulableJob>,
  slots: number,
): string[] {
  const start: string[] = [];

  for (const job of jobs.values()) {
    if (start.length >= slots) {
      break;
    }

    if (job.state === "queued" && dependenciesSatisfied(graph, jobs, job.id)) {
      start.push(job.id);
    }
  }

  return start;
}

import type { DependencyGraph } from "./graph.ts";
import { BLOCKING_STATES, type JobState } from "./states.ts";

export interface SchedulableJob {
  id: string;
  state: JobState;
  blockedReason: string | null;
}

export type WaitingState =
  | { state: "queued"; blockedReason: null }
  | { state: "blocked"; blockedReason: string };

function waitingState(
  graph: DependencyGraph,
  jobs: ReadonlyMap<string, SchedulableJob>,
  id: string,
): WaitingState {
  for (const dep of graph.get(id) ?? []) {
    const state = jobs.get(dep)?.state;

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
  return (graph.get(id) ?? []).every((dep) => jobs.get(dep)?.state === "done");
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

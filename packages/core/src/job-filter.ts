import { FINISHED_STATES, type JobState } from "./states.ts";

export interface JobFilter {
  since?: Date;
  states?: readonly JobState[];
  repo?: string;
  all?: boolean;
}

interface FilterableJob {
  state: string;
  repoPath: string;
  updatedAt: Date;
}

export function filterJobs<T extends FilterableJob>(
  jobs: readonly T[],
  { since, states, repo, all }: JobFilter,
): { jobs: T[]; hidden: number } {
  const matching = jobs.filter(
    (job) =>
      (!since || job.updatedAt.getTime() >= since.getTime()) && (!repo || job.repoPath === repo),
  );

  if (states) {
    return { jobs: matching.filter((job) => states.includes(job.state as JobState)), hidden: 0 };
  }

  if (all) {
    return { jobs: matching, hidden: 0 };
  }

  const shown = matching.filter((job) => !FINISHED_STATES.includes(job.state as JobState));

  return { jobs: shown, hidden: matching.length - shown.length };
}

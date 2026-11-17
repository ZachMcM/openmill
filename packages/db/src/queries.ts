import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "./client.ts";
import { jobDependencies, jobs, runs, type Job, type NewJob, type Run } from "./schema.ts";

export type Queryable = Pick<Db, "select" | "insert" | "update" | "delete">;

export function listJobs(db: Queryable): Job[] {
  return db.select().from(jobs).orderBy(asc(jobs.createdAt), asc(jobs.key)).all();
}

export function getJob(db: Queryable, key: number): Job | undefined {
  return db.select().from(jobs).where(eq(jobs.key, key)).get();
}

export function findJobsById(db: Queryable, id: string): Job[] {
  return db.select().from(jobs).where(eq(jobs.id, id)).orderBy(asc(jobs.key)).all();
}

export function findJob(db: Queryable, repoPath: string, id: string): Job | undefined {
  return db
    .select()
    .from(jobs)
    .where(and(eq(jobs.repoPath, repoPath), eq(jobs.id, id)))
    .get();
}

export function insertJob(db: Queryable, job: NewJob): Job {
  return db.insert(jobs).values(job).returning().get();
}

export function updateJob(db: Queryable, key: number, patch: Partial<NewJob>): void {
  db.update(jobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(jobs.key, key))
    .run();
}

export function listDependencies(db: Queryable): Array<[number, number]> {
  return db
    .select()
    .from(jobDependencies)
    .all()
    .map((edge) => [edge.jobKey, edge.dependsOnKey]);
}

export function setDependencies(db: Queryable, jobKey: number, dependsOnKeys: number[]): void {
  db.delete(jobDependencies).where(eq(jobDependencies.jobKey, jobKey)).run();

  if (dependsOnKeys.length > 0) {
    db.insert(jobDependencies)
      .values(dependsOnKeys.map((dependsOnKey) => ({ jobKey, dependsOnKey })))
      .run();
  }
}

export function insertRun(db: Queryable, run: typeof runs.$inferInsert): Run {
  return db.insert(runs).values(run).returning().get();
}

export function updateRun(
  db: Queryable,
  id: number,
  patch: Partial<typeof runs.$inferInsert>,
): void {
  db.update(runs).set(patch).where(eq(runs.id, id)).run();
}

export function latestRun(db: Queryable, jobKey: number): Run | undefined {
  return db.select().from(runs).where(eq(runs.jobKey, jobKey)).orderBy(desc(runs.id)).get();
}

export function latestRuns(db: Queryable, jobKeys: number[]): Map<number, Run> {
  const latest = new Map<number, Run>();

  if (jobKeys.length === 0) {
    return latest;
  }

  for (const run of db
    .select()
    .from(runs)
    .where(inArray(runs.jobKey, jobKeys))
    .orderBy(asc(runs.id))
    .all()) {
    latest.set(run.jobKey, run);
  }

  return latest;
}

export function unfinishedRuns(db: Queryable): Run[] {
  return db.select().from(runs).where(isNull(runs.endedAt)).orderBy(asc(runs.id)).all();
}

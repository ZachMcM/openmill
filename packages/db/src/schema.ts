import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch('subsec') * 1000)`;

export const jobs = sqliteTable(
  "jobs",
  {
    key: integer().primaryKey({ autoIncrement: true }),
    id: text().notNull(),
    repoPath: text().notNull(),
    docPath: text().notNull(),
    docSnapshot: text().notNull(),
    projectSnapshot: text(),
    baseBranch: text(),
    prBaseBranch: text(),
    requestedBase: text(),
    branchName: text().notNull(),
    worktreePath: text().notNull(),
    harness: text(),
    model: text(),
    effort: text(),
    state: text().notNull().default("queued"),
    blockedReason: text(),
    prUrl: text(),
    sessionId: text(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull().default(now),
    updatedAt: integer({ mode: "timestamp_ms" }).notNull().default(now),
  },
  (table) => [uniqueIndex("jobs_repo_id").on(table.repoPath, table.id)],
);

export const jobDependencies = sqliteTable(
  "job_dependencies",
  {
    jobKey: integer()
      .notNull()
      .references(() => jobs.key, { onDelete: "cascade" }),
    dependsOnKey: integer()
      .notNull()
      .references(() => jobs.key, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.jobKey, table.dependsOnKey] }),
    index("job_dependencies_depends_on").on(table.dependsOnKey),
  ],
);

export const runs = sqliteTable(
  "runs",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    jobKey: integer()
      .notNull()
      .references(() => jobs.key, { onDelete: "cascade" }),
    harness: text().notNull(),
    model: text(),
    effort: text().notNull(),
    sessionId: text(),
    recovery: integer({ mode: "boolean" }).notNull().default(false),
    startedAt: integer({ mode: "timestamp_ms" }).notNull().default(now),
    endedAt: integer({ mode: "timestamp_ms" }),
    result: text({ mode: "json" }).$type<RunResultRecord>(),
  },
  (table) => [index("runs_job").on(table.jobKey)],
);

export interface RunResultRecord {
  status: "done" | "needs_input" | "failed" | "stopped" | "interrupted";
  pr_url?: string;
  reason?: string;
}

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Run = typeof runs.$inferSelect;

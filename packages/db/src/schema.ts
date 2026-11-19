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
    agent: text(),
    permissionMode: text(),
    terminal: text(),
    model: text(),
    effort: text(),
    state: text().notNull().default("queued"),
    blockedReason: text(),
    prUrl: text(),
    sessionId: text(),
    nextRun: text({ mode: "json" }).$type<NextRunRecord>(),
    restack: text({ mode: "json" }).$type<RestackRecord>(),
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
    agent: text().notNull(),
    model: text(),
    effort: text().notNull(),
    kind: text().notNull().default("feature").$type<RunKindRecord>(),
    trigger: text({ mode: "json" }).$type<TriggerRecord>(),
    gate: text().$type<GateRecord>(),
    startSha: text(),
    sessionId: text(),
    blockId: text(),
    transcriptPath: text(),
    busy: integer({ mode: "boolean" }).notNull().default(false),
    waitingSince: integer({ mode: "timestamp_ms" }),
    startedAt: integer({ mode: "timestamp_ms" }).notNull().default(now),
    endedAt: integer({ mode: "timestamp_ms" }),
    result: text({ mode: "json" }).$type<RunResultRecord>(),
  },
  (table) => [index("runs_job").on(table.jobKey)],
);

export const prObservations = sqliteTable("pr_observations", {
  jobKey: integer()
    .primaryKey()
    .references(() => jobs.key, { onDelete: "cascade" }),
  prUrl: text().notNull(),
  polledAt: integer({ mode: "timestamp_ms" }).notNull(),
  state: text().notNull(),
  headSha: text().notNull(),
  checks: text({ mode: "json" }).notNull().$type<ChecksRecord>(),
  unresolvedThreads: text({ mode: "json" }).notNull().$type<string[]>(),
  latestReviewId: text(),
  readyNotifiedSha: text(),
  mergeable: integer({ mode: "boolean" }),
});

export interface ChecksRecord {
  state: string | null;
  checks: Array<{ name: string; status: string; conclusion: string | null; kind?: "status" }>;
}

export type RunKindRecord = "feature" | "followup" | "restack";

export type GateRecord = "closed" | "open";

export interface TriggerRecord {
  reviewId: string | null;
  threads: string[];
  checks: string[];
  headSha: string;
}

export interface NextRunRecord {
  kind: Exclude<RunKindRecord, "feature">;
  trigger: TriggerRecord | null;
  gate: GateRecord | null;
  startSha: string | null;
  resume: boolean;
  message?: string;
}

export interface RestackRecord {
  base: string;
  cut: string;
}

export interface RunResultRecord {
  status: "done" | "needs_input" | "failed" | "cancelled";
  reason?: string;
}

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type PrObservationRow = typeof prObservations.$inferSelect;
export type NewPrObservationRow = typeof prObservations.$inferInsert;

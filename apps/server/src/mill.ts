import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pluginDir } from "@openmill/assets";
import {
  HAND_OFF_STATES,
  REQUEUEABLE_STATES,
  UPDATABLE_STATES,
  assertTransition,
  checkGraph,
  jobsToStart,
  stackParent,
  waitingUpdates,
  type Config,
  type ConfigKey,
  type Effort,
  type JobState,
  type SchedulableJob,
} from "@openmill/core";
import {
  findJob,
  findJobsById,
  getJob,
  insertJob,
  insertRun,
  latestRun,
  latestRuns,
  listDependencies,
  listJobs,
  setDependencies,
  unfinishedRuns,
  updateJob,
  updateRun,
  type Db,
  type Job,
  type Run,
  type RunResultRecord,
} from "@openmill/db";
import type { AddAction, AddRequest, JobDetail, JobSummary } from "./api.ts";
import { writeConfigValue } from "./config-store.ts";
import { ApiError } from "./errors.ts";
import { ensureWorktree, fetchDefaultBranch, gitRoot, withRepoLock } from "./git.ts";
import type { GitHub } from "./github.ts";
import { loadClaudeAgents } from "./harness/agents.ts";
import { HANDBACK_MESSAGE, RESTART_MESSAGE } from "./harness/prompt.ts";
import type { Harness, HarnessEvent, RunInput, RunResult } from "./harness/types.ts";
import { branchName, jobDir, worktreePath, type Paths } from "./paths.ts";

type AbortReason = "stop" | "requeue" | "shutdown";

type RunMode = { kind: "start" } | { kind: "resume"; sessionId: string; message: string };

export interface MillOptions {
  db: Db;
  paths: Paths;
  config: Config;
  harnesses: Record<string, Harness>;
  github: GitHub;
  log?: (message: string) => void;
}

export class Mill {
  private readonly db: Db;
  private readonly paths: Paths;
  private readonly harnesses: Record<string, Harness>;
  private readonly github: GitHub;
  private readonly log: (message: string) => void;
  private readonly active = new Map<number, { controller: AbortController; done: Promise<void> }>();
  private config: Config;
  private closed = false;

  constructor(options: MillOptions) {
    this.db = options.db;
    this.paths = options.paths;
    this.config = options.config;
    this.harnesses = options.harnesses;
    this.github = options.github;
    this.log = options.log ?? (() => {});
  }

  async add(request: AddRequest): Promise<Array<{ id: string; action: AddAction }>> {
    let repoPath: string;

    try {
      repoPath = await gitRoot(request.repo);
    } catch {
      throw new ApiError(400, `${request.repo} is not inside a git repository; pass --repo`);
    }

    const ids = new Set<string>();

    for (const doc of request.docs) {
      if (ids.has(doc.id)) {
        throw new ApiError(400, `two docs in the batch share the id ${doc.id}`);
      }

      ids.add(doc.id);
    }

    const existing = new Map(
      listJobs(this.db)
        .filter((job) => job.repoPath === repoPath)
        .map((job) => [job.id, job]),
    );
    const plan = request.docs.map((doc) => {
      const job = existing.get(doc.id);

      return { doc, job, action: planAction(doc, job, request.force) };
    });
    const rejected = plan.filter((entry) => entry.action === "rejected");

    if (rejected.length > 0) {
      const list = rejected.map((entry) => `${entry.doc.id} (${entry.job?.state})`).join(", ");

      throw new ApiError(409, `already started: ${list}. Pass --force to re-queue.`);
    }

    const graph = this.repoGraph(repoPath);

    for (const { doc, action } of plan) {
      if (action !== "unchanged") {
        graph.set(doc.id, doc.dependsOn);
      }
    }

    const check = checkGraph(graph, graph.keys());

    if (!check.ok) {
      throw new ApiError(400, check.error);
    }

    const aborts: number[] = [];

    this.db.transaction((tx) => {
      const keys = new Map([...existing].map(([id, job]) => [id, job.key]));
      const touched: Array<{ key: number; dependsOn: string[] }> = [];

      for (const { doc, job, action } of plan) {
        const fields = {
          docPath: doc.path,
          docSnapshot: doc.content,
          projectSnapshot: doc.project?.content ?? null,
          ...(request.base ? { requestedBase: request.base } : {}),
          ...(request.harness ? { harness: request.harness } : {}),
          ...(request.model ? { model: request.model } : {}),
          ...(request.effort ? { effort: request.effort } : {}),
        };

        if (action === "added") {
          const row = insertJob(tx, {
            id: doc.id,
            repoPath,
            branchName: branchName(doc.id),
            worktreePath: worktreePath(this.paths, repoPath, doc.id),
            ...fields,
          });

          keys.set(doc.id, row.key);
          touched.push({ key: row.key, dependsOn: doc.dependsOn });
        } else if (job && action === "updated") {
          updateJob(tx, job.key, fields);
          touched.push({ key: job.key, dependsOn: doc.dependsOn });
        } else if (job && action === "requeued") {
          assertTransition(job.state as JobState, "queued");
          updateJob(tx, job.key, {
            ...fields,
            state: "queued",
            blockedReason: null,
            prUrl: null,
            sessionId: null,
          });
          touched.push({ key: job.key, dependsOn: doc.dependsOn });

          if (job.state === "running") {
            aborts.push(job.key);
          }
        }
      }

      for (const { key, dependsOn } of touched) {
        setDependencies(
          tx,
          key,
          dependsOn.map((id) => keys.get(id) as number),
        );
      }
    });

    for (const key of aborts) {
      this.active.get(key)?.controller.abort("requeue" satisfies AbortReason);
    }

    this.schedule();

    return plan.map(({ doc, action }) => ({ id: doc.id, action: action as AddAction }));
  }

  async list(): Promise<JobSummary[]> {
    await this.detectHandFinished(listJobs(this.db));

    const jobs = listJobs(this.db);
    const runs = latestRuns(
      this.db,
      jobs.map((job) => job.key),
    );

    return jobs.map((job) => summary(job, runs.get(job.key)));
  }

  async resolve(id: string, repo?: string): Promise<Job> {
    const matches = findJobsById(this.db, id);

    if (matches.length === 0) {
      throw new ApiError(404, `no job with id ${id}`);
    }

    if (matches.length === 1) {
      return matches[0] as Job;
    }

    const root = repo ? await gitRoot(repo).catch(() => undefined) : undefined;
    const match = matches.find((job) => job.repoPath === root);

    if (!match) {
      const repos = matches.map((job) => job.repoPath).join(", ");

      throw new ApiError(
        409,
        `${id} exists in several repos (${repos}); run the command inside one or pass --repo`,
      );
    }

    return match;
  }

  show(job: Job): JobDetail {
    const run = latestRun(this.db, job.key);
    const current = getJob(this.db, job.key) ?? job;

    return {
      ...summary(current, run),
      branch: current.branchName,
      worktree: current.worktreePath,
      prBaseBranch: current.prBaseBranch,
      lastResult: run?.result ?? null,
      logPath: run ? this.logPath(current, run) : null,
      resumeCommand: current.sessionId
        ? resumeCommand(current.worktreePath, current.sessionId)
        : null,
    };
  }

  stop(job: Job): JobState {
    if (job.state !== "running") {
      const hint =
        job.state === "needs_input" || job.state === "failed" || job.state === "done"
          ? " It has no active run, so resume its session directly."
          : "";

      throw new ApiError(409, `${job.id} is ${job.state}, not running.${hint}`);
    }

    updateJob(this.db, job.key, { state: "paused" });
    this.active.get(job.key)?.controller.abort("stop" satisfies AbortReason);
    this.schedule();

    return "paused";
  }

  async requeue(job: Job): Promise<JobState> {
    if (!REQUEUEABLE_STATES.includes(job.state as JobState)) {
      throw new ApiError(
        409,
        `${job.id} is ${job.state}; only paused, needs_input, or failed jobs can be requeued`,
      );
    }

    const state = (await this.detectHandFinished([job])).has(job.key) ? "done" : "queued";

    if (state === "queued") {
      updateJob(this.db, job.key, { state: "queued", blockedReason: null });
    }

    this.schedule();

    return state;
  }

  getConfig(): Config {
    return this.config;
  }

  async setConfig(key: ConfigKey, value: Config[ConfigKey]): Promise<Config> {
    this.config = await writeConfigValue(this.paths.config, key, value);
    this.schedule();

    return this.config;
  }

  status(): { pid: number; running: number; queued: number } {
    const jobs = listJobs(this.db);

    return {
      pid: process.pid,
      running: this.active.size,
      queued: jobs.filter((job) => job.state === "queued").length,
    };
  }

  schedule(): void {
    if (this.closed) {
      return;
    }

    const jobs = listJobs(this.db);
    const byKey = new Map(jobs.map((job) => [job.key, job]));
    const repos = Map.groupBy(jobs, (job) => job.repoPath);
    const starts: Job[] = [];
    let slots = this.config.concurrency - this.active.size;

    const edges = listDependencies(this.db);

    for (const repoJobs of repos.values()) {
      const graph = graphFor(repoJobs, byKey, edges);
      const byId = new Map(repoJobs.map((job) => [job.id, job]));
      const states = new Map<string, SchedulableJob>(
        repoJobs.map((job) => [
          job.id,
          {
            id: job.id,
            state: this.active.has(job.key) ? "running" : (job.state as JobState),
            blockedReason: job.blockedReason,
          },
        ]),
      );

      for (const [id, update] of waitingUpdates(graph, states)) {
        updateJob(this.db, (byId.get(id) as Job).key, update);
        states.set(id, { id, ...update });
      }

      for (const id of jobsToStart(graph, states, Math.max(0, slots))) {
        starts.push(byId.get(id) as Job);
        slots -= 1;
      }
    }

    for (const job of starts) {
      this.launch(
        job,
        job.sessionId
          ? { kind: "resume", sessionId: job.sessionId, message: HANDBACK_MESSAGE }
          : { kind: "start" },
      );
    }
  }

  recover(): void {
    for (const run of unfinishedRuns(this.db)) {
      const job = getJob(this.db, run.jobKey);

      if (!job || job.state !== "running") {
        updateRun(this.db, run.id, { endedAt: new Date(), result: { status: "interrupted" } });
        continue;
      }

      if (!run.sessionId || run.recovery) {
        const reason = run.sessionId
          ? "the server stopped again while resuming this run after a restart"
          : "the server stopped before the run reported a session id";

        updateRun(this.db, run.id, { endedAt: new Date(), result: { status: "failed", reason } });
        updateJob(this.db, job.key, { state: "failed" });
        continue;
      }

      updateRun(this.db, run.id, { endedAt: new Date(), result: { status: "interrupted" } });
      this.launch(
        job,
        { kind: "resume", sessionId: run.sessionId, message: RESTART_MESSAGE },
        true,
      );
    }

    this.schedule();
  }

  async close(): Promise<void> {
    this.closed = true;

    const runs = [...this.active.values()];

    for (const { controller } of runs) {
      controller.abort("shutdown" satisfies AbortReason);
    }

    await Promise.allSettled(runs.map((run) => run.done));
  }

  private launch(job: Job, mode: RunMode, recovery = false): void {
    const harness = job.harness ?? this.config.harness;
    const effort = (job.effort ?? this.config.effort) as Effort;
    const model = job.model ?? this.config.model ?? null;

    updateJob(this.db, job.key, { state: "running", blockedReason: null });

    const run = insertRun(this.db, {
      jobKey: job.key,
      harness,
      model,
      effort,
      recovery,
      sessionId: mode.kind === "resume" ? mode.sessionId : null,
    });
    const controller = new AbortController();
    const done = this.execute(job, run, mode, controller.signal)
      .catch((error: unknown) => this.log(`run ${run.id} crashed: ${String(error)}`))
      .finally(() => {
        this.active.delete(job.key);
        this.schedule();
      });

    this.active.set(job.key, { controller, done });
  }

  private async execute(job: Job, run: Run, mode: RunMode, signal: AbortSignal): Promise<void> {
    let result: RunResult | undefined;
    let error: string | undefined;

    const dir = jobDir(this.paths, job.repoPath, job.id);
    const logFile = this.logPath(job, run);

    await mkdir(join(dir, "runs"), { recursive: true });

    const log = createWriteStream(logFile, { flags: "a" });

    try {
      const harness = this.harnesses[run.harness];

      if (!harness) {
        throw new Error(`unknown harness ${run.harness}`);
      }

      const input = await this.prepare(job, run, dir);
      const events: AsyncIterable<HarnessEvent> =
        mode.kind === "start"
          ? harness.start(input, signal)
          : harness.resume(mode.sessionId, mode.message, input, signal);

      for await (const event of events) {
        switch (event.type) {
          case "message":
            log.write(`${JSON.stringify(event.message)}\n`);
            break;
          case "session":
            if (signal.aborted) {
              break;
            }

            updateRun(this.db, run.id, { sessionId: event.sessionId });
            updateJob(this.db, job.key, { sessionId: event.sessionId });
            break;
          case "result":
            result = event.result;
            break;
          case "error":
            error = event.error;
            break;
        }
      }
    } catch (caught) {
      error = (caught as Error).message ?? String(caught);
    } finally {
      await new Promise((resolve) => log.end(resolve));
    }

    if (signal.aborted) {
      if ((signal.reason as AbortReason) !== "shutdown") {
        updateRun(this.db, run.id, {
          endedAt: new Date(),
          result: { status: "stopped", reason: String(signal.reason) },
        });
      }

      return;
    }

    const record = await this.settle(job, result, error);

    updateRun(this.db, run.id, { endedAt: new Date(), result: record });
  }

  private async settle(
    job: Job,
    result: RunResult | undefined,
    error: string | undefined,
  ): Promise<RunResultRecord> {
    let record: RunResultRecord = result ?? {
      status: "failed",
      reason: error ?? "the run ended without a result",
    };

    if (record.status === "done") {
      const verified = await this.github
        .isOpenDraft(job.repoPath, record.pr_url as string)
        .catch((caught: Error) => caught);

      if (verified !== true) {
        const why = verified instanceof Error ? verified.message : "it is not an open draft";

        record = {
          ...record,
          status: "failed",
          reason: `could not verify PR ${record.pr_url}: ${why}`,
        };
      }
    }

    const current = getJob(this.db, job.key);

    if (current?.state === "running") {
      assertTransition("running", record.status as JobState);
      updateJob(this.db, job.key, {
        state: record.status,
        ...(record.status === "done" ? { prUrl: record.pr_url } : {}),
      });
    }

    return record;
  }

  private async prepare(job: Job, run: Run, dir: string): Promise<RunInput> {
    const docPath = join(dir, `${job.id}.md`);
    let projectPath: string | undefined;

    await writeFile(docPath, job.docSnapshot);

    if (job.projectSnapshot !== null) {
      projectPath = join(dir, "project.md");
      await writeFile(projectPath, job.projectSnapshot);
    }

    const prBaseBranch = await withRepoLock(job.repoPath, async () => {
      let branches = { baseBranch: job.baseBranch, prBaseBranch: job.prBaseBranch };

      if (!branches.baseBranch || !branches.prBaseBranch) {
        branches = await this.branchBase(job);
        updateJob(this.db, job.key, branches);
      }

      await ensureWorktree(
        job.repoPath,
        job.worktreePath,
        job.branchName,
        branches.baseBranch as string,
      );

      return branches.prBaseBranch as string;
    });

    return {
      id: job.id,
      worktree: job.worktreePath,
      docPath,
      projectPath,
      branch: job.branchName,
      prBaseBranch,
      model: run.model ?? undefined,
      effort: run.effort as Effort,
    };
  }

  private async branchBase(job: Job): Promise<{ baseBranch: string; prBaseBranch: string }> {
    const graph = this.repoGraph(job.repoPath);
    const parentId = stackParent(graph, job.id);

    if (parentId) {
      const parent = findJob(this.db, job.repoPath, parentId) as Job;

      return { baseBranch: parent.branchName, prBaseBranch: parent.branchName };
    }

    if (job.requestedBase) {
      return {
        baseBranch: job.requestedBase,
        prBaseBranch: job.requestedBase.replace(/^origin\//, ""),
      };
    }

    const branch = await fetchDefaultBranch(job.repoPath);

    return { baseBranch: `origin/${branch}`, prBaseBranch: branch };
  }

  private async detectHandFinished(jobs: Job[]): Promise<Set<number>> {
    const candidates = jobs.filter((job) => HAND_OFF_STATES.includes(job.state as JobState));
    const found = await Promise.all(
      candidates.map((job) =>
        this.github.findOpenDraft(job.repoPath, job.branchName).catch((error: unknown) => {
          this.log(`gh pr list for ${job.id} failed: ${String(error)}`);

          return undefined;
        }),
      ),
    );
    const moved = new Set<number>();

    candidates.forEach((job, index) => {
      const url = found[index];
      const current = getJob(this.db, job.key);

      if (url && current && HAND_OFF_STATES.includes(current.state as JobState)) {
        updateJob(this.db, job.key, { state: "done", prUrl: url });
        moved.add(job.key);
      }
    });

    if (moved.size > 0) {
      this.schedule();
    }

    return moved;
  }

  private logPath(job: Job, run: Run): string {
    return join(jobDir(this.paths, job.repoPath, job.id), "runs", `${run.id}.jsonl`);
  }

  private repoGraph(repoPath: string): Map<string, string[]> {
    const jobs = listJobs(this.db);

    return graphFor(
      jobs.filter((job) => job.repoPath === repoPath),
      new Map(jobs.map((job) => [job.key, job])),
      listDependencies(this.db),
    );
  }
}

function graphFor(
  repoJobs: Job[],
  byKey: ReadonlyMap<number, Job>,
  edges: Array<[number, number]>,
): Map<string, string[]> {
  const graph = new Map<string, string[]>(repoJobs.map((job) => [job.id, []]));

  for (const [jobKey, dependsOnKey] of edges) {
    const job = byKey.get(jobKey);
    const dep = byKey.get(dependsOnKey);

    if (job && dep && graph.has(job.id)) {
      graph.get(job.id)?.push(dep.id);
    }
  }

  return graph;
}

type PlannedAction = AddAction | "rejected";

function planAction(
  doc: AddRequest["docs"][number],
  job: Job | undefined,
  force: boolean,
): PlannedAction {
  if (!job) {
    return "added";
  }

  if (!doc.explicit) {
    return "unchanged";
  }

  if (UPDATABLE_STATES.includes(job.state as JobState)) {
    return "updated";
  }

  if (force && job.state !== "cancelled") {
    return "requeued";
  }

  return "rejected";
}

function summary(job: Job, run: Run | undefined): JobSummary {
  const runReason =
    job.state === "needs_input" || job.state === "failed" ? (run?.result?.reason ?? null) : null;

  return {
    id: job.id,
    repo: job.repoPath,
    state: job.state,
    reason: job.blockedReason ?? runReason,
    sessionId: job.sessionId,
    prUrl: job.prUrl,
  };
}

function resumeCommand(worktree: string, sessionId: string): string {
  return [
    "cd",
    shellQuote(worktree),
    "&&",
    "claude",
    "--resume",
    shellQuote(sessionId),
    "--plugin-dir",
    shellQuote(pluginDir),
    "--agents",
    shellQuote(JSON.stringify(loadClaudeAgents())),
  ].join(" ");
}

function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

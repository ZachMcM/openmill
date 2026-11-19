import { existsSync } from "node:fs";
import {
  CLEANABLE_STATES,
  DEFAULT_CONFIG,
  HAND_OFF_STATES,
  REQUEUEABLE_STATES,
  SESSION_STATES,
  UPDATABLE_STATES,
  assertTransition,
  canTransition,
  checkGraph,
  jobsToStart,
  resolveEffort,
  waitingUpdates,
  type AgentName,
  type Config,
  type ConfigKey,
  type EffortCheck,
  type JobState,
  type SchedulableJob,
} from "@openmill/core";
import {
  findJobsById,
  getJob,
  insertJob,
  latestRun,
  latestRuns,
  listDependencies,
  listJobs,
  setDependencies,
  updateJob,
  updateRun,
  type Db,
  type Job,
  type NextRunRecord,
  type Run,
} from "@openmill/db";
import { APPROVED_MESSAGE } from "./agent/prompt.ts";
import type { Agent } from "./agent/types.ts";
import type { AddAction, AddRequest, JobDetail, JobSummary } from "./api.ts";
import { writeConfigValue } from "./config-store.ts";
import { ApiError } from "./errors.ts";
import { gitRoot } from "./git.ts";
import type { GitHub } from "./github.ts";
import type { MillContext } from "./mill/context.ts";
import { applyPrEvents, completeFollowup, followUp } from "./mill/followups.ts";
import { followupState, handleHook, sessionGone } from "./mill/hooks.ts";
import {
  capturePath,
  closeWindow,
  endRun,
  fail,
  findDraft,
  finish,
  inSession,
  transition,
} from "./mill/lifecycle.ts";
import { graphFor, launch, repoGraph } from "./mill/session.ts";
import { createNotifier } from "./notify.ts";
import { branchName, worktreePath, type Paths } from "./paths.ts";
import type { Terminal } from "./terminal/types.ts";
import { PrWatcher } from "./watcher.ts";

export interface MillOptions {
  db: Db;
  paths: Paths;
  config: Config;
  terminal: Terminal;
  agents: Record<AgentName, Agent>;
  github: GitHub;
  hookCommand: string[];
  log?: (message: string) => void;
  debug?: (message: string) => void;
}

export class Mill {
  private readonly ctx: MillContext;
  private readonly watcher: PrWatcher;
  private closed = false;

  constructor({ log = () => {}, debug = () => {}, ...options }: MillOptions) {
    this.ctx = {
      ...options,
      log,
      notifier: createNotifier(log),
      preparing: new Set(),
      staleHeads: new Map(),
      schedule: () => this.schedule(),
    };
    this.watcher = new PrWatcher({
      db: options.db,
      github: options.github,
      config: () => this.ctx.config,
      onChange: (job, events, observation) => {
        applyPrEvents(this.ctx, job.key, events, observation);
        this.schedule();
      },
      log,
      debug,
    });
  }

  async add(request: AddRequest): Promise<Array<{ id: string; action: AddAction }>> {
    const { db, paths } = this.ctx;
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
      listJobs(db)
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

    const graph = repoGraph(this.ctx, repoPath);

    for (const { doc, action } of plan) {
      if (action !== "unchanged") {
        graph.set(doc.id, doc.dependsOn);
      }
    }

    const check = checkGraph(graph, graph.keys());

    if (!check.ok) {
      throw new ApiError(400, check.error);
    }

    const superseded: Run[] = [];

    for (const { job, action } of plan) {
      const run = job && action === "requeued" ? latestRun(db, job.key) : undefined;

      if (job && run && SESSION_STATES.includes(job.state as JobState)) {
        await endRun(this.ctx, job, run, { status: "cancelled", reason: "re-queued with --force" });
        superseded.push(run);
      }
    }

    const resolved = {
      agent: request.agent ?? this.ctx.config.agent,
      permissionMode: request.permissionMode ?? this.ctx.config.permission_mode,
    };
    const effort = await this.checkEffort({
      ...this.ctx.config,
      agent: resolved.agent,
      model: request.model ?? this.ctx.config.model,
      effort: request.effort ?? this.ctx.config.effort,
    });

    if (!effort.ok) {
      throw new ApiError(400, effort.error);
    }

    db.transaction((tx) => {
      const keys = new Map([...existing].map(([id, job]) => [id, job.key]));
      const touched: Array<{ key: number; dependsOn: string[] }> = [];

      for (const { doc, job, action } of plan) {
        const fields = {
          docPath: doc.path,
          docSnapshot: doc.content,
          projectSnapshot: doc.project?.content ?? null,
          ...(request.base ? { requestedBase: request.base } : {}),
          ...(request.agent ? { agent: request.agent } : {}),
          ...(request.permissionMode ? { permissionMode: request.permissionMode } : {}),
          ...(request.model ? { model: request.model } : {}),
          ...(request.effort ? { effort: request.effort } : {}),
        };

        if (action === "added") {
          const row = insertJob(tx, {
            id: doc.id,
            repoPath,
            branchName: branchName(doc.id),
            worktreePath: worktreePath(paths, repoPath, doc.id),
            ...fields,
            ...resolved,
          });

          keys.set(doc.id, row.key);
          touched.push({ key: row.key, dependsOn: doc.dependsOn });
        } else if (job && action === "updated") {
          updateJob(tx, job.key, fields);
          touched.push({ key: job.key, dependsOn: doc.dependsOn });
        } else if (job && action === "requeued") {
          assertTransition(getJob(tx, job.key)?.state as JobState, "queued");
          updateJob(tx, job.key, {
            ...fields,
            ...resolved,
            state: "queued",
            blockedReason: null,
            prUrl: null,
            sessionId: null,
            nextRun: null,
            restack: null,
          });
          touched.push({ key: job.key, dependsOn: doc.dependsOn });
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

    for (const run of superseded) {
      await closeWindow(this.ctx, run);
    }

    this.schedule();

    return plan.map(({ doc, action }) => ({ id: doc.id, action: action as AddAction }));
  }

  async list(): Promise<JobSummary[]> {
    const { db } = this.ctx;

    if ((await this.detectHandFinished(listJobs(db))).size > 0) {
      this.schedule();
    }

    const jobs = listJobs(db);
    const runs = latestRuns(
      db,
      jobs.map((job) => job.key),
    );

    return jobs.map((job) => summary(job, runs.get(job.key)));
  }

  async resolve(id: string, repo?: string): Promise<Job> {
    const matches = findJobsById(this.ctx.db, id);

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
    const run = latestRun(this.ctx.db, job.key);
    const current = getJob(this.ctx.db, job.key) ?? job;
    const capture = run ? capturePath(this.ctx, current, run) : undefined;

    return {
      ...summary(current, run),
      branch: current.branchName,
      worktree: current.worktreePath,
      prBaseBranch: current.prBaseBranch,
      window: run?.blockId ? current.id : null,
      transcriptPath: run?.transcriptPath ?? null,
      capturePath: capture && existsSync(capture) ? capture : null,
      lastResult: run?.result ?? null,
    };
  }

  async open(job: Job): Promise<void> {
    const blockId = latestRun(this.ctx.db, job.key)?.blockId;

    if (!blockId) {
      throw new ApiError(409, `${job.id} has no window`);
    }

    const blocks = await this.ctx.terminal.list();

    if (!blocks.some((block) => block.blockId === blockId)) {
      throw new ApiError(409, `${job.id}'s window is closed`);
    }

    await this.ctx.terminal.focus(blockId);
  }

  async cancel(job: Job): Promise<JobState> {
    if (!canTransition(job.state as JobState, "cancelled")) {
      throw new ApiError(409, `${job.id} is ${job.state} and can't be cancelled`);
    }

    const run = latestRun(this.ctx.db, job.key);

    if (run) {
      await endRun(this.ctx, job, run, { status: "cancelled" });
    }

    transition(this.ctx, job.key, { to: "cancelled", fields: { blockedReason: null } });

    if (run) {
      await closeWindow(this.ctx, run);
    }

    this.schedule();

    return "cancelled";
  }

  async clean(): Promise<number> {
    const { db, terminal } = this.ctx;
    const open = new Set((await terminal.list()).map((block) => block.blockId));
    const jobs = listJobs(db).filter((job) => CLEANABLE_STATES.includes(job.state as JobState));
    const runs = latestRuns(
      db,
      jobs.map((job) => job.key),
    );
    let closed = 0;

    for (const job of jobs) {
      const run = runs.get(job.key);

      if (run?.blockId && open.has(run.blockId)) {
        await endRun(this.ctx, job, run, run.result ?? { status: "done" });
        await closeWindow(this.ctx, run);
        closed += 1;
      }
    }

    return closed;
  }

  async requeue(job: Job): Promise<JobState> {
    const { db } = this.ctx;

    if ((await this.detectHandFinished([job])).has(job.key)) {
      this.schedule();

      return "done";
    }

    const current = getJob(db, job.key);
    const state = current?.state as JobState | undefined;
    const run = latestRun(db, job.key);

    if (!current || !state || !REQUEUEABLE_STATES.includes(state)) {
      throw new ApiError(
        409,
        `${job.id} is ${state}; only failed, awaiting_push, and needs_input jobs can be requeued`,
      );
    }

    if (state === "needs_input") {
      if (!current.prUrl) {
        throw new ApiError(409, `${job.id} is waiting for an answer; run openmill open ${job.id}`);
      }

      if (run) {
        updateRun(db, run.id, { busy: false });
      }

      transition(this.ctx, job.key, {
        from: ["needs_input"],
        to: "done",
        fields: { blockedReason: null },
      });
      this.schedule();

      return "done";
    }

    const resume = run && run.kind !== "feature" ? resumeOf(run) : null;
    const nextRun =
      state === "awaiting_push" && resume
        ? { ...resume, gate: "open" as const, message: APPROVED_MESSAGE }
        : resume;

    transition(this.ctx, job.key, {
      from: REQUEUEABLE_STATES,
      to: "queued",
      fields: { blockedReason: null, nextRun },
    });
    this.schedule();

    return "queued";
  }

  async hook(runId: number, event: string, payload: unknown): Promise<unknown> {
    const { reply, type } = await handleHook(this.ctx, runId, event, payload);

    // Tool-use hooks fire on every agent tool call, and neither they, permission waits, nor
    // session starts change job state.
    if (type && type !== "tool_use" && type !== "permission_wait" && type !== "session_start") {
      this.schedule();
    }

    return reply;
  }

  getConfig(): Config {
    return this.ctx.config;
  }

  async setConfig(
    key: ConfigKey,
    value: Config[ConfigKey],
  ): Promise<{ config: Config; note?: string }> {
    let note: string | undefined;

    if (key === "agent" || key === "model" || key === "effort") {
      const check = await this.checkEffort({
        ...this.ctx.config,
        [key]: value ?? DEFAULT_CONFIG[key],
      });

      if (!check.ok && key === "effort") {
        throw new ApiError(400, check.error);
      }

      if (!check.ok) {
        await writeConfigValue(this.ctx.paths.config, "effort", check.fallback);
        note = `effort reset to ${check.fallback} for ${check.model}`;
      }
    }

    this.ctx.config = await writeConfigValue(this.ctx.paths.config, key, value);

    if (key === "watch_interval") {
      this.watcher.restart();
    }

    this.schedule();

    return { config: this.ctx.config, note };
  }

  private async checkEffort(config: Config): Promise<EffortCheck> {
    const catalog = await this.ctx.agents[config.agent]?.catalog().catch(() => undefined);

    return resolveEffort(config.agent, config.model, config.effort, catalog);
  }

  status(): { pid: number; running: number; queued: number } {
    const jobs = listJobs(this.ctx.db);

    return {
      pid: process.pid,
      running: jobs.filter((job) => job.state === "running").length,
      queued: jobs.filter((job) => job.state === "queued").length,
    };
  }

  schedule(): void {
    if (this.closed) {
      return;
    }

    const { db } = this.ctx;
    const jobs = listJobs(db);
    const byKey = new Map(jobs.map((job) => [job.key, job]));
    const repos = Map.groupBy(jobs, (job) => job.repoPath);
    const edges = listDependencies(db);
    const starts: number[] = [];
    let slots = this.ctx.config.concurrency - jobs.filter((job) => job.state === "running").length;

    for (const repoJobs of repos.values()) {
      const graph = graphFor(repoJobs, byKey, edges);
      const byId = new Map(repoJobs.map((job) => [job.id, job]));
      const states = new Map<string, SchedulableJob>(
        repoJobs.map((job) => [
          job.id,
          {
            id: job.id,
            state: job.state as JobState,
            blockedReason: job.blockedReason,
            prUrl: job.prUrl,
          },
        ]),
      );

      for (const [id, update] of waitingUpdates(graph, states)) {
        updateJob(db, (byId.get(id) as Job).key, update);
        states.set(id, { ...(states.get(id) as SchedulableJob), ...update });
      }

      for (const id of jobsToStart(graph, states, Math.max(0, slots))) {
        starts.push((byId.get(id) as Job).key);
        slots -= 1;
      }
    }

    for (const key of starts) {
      launch(this.ctx, key);
    }

    followUp(this.ctx);
    this.watcher.wake();
  }

  async reconcile(): Promise<void> {
    const { db, terminal, log } = this.ctx;
    let alive = new Set<string>();
    let unreachable: string | undefined;

    try {
      alive = new Set(
        (await terminal.list()).filter((block) => block.alive).map((block) => block.blockId),
      );
    } catch (error) {
      unreachable = (error as Error).message;
      log(`listing agent windows failed: ${unreachable}`);
    }

    const jobs = listJobs(db).filter((job) => inSession(job));

    await Promise.all(
      jobs.map(async (job) => {
        const run = latestRun(db, job.key);
        const gone = !run?.blockId || !alive.has(run.blockId);
        const reason = unreachable ?? "its window closed while the server was stopped";

        if (run && run.kind !== "feature") {
          const outcome = await followupState(this.ctx, job, run);

          if (outcome === "done") {
            await completeFollowup(this.ctx, job.key, run);
          } else if (gone) {
            await sessionGone(this.ctx, job, run, outcome, reason);
          }

          return;
        }

        const prUrl = await findDraft(this.ctx, job);

        if (prUrl) {
          finish(this.ctx, job.key, prUrl);
        } else if (gone) {
          await fail(this.ctx, job.key, run, reason);
        }
      }),
    );

    this.schedule();
    this.watcher.poll();
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.watcher.close();
  }

  private async detectHandFinished(jobs: Job[]): Promise<Set<number>> {
    const candidates = jobs.filter(
      (job) => job.prUrl === null && HAND_OFF_STATES.includes(job.state as JobState),
    );
    const found = await Promise.all(candidates.map((job) => findDraft(this.ctx, job)));
    const moved = new Set<number>();

    candidates.forEach((job, index) => {
      const prUrl = found[index];

      if (
        prUrl &&
        transition(this.ctx, job.key, {
          from: HAND_OFF_STATES,
          to: "done",
          fields: { prUrl, blockedReason: null },
        })
      ) {
        moved.add(job.key);
      }
    });

    return moved;
  }
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

  if (force && canTransition(job.state as JobState, "queued")) {
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
    waitingSince: job.state === "running" ? (run?.waitingSince?.getTime() ?? null) : null,
  };
}

function resumeOf(run: Run): NextRunRecord {
  return {
    kind: run.kind as NextRunRecord["kind"],
    trigger: run.trigger,
    gate: run.gate,
    startSha: run.startSha,
    resume: true,
  };
}

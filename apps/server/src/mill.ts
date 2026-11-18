import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  CLEANABLE_STATES,
  FOLLOWUP_BLOCK_REASON,
  HAND_OFF_STATES,
  REQUEUEABLE_STATES,
  SESSION_STATES,
  STOP_BLOCK_REASON,
  UPDATABLE_STATES,
  WATCHED_STATES,
  assertTransition,
  canTransition,
  checkGraph,
  decideFollowup,
  followupOutcome,
  jobsToStart,
  notificationFor,
  prNotificationFor,
  pushModeFor,
  stackParent,
  stopDecision,
  waitingUpdates,
  type AgentName,
  type BranchState,
  type Config,
  type ConfigKey,
  type Effort,
  type FollowupDecision,
  type FollowupOutcome,
  type JobState,
  type NotificationEvent,
  type PrEvent,
  type PrObservation,
  type PrState,
  type SchedulableJob,
} from "@openmill/core";
import {
  findJob,
  findJobsById,
  getJob,
  getObservation,
  getRun,
  insertJob,
  insertRun,
  latestRun,
  latestRuns,
  listDependencies,
  listJobs,
  listRuns,
  setDependencies,
  updateJob,
  updateObservation,
  updateRun,
  type Db,
  type Job,
  type NextRunRecord,
  type RestackRecord,
  type Run,
  type RunResultRecord,
} from "@openmill/db";
import { APPROVED_MESSAGE, followupPrompt, restackPrompt, startPrompt } from "./agent/prompt.ts";
import type { Agent, HookEvent, RunInput } from "./agent/types.ts";
import type { AddAction, AddRequest, JobDetail, JobSummary } from "./api.ts";
import { writeConfigValue } from "./config-store.ts";
import { ApiError } from "./errors.ts";
import {
  ensureWorktree,
  fetchDefaultBranch,
  git,
  gitRoot,
  removeWorktree,
  withRepoLock,
} from "./git.ts";
import type { GitHub } from "./github.ts";
import { createNotifier, notificationPayload, type Notify } from "./notify.ts";
import { branchName, jobDir, worktreePath, type Paths } from "./paths.ts";
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

const PR_STATE_EVENTS: ReadonlyArray<[PrEvent, JobState]> = [
  ["merged", "merged"],
  ["closed", "closed"],
  ["reopened", "done"],
];

const NO_PR_REASON = "the agent session ended without a draft PR";

const UNPUSHED_REASON = "the follow-up session ended before its changes were pushed";

const SESSION_OPEN_REASON =
  "someone is still using the previous session in the job's window; follow-ups start when it stops";

const DIRTY_REASON = "the worktree has uncommitted changes";

export class Mill {
  private readonly db: Db;
  private readonly paths: Paths;
  private readonly terminal: Terminal;
  private readonly agents: Record<string, Agent>;
  private readonly github: GitHub;
  private readonly hookCommand: string[];
  private readonly log: (message: string) => void;
  private readonly notifier: Notify;
  private readonly watcher: PrWatcher;
  private readonly preparing = new Set<number>();
  private readonly staleHeads = new Map<number, string>();
  private readonly busyRuns = new Set<number>();
  private config: Config;
  private closed = false;

  constructor(options: MillOptions) {
    this.db = options.db;
    this.paths = options.paths;
    this.config = options.config;
    this.terminal = options.terminal;
    this.agents = options.agents;
    this.github = options.github;
    this.hookCommand = options.hookCommand;
    this.log = options.log ?? (() => {});
    this.notifier = createNotifier(this.log);
    this.watcher = new PrWatcher({
      db: this.db,
      github: this.github,
      config: () => this.config,
      onChange: (job, events, observation) => this.applyPrEvents(job, events, observation),
      log: this.log,
      debug: options.debug ?? (() => {}),
    });
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

    const superseded: Array<{ job: Job; run: Run }> = [];

    for (const { job, action } of plan) {
      const run = job && action === "requeued" ? latestRun(this.db, job.key) : undefined;

      if (job && run && SESSION_STATES.includes(job.state as JobState)) {
        await this.endRun(job, run, { status: "cancelled", reason: "re-queued with --force" });
        superseded.push({ job, run });
      }
    }

    this.db.transaction((tx) => {
      const keys = new Map([...existing].map(([id, job]) => [id, job.key]));
      const touched: Array<{ key: number; dependsOn: string[] }> = [];

      for (const { doc, job, action } of plan) {
        const fields = {
          docPath: doc.path,
          docSnapshot: doc.content,
          projectSnapshot: doc.project?.content ?? null,
          ...(request.base ? { requestedBase: request.base } : {}),
          ...(request.agent ? { agent: request.agent } : {}),
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
          assertTransition(getJob(tx, job.key)?.state as JobState, "queued");
          updateJob(tx, job.key, {
            ...fields,
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

    for (const { run } of superseded) {
      await this.closeWindow(run);
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
    const capture = run ? this.capturePath(current, run) : undefined;

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
    const blockId = latestRun(this.db, job.key)?.blockId;

    if (!blockId) {
      throw new ApiError(409, `${job.id} has no window`);
    }

    const blocks = await this.terminal.list();

    if (!blocks.some((block) => block.blockId === blockId)) {
      throw new ApiError(409, `${job.id}'s window is closed`);
    }

    await this.terminal.focus(blockId);
  }

  async cancel(job: Job): Promise<JobState> {
    if (!canTransition(job.state as JobState, "cancelled")) {
      throw new ApiError(409, `${job.id} is ${job.state} and can't be cancelled`);
    }

    const run = latestRun(this.db, job.key);

    if (run) {
      await this.endRun(job, run, { status: "cancelled" });
    }

    updateJob(this.db, job.key, { state: "cancelled", blockedReason: null });

    if (run) {
      await this.closeWindow(run);
    }

    this.schedule();

    return "cancelled";
  }

  async clean(): Promise<number> {
    const open = new Set((await this.terminal.list()).map((block) => block.blockId));
    const jobs = listJobs(this.db).filter((job) =>
      CLEANABLE_STATES.includes(job.state as JobState),
    );
    const runs = latestRuns(
      this.db,
      jobs.map((job) => job.key),
    );
    let closed = 0;

    for (const job of jobs) {
      const run = runs.get(job.key);

      if (run?.blockId && open.has(run.blockId)) {
        await this.endRun(job, run, run.result ?? { status: "done" });
        await this.closeWindow(run);
        closed += 1;
      }
    }

    return closed;
  }

  async requeue(job: Job): Promise<JobState> {
    if ((await this.detectHandFinished([job])).has(job.key)) {
      return "done";
    }

    const current = getJob(this.db, job.key);
    const state = current?.state as JobState | undefined;
    const run = latestRun(this.db, job.key);

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
        this.busyRuns.delete(run.id);
      }

      updateJob(this.db, job.key, { state: "done", blockedReason: null });
      this.schedule();

      return "done";
    }

    const resume = run && run.kind !== "feature" ? resumeOf(run) : null;
    const nextRun =
      state === "awaiting_push" && resume
        ? { ...resume, gate: "open" as const, message: APPROVED_MESSAGE }
        : resume;

    updateJob(this.db, job.key, { state: "queued", blockedReason: null, nextRun });
    this.schedule();

    return "queued";
  }

  async hook(runId: number, event: string, payload: unknown): Promise<unknown> {
    const run = getRun(this.db, runId);
    const agent = run ? this.agents[run.agent] : undefined;
    const parsed = agent?.parseHook(event, payload);

    if (!run || !agent || !parsed) {
      return null;
    }

    if (parsed.transcriptPath && parsed.transcriptPath !== run.transcriptPath) {
      updateRun(this.db, run.id, { transcriptPath: parsed.transcriptPath });
    }

    const job = getJob(this.db, run.jobKey);

    if (!job || latestRun(this.db, job.key)?.id !== run.id) {
      return null;
    }

    switch (parsed.type) {
      case "stop":
        return this.onStop(job, run, agent, parsed);
      case "tool_use":
        return run.gate
          ? agent.gateToolUse(parsed, { open: run.gate === "open", branch: job.branchName })
          : null;
      case "prompt":
        this.onPrompt(job, run);

        return null;
      case "session_end":
        await this.onSessionEnd(job, run);

        return null;
    }
  }

  getConfig(): Config {
    return this.config;
  }

  async setConfig(key: ConfigKey, value: Config[ConfigKey]): Promise<Config> {
    this.config = await writeConfigValue(this.paths.config, key, value);

    if (key === "watch_interval") {
      this.watcher.restart();
    }

    this.schedule();

    return this.config;
  }

  status(): { pid: number; running: number; queued: number } {
    const jobs = listJobs(this.db);

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

    const jobs = listJobs(this.db);
    const byKey = new Map(jobs.map((job) => [job.key, job]));
    const repos = Map.groupBy(jobs, (job) => job.repoPath);
    const starts: Job[] = [];
    let slots = this.config.concurrency - jobs.filter((job) => job.state === "running").length;

    const edges = listDependencies(this.db);

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
        updateJob(this.db, (byId.get(id) as Job).key, update);
        states.set(id, { ...(states.get(id) as SchedulableJob), ...update });
      }

      for (const id of jobsToStart(graph, states, Math.max(0, slots))) {
        starts.push(byId.get(id) as Job);
        slots -= 1;
      }
    }

    for (const job of starts) {
      this.launch(job);
    }

    this.followUp();
    this.watcher.wake();
  }

  async reconcile(): Promise<void> {
    let alive = new Set<string>();
    let unreachable: string | undefined;

    try {
      alive = new Set(
        (await this.terminal.list()).filter((block) => block.alive).map((block) => block.blockId),
      );
    } catch (error) {
      unreachable = (error as Error).message;
      this.log(`listing agent windows failed: ${unreachable}`);
    }

    const jobs = listJobs(this.db).filter((job) => inSession(job));

    await Promise.all(
      jobs.map(async (job) => {
        const run = latestRun(this.db, job.key);
        const gone = !run?.blockId || !alive.has(run.blockId);
        const reason = unreachable ?? "its window closed while the server was stopped";

        if (run && run.kind !== "feature") {
          const outcome = await this.followupState(job, run);

          if (outcome === "done") {
            await this.completeFollowup(job, run);
          } else if (gone) {
            await this.sessionGone(job, run, outcome, reason);
          }

          return;
        }

        const prUrl = await this.findDraft(job);

        if (prUrl) {
          this.finish(job.key, prUrl);
        } else if (gone) {
          await this.fail(job.key, run, reason);
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

  private launch(job: Job): void {
    const previous = latestRun(this.db, job.key);
    const next = job.nextRun;
    const resume = job.sessionId !== null && (next?.resume ?? true);
    const run = insertRun(this.db, {
      jobKey: job.key,
      agent: job.agent ?? this.config.agent,
      model: job.model ?? this.config.model ?? null,
      effort: job.effort ?? this.config.effort,
      kind: next?.kind ?? "feature",
      trigger: next?.trigger ?? null,
      gate: next?.gate ?? null,
      startSha: next?.startSha ?? null,
      sessionId: resume ? job.sessionId : randomUUID(),
      transcriptPath: resume ? previous?.transcriptPath : null,
    });

    updateJob(this.db, job.key, { state: "running", blockedReason: null, nextRun: null });

    void this.spawn(job, run, previous, resume, next?.message).catch(async (error: unknown) => {
      if (latestRun(this.db, job.key)?.id === run.id) {
        await this.fail(
          job.key,
          getRun(this.db, run.id),
          (error as Error).message ?? String(error),
        );
      }
    });
  }

  private async spawn(
    job: Job,
    run: Run,
    previous: Run | undefined,
    resume: boolean,
    message: string | undefined,
  ): Promise<void> {
    const agent = this.agents[run.agent];

    if (!agent) {
      throw new Error(`unknown agent ${run.agent}`);
    }

    const input = await this.prepare(job, run);
    const { command, env } = resume
      ? agent.resume(input, message)
      : agent.launch(input, this.prompt(job, run, input));

    await agent.trust(job.repoPath);

    const previousBlock = previous?.blockId
      ? (await this.terminal.list().catch(() => [])).find(
          (block) => block.blockId === previous.blockId,
        )
      : undefined;

    const replace =
      previousBlock && !(previousBlock.alive && resume) ? previousBlock.blockId : undefined;

    if (previous && !replace) {
      await this.closeWindow(previous);
    }

    const blockId = await this.terminal.spawn({
      label: job.id,
      cwd: job.worktreePath,
      command,
      env: { ...env, OPENMILL_HOME: this.paths.home, OPENMILL_RUN_ID: String(run.id) },
      replace,
    });

    updateRun(this.db, run.id, { blockId });

    const current = getJob(this.db, job.key);

    if (current?.state === "running" && latestRun(this.db, job.key)?.id === run.id) {
      updateJob(this.db, job.key, { sessionId: run.sessionId });
    } else {
      await this.closeWindow({ ...run, blockId });
    }
  }

  private async onStop(
    job: Job,
    run: Run,
    agent: Agent,
    event: Extract<HookEvent, { type: "stop" }>,
  ): Promise<unknown> {
    this.busyRuns.delete(run.id);

    if (!inSession(job)) {
      this.leftSession(job);

      return null;
    }

    let outcome: FollowupOutcome;

    if (run.kind === "feature") {
      const decision = stopDecision(await this.findDraft(job), event.stopHookActive);

      if (decision.kind === "done") {
        this.finish(job.key, decision.prUrl);

        return null;
      }

      outcome = decision.kind;
    } else {
      outcome = followupOutcome(
        await this.branchState(job, run),
        run.gate === "closed",
        event.stopHookActive,
      );
    }

    switch (outcome) {
      case "done":
        await this.completeFollowup(job, run);

        return null;
      case "awaiting_push":
        this.awaitPush(job.key);

        return null;
      case "block":
        return agent.blockStop(run.kind === "feature" ? STOP_BLOCK_REASON : FOLLOWUP_BLOCK_REASON);
      case "needs_input": {
        const transcript = event.transcriptPath ?? run.transcriptPath;
        const reason =
          (transcript && (await agent.lastMessage(transcript).catch(() => undefined))) ||
          (run.kind === "feature"
            ? "the agent stopped without a draft PR"
            : "the agent stopped without pushing its changes");

        if (getJob(this.db, job.key)?.state === "running") {
          updateRun(this.db, run.id, { result: { status: "needs_input", reason } });
          updateJob(this.db, job.key, { state: "needs_input" });
          this.notify(job.key, "running", "needs_input", reason);
          this.schedule();
        }

        return null;
      }
    }
  }

  private onPrompt(job: Job, run: Run): void {
    if (job.state === "awaiting_push") {
      updateRun(this.db, run.id, { gate: "open" });
    } else if (inSession(job) && job.state === "needs_input") {
      updateRun(this.db, run.id, { result: null });
    } else {
      if (job.state !== "running") {
        this.busyRuns.add(run.id);
      }

      return;
    }

    updateJob(this.db, job.key, { state: "running", blockedReason: null });
    this.schedule();
  }

  private async onSessionEnd(job: Job, run: Run): Promise<void> {
    if (run.endedAt) {
      return;
    }

    if (!inSession(job)) {
      await this.endRun(job, run, run.result ?? { status: "done" });
      this.leftSession(job);

      return;
    }

    if (run.kind !== "feature") {
      const outcome = await this.followupState(job, run);

      if (outcome === "done") {
        await this.endRun(job, run, { status: "done" });
        await this.completeFollowup(job, run);
      } else {
        await this.sessionGone(job, run, outcome, UNPUSHED_REASON);
      }

      return;
    }

    const prUrl = await this.findDraft(job);

    if (prUrl) {
      await this.endRun(job, run, { status: "done" });
      this.finish(job.key, prUrl);
    } else {
      await this.fail(job.key, run, NO_PR_REASON);
    }
  }

  private finish(key: number, prUrl: string): void {
    const job = getJob(this.db, key);

    if (job && canTransition(job.state as JobState, "done")) {
      updateJob(this.db, key, { state: "done", prUrl, blockedReason: null });
      this.schedule();
    }
  }

  private async fail(key: number, run: Run | undefined, reason: string): Promise<void> {
    const job = getJob(this.db, key);

    if (!job || !SESSION_STATES.includes(job.state as JobState)) {
      return;
    }

    if (run) {
      await this.endRun(job, run, { status: "failed", reason });
    }

    const from = job.state as JobState;

    updateJob(this.db, key, { state: "failed", blockedReason: null });
    this.notify(key, from, "failed", reason);
    this.schedule();
  }

  private async endRun(job: Job, run: Run, result: RunResultRecord): Promise<void> {
    if (run.blockId) {
      try {
        const dir = join(jobDir(this.paths, job.repoPath, job.id), "runs");

        await mkdir(dir, { recursive: true });
        await writeFile(this.capturePath(job, run), await this.terminal.capture(run.blockId));
      } catch (error) {
        this.log(`saving the window of ${job.id} failed: ${String(error)}`);
      }
    }

    updateRun(this.db, run.id, { endedAt: run.endedAt ?? new Date(), result });
  }

  private async closeWindow(run: Run): Promise<void> {
    if (!run.blockId) {
      return;
    }

    await this.terminal
      .close(run.blockId)
      .catch((error: unknown) =>
        this.log(`closing window ${run.blockId} failed: ${String(error)}`),
      );
  }

  private async findDraft(job: Job): Promise<string | undefined> {
    return this.github.findOpenDraft(job.repoPath, job.branchName).catch((error: unknown) => {
      this.log(`gh pr list for ${job.id} failed: ${String(error)}`);

      return undefined;
    });
  }

  private async prepare(job: Job, run: Run): Promise<RunInput> {
    const dir = jobDir(this.paths, job.repoPath, job.id);
    const docPath = join(dir, `${job.id}.md`);
    let projectPath: string | undefined;

    await mkdir(dir, { recursive: true });
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
      docPath,
      projectPath,
      branch: job.branchName,
      prBaseBranch,
      model: run.model ?? undefined,
      effort: run.effort as Effort,
      sessionId: run.sessionId as string,
      hookCommand: this.hookCommand,
      pushGate: run.gate !== null,
    };
  }

  private prompt(job: Job, run: Run, input: RunInput): string {
    const push = run.gate === null;

    if (run.kind === "followup" && run.trigger && job.prUrl) {
      return followupPrompt(input, job.prUrl, run.trigger, push);
    }

    if (run.kind === "restack" && job.restack) {
      return restackPrompt(input, job.restack.base, job.restack.cut, push);
    }

    return startPrompt(input);
  }

  private async branchBase(job: Job): Promise<{ baseBranch: string; prBaseBranch: string }> {
    const graph = this.repoGraph(job.repoPath);
    const parentOf = (id: string) => {
      const parentId = stackParent(graph, id);

      return parentId ? findJob(this.db, job.repoPath, parentId) : undefined;
    };
    let parent = parentOf(job.id);

    // A merged parent's branch is deleted, so stack on the nearest ancestor that still has one.
    while (parent?.state === "merged") {
      parent = parentOf(parent.id);
    }

    if (parent) {
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
    const candidates = jobs.filter(
      (job) => job.prUrl === null && HAND_OFF_STATES.includes(job.state as JobState),
    );
    const found = await Promise.all(candidates.map((job) => this.findDraft(job)));
    const moved = new Set<number>();

    candidates.forEach((job, index) => {
      const url = found[index];
      const current = getJob(this.db, job.key);

      if (url && current && HAND_OFF_STATES.includes(current.state as JobState)) {
        updateJob(this.db, job.key, { state: "done", prUrl: url, blockedReason: null });
        moved.add(job.key);
      }
    });

    if (moved.size > 0) {
      this.schedule();
    }

    return moved;
  }

  private applyPrEvents(job: Job, events: PrEvent[], observation: PrObservation): void {
    this.log(`${job.id} PR events: ${events.join(", ")}`);

    if (!WATCHED_STATES.includes(job.state as JobState)) {
      return;
    }

    let state = job.state as JobState;
    const next = PR_STATE_EVENTS.find(([event]) => events.includes(event))?.[1];

    if (next && canTransition(state, next)) {
      updateJob(this.db, job.key, { state: next });
      state = next;

      if (next === "merged") {
        if (job.prBaseBranch) {
          this.markDependents(job, { base: job.prBaseBranch, cut: observation.headSha });
        }

        void this.cleanUpMerged(job);
      }
    }

    const ready = events.some(
      (event) => prNotificationFor(state, event, observation) === "ready_for_review",
    );

    if (ready && getObservation(this.db, job.key)?.readyNotifiedSha !== observation.headSha) {
      updateObservation(this.db, job.key, { readyNotifiedSha: observation.headSha });
      this.send("ready_for_review", job.key, "every check passed");
    }

    this.schedule();
  }

  private leftSession(job: Job): void {
    if (job.state === "needs_input" && job.blockedReason === SESSION_OPEN_REASON) {
      updateJob(this.db, job.key, { state: "done", blockedReason: null });
      this.schedule();
    }
  }

  private followUp(): void {
    for (const job of listJobs(this.db)) {
      if (job.state !== "done" || this.preparing.has(job.key)) {
        continue;
      }

      const { restack } = job;

      if (restack) {
        this.inBackground(job, () => this.restack(job, restack));
      } else if (this.decide(job).action !== "none") {
        this.inBackground(job, () => this.prepareFollowup(job));
      }
    }
  }

  private decide(job: Job): FollowupDecision {
    const row = getObservation(this.db, job.key);
    const observation =
      row && row.prUrl === job.prUrl ? { ...row, state: row.state as PrState } : undefined;

    return decideFollowup({
      state: job.state as JobState,
      observation,
      runs: listRuns(this.db, job.key),
      attempts: this.config.followup_attempts,
      staleHead: this.staleHeads.get(job.key),
    });
  }

  private inBackground(job: Job, task: () => Promise<void>): void {
    this.preparing.add(job.key);

    void task()
      .catch((error: unknown) => {
        this.log(`follow-up for ${job.id} failed: ${String(error)}`);
        this.needsInput(job.key, (error as { detail?: string }).detail ?? String(error));
      })
      .finally(() => {
        this.preparing.delete(job.key);
        this.schedule();
      });
  }

  private async prepareFollowup(job: Job): Promise<void> {
    const remoteHead = await withRepoLock(job.repoPath, () => this.fetchBranch(job));
    const observed = getObservation(this.db, job.key)?.headSha;

    if (observed && observed !== remoteHead) {
      this.staleHeads.set(job.key, observed);
    }

    const decision = this.decide(job);

    if (decision.action === "none") {
      return;
    }

    if (decision.action === "exhausted") {
      this.needsInput(job.key, decision.reason, true);

      return;
    }

    if (await this.sessionBusy(job)) {
      this.needsInput(job.key, SESSION_OPEN_REASON);

      return;
    }

    const synced = await this.fastForward(job);

    if ("problem" in synced) {
      this.needsInput(job.key, synced.problem);

      return;
    }

    const gate = pushModeFor(decision.trigger, this.config) === "wait" ? "closed" : null;

    this.queueRun(job.key, {
      kind: "followup",
      trigger: decision.trigger,
      gate,
      startSha: synced.head,
      resume: false,
    });
  }

  private async restack(job: Job, { base, cut }: RestackRecord): Promise<void> {
    const cwd = job.worktreePath;

    if (await this.sessionBusy(job)) {
      this.needsInput(job.key, SESSION_OPEN_REASON);

      return;
    }

    const landed = await withRepoLock(job.repoPath, async () => {
      await this.fetchBranch(job);

      const synced = await this.fastForward(job);

      if ("problem" in synced) {
        this.needsInput(job.key, synced.problem);

        return undefined;
      }

      try {
        await git(cwd, ["rebase", "--onto", `origin/${base}`, cut]);
      } catch {
        await git(cwd, ["rebase", "--abort"]).catch(() => {});

        return { conflict: true, head: synced.head };
      }

      try {
        await git(cwd, ["push", "--force-with-lease", "origin", job.branchName]);
      } catch (error) {
        await git(cwd, ["reset", "--hard", synced.head]);

        throw error;
      }

      return { conflict: false, head: synced.head };
    });

    if (!landed) {
      return;
    }

    if (!landed.conflict) {
      await this.landRestack(job, landed.head);

      return;
    }

    if (await this.sessionBusy(job)) {
      this.needsInput(job.key, SESSION_OPEN_REASON);

      return;
    }

    this.queueRun(job.key, {
      kind: "restack",
      trigger: null,
      gate: this.config.review_push === "wait" ? "closed" : null,
      startSha: landed.head,
      resume: false,
    });
  }

  private async landRestack(job: Job, before: string): Promise<void> {
    const current = getJob(this.db, job.key);
    const restack = current?.restack;

    if (!current || !restack) {
      return;
    }

    if (current.prUrl && current.prBaseBranch !== restack.base) {
      await this.github.editPrBase(current.repoPath, current.prUrl, restack.base);
    }

    updateJob(this.db, job.key, {
      baseBranch: `origin/${restack.base}`,
      prBaseBranch: restack.base,
      restack: null,
    });
    this.markDependents(current, { base: current.branchName, cut: before });
  }

  private markDependents(parent: Job, restack: RestackRecord): void {
    for (const job of listJobs(this.db)) {
      if (
        job.repoPath === parent.repoPath &&
        job.key !== parent.key &&
        job.prBaseBranch === parent.branchName &&
        job.state !== "merged" &&
        job.state !== "cancelled"
      ) {
        updateJob(this.db, job.key, { restack });
      }
    }
  }

  private queueRun(key: number, nextRun: NextRunRecord): void {
    if (getJob(this.db, key)?.state === "done") {
      updateJob(this.db, key, { state: "queued", nextRun });
    }
  }

  private needsInput(key: number, reason: string, exhausted = false): void {
    if (getJob(this.db, key)?.state !== "done") {
      return;
    }

    updateJob(this.db, key, { state: "needs_input", blockedReason: reason });
    this.notify(key, "done", "needs_input", reason, exhausted);
  }

  private awaitPush(key: number): void {
    if (getJob(this.db, key)?.state !== "running") {
      return;
    }

    updateJob(this.db, key, { state: "awaiting_push" });
    this.notify(key, "running", "awaiting_push", null);
    this.schedule();
  }

  private async completeFollowup(job: Job, run: Run): Promise<void> {
    if (run.kind === "restack" && run.startSha) {
      try {
        await this.landRestack(job, run.startSha);
      } catch (error) {
        this.log(`retargeting ${job.id} after its restack failed: ${String(error)}`);
      }
    }

    this.finish(job.key, job.prUrl as string);
  }

  private async sessionGone(
    job: Job,
    run: Run,
    outcome: FollowupOutcome,
    reason: string,
  ): Promise<void> {
    if (outcome === "awaiting_push" && getJob(this.db, job.key)?.state === "running") {
      await this.endRun(job, run, { status: "done" });
      this.awaitPush(job.key);
    } else {
      await this.fail(job.key, run, reason);
    }
  }

  private async followupState(job: Job, run: Run): Promise<FollowupOutcome> {
    try {
      return followupOutcome(await this.branchState(job, run), run.gate === "closed", true);
    } catch (error) {
      this.log(`reading the branch of ${job.id} failed: ${String(error)}`);

      return "needs_input";
    }
  }

  private async fetchBranch(job: Job): Promise<string> {
    await ensureWorktree(
      job.repoPath,
      job.worktreePath,
      job.branchName,
      job.baseBranch ?? job.branchName,
    );
    await git(job.worktreePath, ["fetch", "origin"]);

    return git(job.worktreePath, ["rev-parse", `origin/${job.branchName}`]);
  }

  private async fastForward(job: Job): Promise<{ head: string } | { problem: string }> {
    const cwd = job.worktreePath;
    const remote = `origin/${job.branchName}`;

    if ((await git(cwd, ["status", "--porcelain"])) !== "") {
      return { problem: DIRTY_REASON };
    }

    const [ahead = 0, behind = 0] = (
      await git(cwd, ["rev-list", "--left-right", "--count", `HEAD...${remote}`])
    )
      .split(/\s+/)
      .map(Number);

    if (ahead > 0 && behind > 0) {
      return { problem: `the branch has diverged from ${remote}` };
    }

    await git(cwd, ["merge", "--ff-only", remote]);

    return { head: await git(cwd, ["rev-parse", "HEAD"]) };
  }

  private async branchState(job: Job, run: Run): Promise<BranchState> {
    const cwd = job.worktreePath;

    await withRepoLock(job.repoPath, () => git(cwd, ["fetch", "origin", job.branchName])).catch(
      (error: unknown) => this.log(`fetching ${job.branchName} failed: ${String(error)}`),
    );

    const [head, unpushed, status, rebaseDir] = await Promise.all([
      git(cwd, ["rev-parse", "HEAD"]),
      git(cwd, ["rev-list", "--count", `origin/${job.branchName}..HEAD`]).catch(() => "1"),
      git(cwd, ["status", "--porcelain"]),
      git(cwd, ["rev-parse", "--git-path", "rebase-merge"]),
    ]);

    return {
      progressed: head !== run.startSha,
      unpushed: Number(unpushed) > 0,
      dirty: status !== "" || existsSync(resolve(cwd, rebaseDir)),
    };
  }

  private async sessionBusy(job: Job): Promise<boolean> {
    const run = latestRun(this.db, job.key);

    if (!run?.blockId || !this.busyRuns.has(run.id)) {
      return false;
    }

    return (await this.terminal.list()).some(
      (block) => block.blockId === run.blockId && block.alive,
    );
  }

  private async cleanUpMerged(job: Job): Promise<void> {
    try {
      await withRepoLock(job.repoPath, () =>
        removeWorktree(job.repoPath, job.worktreePath, job.branchName),
      );
    } catch (error) {
      this.log(`cleaning up merged job ${job.id} failed: ${String(error)}`);
    }
  }

  private notify(
    key: number,
    from: JobState,
    to: JobState,
    reason: string | null,
    exhausted = false,
  ): void {
    const event = notificationFor(from, to, exhausted);

    if (event) {
      this.send(event, key, reason);
    }
  }

  private send(event: NotificationEvent, key: number, reason: string | null): void {
    const job = getJob(this.db, key);

    if (!job) {
      return;
    }

    try {
      this.notifier(notificationPayload(event, job, reason), this.config);
    } catch (error) {
      this.log(`notification for ${job.id} failed: ${String(error)}`);
    }
  }

  private capturePath(job: Job, run: Run): string {
    return join(jobDir(this.paths, job.repoPath, job.id), "runs", `${run.id}.txt`);
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

function inSession(job: Job): boolean {
  return (
    SESSION_STATES.includes(job.state as JobState) &&
    !(job.state === "needs_input" && job.blockedReason !== null)
  );
}

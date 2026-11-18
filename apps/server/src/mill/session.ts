import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stackParent, type Effort } from "@openmill/core";
import {
  findJob,
  getJob,
  getRun,
  insertRun,
  latestRun,
  listDependencies,
  listJobs,
  updateJob,
  updateRun,
  type Job,
  type Run,
} from "@openmill/db";
import { followupPrompt, restackPrompt, startPrompt } from "../agent/prompt.ts";
import type { RunInput } from "../agent/types.ts";
import { ensureWorktree, fetchDefaultBranch, withRepoLock } from "../git.ts";
import { jobDir } from "../paths.ts";
import type { MillContext } from "./context.ts";
import { closeWindow, fail, transition } from "./lifecycle.ts";

export function launch(ctx: MillContext, key: number): void {
  const job = transition(ctx, key, {
    from: ["queued"],
    to: "running",
    fields: { blockedReason: null, nextRun: null },
  });

  if (!job) {
    return;
  }

  const previous = latestRun(ctx.db, key);
  const next = job.nextRun;
  const resume = job.sessionId !== null && (next?.resume ?? true);
  const run = insertRun(ctx.db, {
    jobKey: key,
    agent: job.agent ?? ctx.config.agent,
    model: job.model ?? ctx.config.model ?? null,
    effort: job.effort ?? ctx.config.effort,
    kind: next?.kind ?? "feature",
    trigger: next?.trigger ?? null,
    gate: next?.gate ?? null,
    startSha: next?.startSha ?? null,
    sessionId: resume ? job.sessionId : randomUUID(),
    transcriptPath: resume ? previous?.transcriptPath : null,
  });

  void spawn(ctx, job, run, previous, resume, next?.message).catch(async (error: unknown) => {
    if (latestRun(ctx.db, key)?.id === run.id) {
      await fail(ctx, key, getRun(ctx.db, run.id), (error as Error).message ?? String(error));
      ctx.schedule();
    }
  });
}

async function spawn(
  ctx: MillContext,
  job: Job,
  run: Run,
  previous: Run | undefined,
  resume: boolean,
  message: string | undefined,
): Promise<void> {
  const agent = ctx.agents[run.agent];

  if (!agent) {
    throw new Error(`unknown agent ${run.agent}`);
  }

  const input = await prepare(ctx, job, run);
  const { command, env } = resume
    ? agent.resume(input, message)
    : agent.launch(input, prompt(job, run, input));

  await agent.trust(job.repoPath);

  const previousBlock = previous?.blockId
    ? (await ctx.terminal.list().catch(() => [])).find(
        (block) => block.blockId === previous.blockId,
      )
    : undefined;

  const replace =
    previousBlock && !(previousBlock.alive && resume) ? previousBlock.blockId : undefined;

  if (previous && !replace) {
    await closeWindow(ctx, previous);
  }

  const blockId = await ctx.terminal.spawn({
    label: job.id,
    cwd: job.worktreePath,
    command,
    env: { ...env, OPENMILL_HOME: ctx.paths.home, OPENMILL_RUN_ID: String(run.id) },
    replace,
  });

  updateRun(ctx.db, run.id, { blockId });

  if (getJob(ctx.db, job.key)?.state === "running" && latestRun(ctx.db, job.key)?.id === run.id) {
    updateJob(ctx.db, job.key, { sessionId: run.sessionId });
  } else {
    await closeWindow(ctx, { ...run, blockId });
  }
}

async function prepare(ctx: MillContext, job: Job, run: Run): Promise<RunInput> {
  const dir = jobDir(ctx.paths, job.repoPath, job.id);
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
      branches = await branchBase(ctx, job);
      updateJob(ctx.db, job.key, branches);
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
    hookCommand: ctx.hookCommand,
    pushGate: run.gate !== null,
  };
}

function prompt(job: Job, run: Run, input: RunInput): string {
  const push = run.gate === null;

  if (run.kind === "followup" && run.trigger && job.prUrl) {
    return followupPrompt(input, job.prUrl, run.trigger, push);
  }

  if (run.kind === "restack" && job.restack) {
    return restackPrompt(input, job.restack.base, job.restack.cut, push);
  }

  return startPrompt(input);
}

async function branchBase(
  ctx: MillContext,
  job: Job,
): Promise<{ baseBranch: string; prBaseBranch: string }> {
  const graph = repoGraph(ctx, job.repoPath);
  const parentOf = (id: string) => {
    const parentId = stackParent(graph, id);

    return parentId ? findJob(ctx.db, job.repoPath, parentId) : undefined;
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

export function graphFor(
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

export function repoGraph(ctx: MillContext, repoPath: string): Map<string, string[]> {
  const jobs = listJobs(ctx.db);

  return graphFor(
    jobs.filter((job) => job.repoPath === repoPath),
    new Map(jobs.map((job) => [job.key, job])),
    listDependencies(ctx.db),
  );
}

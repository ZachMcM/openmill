import {
  EDIT_BLOCK_REASON,
  FOLLOWUP_BLOCK_REASON,
  SESSION_STATES,
  STOP_BLOCK_REASON,
  editTurnOutcome,
  followupOutcome,
  stopDecision,
  triggerCleared,
  type BranchState,
  type FollowupOutcome,
} from "@openmill/core";
import { getJob, getRun, latestRun, updateJob, updateRun, type Job, type Run } from "@openmill/db";
import { draftGateDenial, pushGateDenial } from "../agent/push-gate.ts";
import type { Agent, HookEvent } from "../agent/types.ts";
import { branchState, git, withRepoLock } from "../git.ts";
import type { MillContext } from "./context.ts";
import { completeFollowup } from "./followups.ts";
import {
  SESSION_OPEN_REASON,
  awaitPush,
  endRun,
  fail,
  findDraft,
  finish,
  inEditTurn,
  inSession,
  notify,
  send,
  transition,
} from "./lifecycle.ts";
import { permissionMode } from "./session.ts";

const EDIT_UNPUSHED_REASON = "the agent stopped with uncommitted or unpushed edits";

const RESUMING_EVENTS: ReadonlyArray<HookEvent["type"]> = ["tool_use", "permission_wait"];

export interface HookResult {
  reply: unknown;
  type?: HookEvent["type"];
}

export async function handleHook(
  ctx: MillContext,
  runId: number,
  event: string,
  payload: unknown,
): Promise<HookResult> {
  const run = getRun(ctx.db, runId);
  const agent = run ? ctx.agents[run.agent] : undefined;
  const parsed = agent?.parseHook(event, payload);

  if (!run || !agent || !parsed) {
    return { reply: null };
  }

  if (parsed.transcriptPath && parsed.transcriptPath !== run.transcriptPath) {
    updateRun(ctx.db, run.id, { transcriptPath: parsed.transcriptPath });
  }

  const job = getJob(ctx.db, run.jobKey);

  if (!job || latestRun(ctx.db, job.key)?.id !== run.id) {
    return { reply: null };
  }

  const current = RESUMING_EVENTS.includes(parsed.type) ? resume(ctx, job, run) : job;

  return { reply: await dispatch(ctx, current, run, agent, parsed), type: parsed.type };
}

async function dispatch(
  ctx: MillContext,
  job: Job,
  run: Run,
  agent: Agent,
  event: HookEvent,
): Promise<unknown> {
  if (run.waitingSince && event.type !== "permission_wait") {
    updateRun(ctx.db, run.id, { waitingSince: null });
  }

  switch (event.type) {
    case "session_start":
      if (event.sessionId !== run.sessionId) {
        updateRun(ctx.db, run.id, { sessionId: event.sessionId });
        updateJob(ctx.db, job.key, { sessionId: event.sessionId });
      }

      return null;
    case "stop":
      return onStop(ctx, job, run, agent, event);
    case "tool_use": {
      const reason = event.command ? toolUseDenial(job, run, event.command) : undefined;

      return reason ? agent.denyToolUse(reason) : null;
    }
    case "prompt": {
      const firstPrompt = run.transcriptPath === null;

      if (firstPrompt && event.autoMode === false && permissionMode(ctx, job) === "auto") {
        await fail(
          ctx,
          job.key,
          run,
          `auto mode isn't available for ${run.model ?? "the default model"}; set permission_mode to bypass or pick a supported model`,
        );
      } else {
        await onPrompt(ctx, job, run);
      }

      return null;
    }
    case "permission_wait":
      if (job.state === "running" && !run.waitingSince) {
        updateRun(ctx.db, run.id, { waitingSince: new Date() });
        send(ctx, "needs_permission", job.key, event.message ?? null);
      }

      return null;
    case "session_end":
      onSessionEnd(ctx, job, run);

      return null;
  }
}

function toolUseDenial(job: Job, run: Run, command: string): string | undefined {
  return (
    draftGateDenial(command) ??
    (run.gate && !inEditTurn(job, run)
      ? pushGateDenial(command, { open: run.gate === "open", branch: job.branchName })
      : undefined)
  );
}

async function onStop(
  ctx: MillContext,
  job: Job,
  run: Run,
  agent: Agent,
  event: Extract<HookEvent, { type: "stop" }>,
): Promise<unknown> {
  updateRun(ctx.db, run.id, { busy: false });

  if (!inSession(job)) {
    leftSession(ctx, job.key);

    return null;
  }

  if (event.pendingWork === undefined && !ctx.tasklessStops.has(run.id)) {
    ctx.tasklessStops.add(run.id);
    ctx.debug(`Stop input for ${job.id} has no background_tasks`);
  }

  if (event.pendingWork) {
    return null;
  }

  if (inEditTurn(job, run)) {
    return onEditTurnStop(ctx, job, run, agent, event);
  }

  let outcome: FollowupOutcome;

  if (run.kind === "feature") {
    const decision = stopDecision(await findDraft(ctx, job), event.stopHookActive);

    if (decision.kind === "done") {
      await endRun(ctx, job, run, { status: "done" });
      finish(ctx, job.key, decision.prUrl);

      return null;
    }

    outcome = decision.kind;
  } else {
    outcome = followupOutcome(
      await readBranch(ctx, job, run),
      run.gate === "closed",
      event.stopHookActive,
    );
  }

  if ((outcome === "block" || outcome === "needs_input") && (await nothingToFix(ctx, job, run))) {
    await endRun(ctx, job, run, { status: "done" });
    await completeFollowup(ctx, job.key, run);

    return null;
  }

  switch (outcome) {
    case "done":
      await endRun(ctx, job, run, { status: "done" });
      await completeFollowup(ctx, job.key, run);

      return null;
    case "awaiting_push":
      awaitPush(ctx, job.key);

      return null;
    case "block":
      return agent.blockStop(run.kind === "feature" ? STOP_BLOCK_REASON : FOLLOWUP_BLOCK_REASON);
    case "needs_input": {
      const reason = await stopMessage(
        agent,
        run,
        event,
        run.kind === "feature"
          ? "the agent stopped without a draft PR"
          : "the agent stopped without pushing its changes",
      );

      if (transition(ctx, job.key, { from: ["running"], to: "needs_input" })) {
        updateRun(ctx.db, run.id, { result: { status: "needs_input", reason } });
        notify(ctx, job.key, "running", "needs_input", reason);
      }

      return null;
    }
  }
}

async function onEditTurnStop(
  ctx: MillContext,
  job: Job,
  run: Run,
  agent: Agent,
  event: Extract<HookEvent, { type: "stop" }>,
): Promise<unknown> {
  const outcome = await editTurnState(ctx, job, run, event.stopHookActive);

  if (outcome === "done") {
    endEditTurn(ctx, job.key);

    return null;
  }

  if (outcome === "block") {
    return agent.blockStop(EDIT_BLOCK_REASON);
  }

  const reason = await stopMessage(agent, run, event, EDIT_UNPUSHED_REASON);

  if (
    transition(ctx, job.key, {
      from: ["running"],
      to: "needs_input",
      fields: { blockedReason: null },
    })
  ) {
    notify(ctx, job.key, "running", "needs_input", reason);
  }

  return null;
}

async function stopMessage(
  agent: Agent,
  run: Run,
  event: Extract<HookEvent, { type: "stop" }>,
  fallback: string,
): Promise<string> {
  const transcript = event.transcriptPath ?? run.transcriptPath;

  return (
    event.lastMessage ||
    (transcript && (await agent.lastMessage(transcript).catch(() => undefined))) ||
    fallback
  );
}

export async function settleEditTurn(ctx: MillContext, job: Job, run: Run): Promise<void> {
  if ((await editTurnState(ctx, job, run, true)) === "done") {
    endEditTurn(ctx, job.key);
  }
}

function endEditTurn(ctx: MillContext, key: number): void {
  transition(ctx, key, { from: SESSION_STATES, to: "done", fields: { blockedReason: null } });
}

async function editTurnState(
  ctx: MillContext,
  job: Job,
  run: Run,
  stopHookActive: boolean,
): Promise<"done" | "block" | "needs_input"> {
  try {
    return editTurnOutcome(await readBranch(ctx, job, run), stopHookActive);
  } catch (error) {
    ctx.log(`reading the branch of ${job.id} failed: ${String(error)}`);

    return "needs_input";
  }
}

async function onPrompt(ctx: MillContext, job: Job, run: Run): Promise<void> {
  if (job.state === "awaiting_push") {
    updateRun(ctx.db, run.id, { gate: "open" });
    transition(ctx, job.key, {
      from: ["awaiting_push"],
      to: "running",
      fields: { blockedReason: null },
    });
  } else if (inSession(job) && job.state === "needs_input") {
    resume(ctx, job, run);
  } else if (job.state !== "running") {
    updateRun(ctx.db, run.id, { busy: true });

    if (job.state === "done" && job.prUrl) {
      if (!run.endedAt) {
        await endRun(ctx, job, run, run.result ?? { status: "done" });
      }

      transition(ctx, job.key, { from: ["done"], to: "running", fields: { blockedReason: null } });
    }
  }
}

function resume(ctx: MillContext, job: Job, run: Run): Job {
  if (!inSession(job) || job.state !== "needs_input") {
    return job;
  }

  if (!inEditTurn(job, run)) {
    updateRun(ctx.db, run.id, { result: null });
  }

  transition(ctx, job.key, {
    from: ["needs_input"],
    to: "running",
    fields: { blockedReason: null },
  });

  return getJob(ctx.db, job.key) ?? job;
}

function onSessionEnd(ctx: MillContext, job: Job, run: Run): void {
  updateRun(ctx.db, run.id, { busy: false });
  leftSession(ctx, job.key);
}

function leftSession(ctx: MillContext, key: number): void {
  if (getJob(ctx.db, key)?.blockedReason === SESSION_OPEN_REASON) {
    transition(ctx, key, { from: ["needs_input"], to: "done", fields: { blockedReason: null } });
  }
}

export async function followupState(
  ctx: MillContext,
  job: Job,
  run: Run,
): Promise<FollowupOutcome> {
  try {
    return followupOutcome(await readBranch(ctx, job, run), run.gate === "closed", true);
  } catch (error) {
    ctx.log(`reading the branch of ${job.id} failed: ${String(error)}`);

    return "needs_input";
  }
}

async function nothingToFix(ctx: MillContext, job: Job, run: Run): Promise<boolean> {
  if (!run.trigger) {
    return false;
  }

  try {
    const observation = await ctx.refresh(job);

    return observation !== undefined && triggerCleared(run.trigger, observation);
  } catch (error) {
    ctx.log(`refreshing the PR of ${job.id} failed: ${String(error)}`);

    return false;
  }
}

async function readBranch(ctx: MillContext, job: Job, run: Run): Promise<BranchState> {
  await withRepoLock(job.repoPath, () =>
    git(job.worktreePath, ["fetch", "origin", job.branchName]),
  ).catch((error: unknown) => ctx.log(`fetching ${job.branchName} failed: ${String(error)}`));

  return branchState(job.worktreePath, job.branchName, run.startSha);
}

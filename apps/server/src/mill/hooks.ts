import {
  FOLLOWUP_BLOCK_REASON,
  STOP_BLOCK_REASON,
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
  inSession,
  notify,
  send,
  transition,
} from "./lifecycle.ts";
import { permissionMode } from "./session.ts";

const NO_PR_REASON = "the agent session ended without a draft PR";

const UNPUSHED_REASON = "the follow-up session ended before its changes were pushed";

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

  return { reply: await dispatch(ctx, job, run, agent, parsed), type: parsed.type };
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
        onPrompt(ctx, job, run);
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
      await onSessionEnd(ctx, job, run);

      return null;
  }
}

function toolUseDenial(job: Job, run: Run, command: string): string | undefined {
  return (
    draftGateDenial(command) ??
    (run.gate
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

  let outcome: FollowupOutcome;

  if (run.kind === "feature") {
    const decision = stopDecision(await findDraft(ctx, job), event.stopHookActive);

    if (decision.kind === "done") {
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
      await completeFollowup(ctx, job.key, run);

      return null;
    case "awaiting_push":
      awaitPush(ctx, job.key);

      return null;
    case "block":
      return agent.blockStop(run.kind === "feature" ? STOP_BLOCK_REASON : FOLLOWUP_BLOCK_REASON);
    case "needs_input": {
      const transcript = event.transcriptPath ?? run.transcriptPath;
      const reason =
        event.lastMessage ||
        (transcript && (await agent.lastMessage(transcript).catch(() => undefined))) ||
        (run.kind === "feature"
          ? "the agent stopped without a draft PR"
          : "the agent stopped without pushing its changes");

      if (transition(ctx, job.key, { from: ["running"], to: "needs_input" })) {
        updateRun(ctx.db, run.id, { result: { status: "needs_input", reason } });
        notify(ctx, job.key, "running", "needs_input", reason);
      }

      return null;
    }
  }
}

function onPrompt(ctx: MillContext, job: Job, run: Run): void {
  if (job.state === "awaiting_push") {
    updateRun(ctx.db, run.id, { gate: "open" });
  } else if (inSession(job) && job.state === "needs_input") {
    updateRun(ctx.db, run.id, { result: null });
  } else {
    if (job.state !== "running") {
      updateRun(ctx.db, run.id, { busy: true });
    }

    return;
  }

  transition(ctx, job.key, {
    from: ["awaiting_push", "needs_input"],
    to: "running",
    fields: { blockedReason: null },
  });
}

async function onSessionEnd(ctx: MillContext, job: Job, run: Run): Promise<void> {
  if (run.endedAt) {
    return;
  }

  if (!inSession(job)) {
    await endRun(ctx, job, run, run.result ?? { status: "done" });
    leftSession(ctx, job.key);

    return;
  }

  if (run.kind !== "feature") {
    const outcome = await followupState(ctx, job, run);

    if (outcome === "done" || (outcome === "needs_input" && (await nothingToFix(ctx, job, run)))) {
      await endRun(ctx, job, run, { status: "done" });
      await completeFollowup(ctx, job.key, run);
    } else {
      await sessionGone(ctx, job, run, outcome, UNPUSHED_REASON);
    }

    return;
  }

  const prUrl = await findDraft(ctx, job);

  if (prUrl) {
    await endRun(ctx, job, run, { status: "done" });
    finish(ctx, job.key, prUrl);
  } else {
    await fail(ctx, job.key, run, NO_PR_REASON);
  }
}

function leftSession(ctx: MillContext, key: number): void {
  if (getJob(ctx.db, key)?.blockedReason === SESSION_OPEN_REASON) {
    transition(ctx, key, { from: ["needs_input"], to: "done", fields: { blockedReason: null } });
  }
}

export async function sessionGone(
  ctx: MillContext,
  job: Job,
  run: Run,
  outcome: FollowupOutcome,
  reason: string,
): Promise<void> {
  if (outcome === "awaiting_push" && getJob(ctx.db, job.key)?.state === "running") {
    await endRun(ctx, job, run, { status: "done" });
    awaitPush(ctx, job.key);
  } else {
    await fail(ctx, job.key, run, reason);
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

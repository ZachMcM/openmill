import { FOLLOWUP_SKILL, WORKFLOW_SKILL } from "@openmill/assets";
import type { FollowupTrigger } from "@openmill/core";
import type { Agent, RunInput } from "./types.ts";

export const APPROVED_MESSAGE =
  "The human approved these changes. Push and post your thread replies, then stop.";

const ASK =
  "To ask a question or report a blocker, write it as a normal message and stop. A human may answer you in this same session.";

function bullets(facts: Array<string | undefined>): string {
  return facts
    .filter(Boolean)
    .map((fact) => `- ${fact}`)
    .join("\n");
}

function inWorktree(branch: string): string {
  return `You are already in the job's worktree on branch ${branch}, so don't create another branch or worktree.`;
}

export function startPrompt(agent: Agent, input: RunInput): string {
  const facts = bullets([
    input.projectPath ? `The project overview is at ${input.projectPath}.` : undefined,
    `You are already in your worktree on branch ${input.branch}, so don't create another branch or worktree.`,
    `Open the draft PR against ${input.prBaseBranch}.`,
    ASK,
    "Don't stop until the draft PR is open, or until a human decision or missing access blocks the work.",
  ]);

  return `${agent.skillPrompt(WORKFLOW_SKILL, input.docPath)}\n\n${facts}\n`;
}

export function followupPrompt(
  agent: Agent,
  input: RunInput,
  prUrl: string,
  trigger: FollowupTrigger,
  push: boolean,
): string {
  const facts = bullets([
    trigger.threads.length > 0
      ? `Address these review threads: ${trigger.threads.join(", ")}.`
      : undefined,
    trigger.checks.length > 0
      ? `Fix these failing checks: ${trigger.checks.join(", ")}.`
      : undefined,
    inWorktree(input.branch),
    push
      ? "Push mode: push and reply when done."
      : "Push mode: commit but don't push or reply, then stop and say the changes are ready for review.",
    ASK,
  ]);

  return `${agent.skillPrompt(FOLLOWUP_SKILL, `${prUrl} ${input.docPath}`)}\n\n${facts}\n`;
}

export function restackPrompt(input: RunInput, base: string, cut: string, push: boolean): string {
  const facts = bullets([
    inWorktree(input.branch),
    `Run \`git rebase --onto origin/${base} ${cut}\` and resolve its conflicts, keeping what each commit on this branch meant to change.`,
    `Before you continue the rebase past a conflict, have a \`verify-correctness\` agent and a \`verify-simplicity\` agent confirm your resolution, as the ${FOLLOWUP_SKILL} skill describes, and run the repository's checks.`,
    push
      ? `Push mode: when the rebase is done, push with \`git push --force-with-lease origin ${input.branch}\` and stop.`
      : "Push mode: finish the rebase but don't push, then stop and say the changes are ready for review.",
    "Don't change the PR's base branch. openmill retargets it after the push.",
    ASK,
  ]);

  return `This branch's parent PR merged, so restack it onto ${base}.\n\n${facts}\n`;
}

import { PLUGIN_NAME, WORKFLOW_SKILL } from "@openmill/assets";
import type { RunInput } from "./types.ts";

export function startPrompt(input: RunInput): string {
  const facts = [
    input.projectPath ? `The project overview is at ${input.projectPath}.` : undefined,
    `You are already in your worktree on branch ${input.branch}, so don't create another branch or worktree.`,
    `Open the draft PR against ${input.prBaseBranch}.`,
    "No human is present. Wherever the skill says to ask or tell the user, stop and report needs_input with the question as reason.",
  ].filter(Boolean);

  return `/${PLUGIN_NAME}:${WORKFLOW_SKILL} ${input.docPath}\n\n${facts.map((fact) => `- ${fact}`).join("\n")}\n`;
}

export const HANDBACK_MESSAGE =
  "openmill handed this job back to you after a human worked on it. Check the worktree and the conversation, continue the workflow until the draft PR is open, then report the result.";

export const RESTART_MESSAGE =
  "The openmill server restarted while you were working. Check the worktree, continue the workflow from where you stopped, then report the result.";

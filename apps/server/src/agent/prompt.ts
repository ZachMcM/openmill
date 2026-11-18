import { PLUGIN_NAME, WORKFLOW_SKILL } from "@openmill/assets";
import type { RunInput } from "./types.ts";

export function startPrompt(input: RunInput): string {
  const facts = [
    input.projectPath ? `The project overview is at ${input.projectPath}.` : undefined,
    `You are already in your worktree on branch ${input.branch}, so don't create another branch or worktree.`,
    `Open the draft PR against ${input.prBaseBranch}.`,
    "To ask a question or report a blocker, write it as a normal message and stop. A human may answer you in this same session.",
    "Don't stop until the draft PR is open, or until a human decision or missing access blocks the work.",
  ].filter(Boolean);

  return `/${PLUGIN_NAME}:${WORKFLOW_SKILL} ${input.docPath}\n\n${facts.map((fact) => `- ${fact}`).join("\n")}\n`;
}

export type StopDecision =
  | { kind: "done"; prUrl: string }
  | { kind: "block" }
  | { kind: "needs_input" };

export const STOP_BLOCK_REASON = "Open the draft PR, or ask your question as a message and stop.";

export const FOLLOWUP_BLOCK_REASON =
  "Commit your fixes and leave the worktree clean, push them unless pushing is held for review, or ask your question as a message and stop.";

export const EDIT_BLOCK_REASON =
  "Commit your changes, push them to the PR branch, and leave the worktree clean, or ask your question as a message and stop.";

export function stopDecision(prUrl: string | undefined, stopHookActive: boolean): StopDecision {
  if (prUrl) {
    return { kind: "done", prUrl };
  }

  return stopHookActive ? { kind: "needs_input" } : { kind: "block" };
}

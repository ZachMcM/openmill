import type { JobState } from "./states.ts";

export interface ConflictInput {
  state: JobState;
  restacking: boolean;
  parentRestacking: boolean;
  blockedReason: string | null;
  base: string;
  mergeable: boolean | null;
}

export type ConflictDecision = "flag" | "clear" | "none";

export function conflictReason(base: string): string {
  return `the PR conflicts with ${base}`;
}

export function decideConflict(input: ConflictInput): ConflictDecision {
  if (
    input.mergeable === false &&
    input.state === "done" &&
    !input.restacking &&
    !input.parentRestacking
  ) {
    return "flag";
  }

  if (
    input.mergeable === true &&
    input.state === "needs_input" &&
    input.blockedReason === conflictReason(input.base)
  ) {
    return "clear";
  }

  return "none";
}

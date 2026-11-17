import type { Effort } from "@openmill/core";
import { z } from "zod";

export interface RunInput {
  id: string;
  worktree: string;
  docPath: string;
  projectPath?: string;
  branch: string;
  prBaseBranch: string;
  model?: string;
  effort: Effort;
}

const RUN_STATUSES = ["done", "needs_input", "failed"] as const;

export const runResultSchema = z
  .object({
    status: z.enum(RUN_STATUSES),
    pr_url: z.string().optional(),
    reason: z.string().optional(),
  })
  .refine((result) => result.status !== "done" || Boolean(result.pr_url), {
    message: "a done result needs pr_url",
  });

export type RunResult = z.infer<typeof runResultSchema>;

export const runResultJsonSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: RUN_STATUSES },
    pr_url: { type: "string", description: "The draft PR URL. Required when status is done." },
    reason: { type: "string", description: "Why the run stopped, or the question for a human." },
  },
  required: ["status"],
  additionalProperties: false,
} as const;

export type HarnessEvent =
  | { type: "session"; sessionId: string }
  | { type: "message"; message: unknown }
  | { type: "result"; result: RunResult }
  | { type: "error"; error: string };

export interface Harness {
  start(input: RunInput, signal: AbortSignal): AsyncIterable<HarnessEvent>;
  resume(
    sessionId: string,
    message: string,
    input: RunInput,
    signal: AbortSignal,
  ): AsyncIterable<HarnessEvent>;
}

export function resultEvent(output: unknown): HarnessEvent {
  const parsed = runResultSchema.safeParse(output);

  if (!parsed.success) {
    return {
      type: "error",
      error: `invalid result: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    };
  }

  return { type: "result", result: parsed.data };
}

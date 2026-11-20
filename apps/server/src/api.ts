import { AGENTS, JOB_STATES, PERMISSION_MODES, TERMINALS } from "@openmill/core";
import { z } from "zod";

export const addRequestSchema = z.object({
  repo: z.string().min(1),
  base: z.string().min(1).optional(),
  agent: z.enum(AGENTS).optional(),
  permissionMode: z.enum(PERMISSION_MODES).optional(),
  terminal: z.enum(TERMINALS).optional(),
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
  force: z.boolean().default(false),
  docs: z
    .array(
      z.object({
        id: z.string().min(1),
        path: z.string().min(1),
        content: z.string(),
        project: z.object({ path: z.string(), content: z.string() }).optional(),
        dependsOn: z.array(z.string()),
        explicit: z.boolean(),
      }),
    )
    .min(1),
});

export type AddRequest = z.infer<typeof addRequestSchema>;

export type AddAction = "added" | "updated" | "requeued" | "unchanged";

export interface JobSummary {
  id: string;
  repo: string;
  state: string;
  reason: string | null;
  sessionId: string | null;
  prUrl: string | null;
  waitingSince: number | null;
  windowClosed: boolean;
  updatedAt: number;
}

export interface JobDetail extends JobSummary {
  branch: string;
  worktree: string;
  prBaseBranch: string | null;
  window: string | null;
  transcriptPath: string | null;
  capturePath: string | null;
  lastResult: unknown;
}

export const jobQuerySchema = z.object({ repo: z.string().optional() });

export const jobListQuerySchema = z.object({
  since: z.iso.datetime({ offset: true }).optional(),
  state: z.union([z.enum(JOB_STATES), z.array(z.enum(JOB_STATES))]).optional(),
  repo: z.string().min(1).optional(),
  all: z.literal("true").optional(),
});

export type JobListQuery = z.infer<typeof jobListQuerySchema>;

export const configSetSchema = z.object({ value: z.string() });

export const hookRequestSchema = z.object({
  runId: z.number().int().positive(),
  payload: z.unknown(),
});

export const notifierTestSchema = z.object({ name: z.string().min(1).optional() });

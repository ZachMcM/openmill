import { EFFORTS, HARNESSES } from "@openmill/core";
import { z } from "zod";

export const addRequestSchema = z.object({
  repo: z.string().min(1),
  base: z.string().min(1).optional(),
  harness: z.enum(HARNESSES).optional(),
  model: z.string().min(1).optional(),
  effort: z.enum(EFFORTS).optional(),
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
}

export interface JobDetail extends JobSummary {
  branch: string;
  worktree: string;
  prBaseBranch: string | null;
  lastResult: unknown;
  logPath: string | null;
  resumeCommand: string | null;
}

export const jobQuerySchema = z.object({ repo: z.string().optional() });

export const configSetSchema = z.object({ value: z.string() });

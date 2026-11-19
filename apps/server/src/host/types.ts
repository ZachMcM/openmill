import type { PermissionMode } from "@openmill/core";
import type { Readiness } from "../agent/types.ts";

export interface HostStart {
  repoPath: string;
  worktreePath: string;
  title: string;
  prompt: string;
  model?: string;
  effort: string;
  permissionMode: PermissionMode;
}

export interface Host {
  ready(): Promise<Readiness>;
  start(input: HostStart): Promise<{ threadId: string }>;
  send(threadId: string, message: string): Promise<void>;
  status(threadId: string): Promise<{ alive: boolean }>;
  stop(threadId: string): Promise<void>;
  link(threadId: string): Promise<string>;
}

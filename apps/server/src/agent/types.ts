import type { Effort, PermissionMode } from "@openmill/core";

export interface RunInput {
  docPath: string;
  projectPath?: string;
  branch: string;
  prBaseBranch: string;
  model?: string;
  effort: Effort;
  permissionMode: PermissionMode;
  sessionId: string;
  hookCommand: string[];
}

export interface Launch {
  command: string[];
  env: Record<string, string>;
}

export interface PushGate {
  open: boolean;
  branch: string;
}

export type HookEvent =
  | { type: "stop"; transcriptPath?: string; stopHookActive: boolean; lastMessage?: string }
  | { type: "prompt"; transcriptPath?: string; autoMode?: boolean }
  | { type: "session_end"; transcriptPath?: string }
  | { type: "tool_use"; transcriptPath?: string; command?: string }
  | { type: "permission_wait"; transcriptPath?: string; message?: string };

export interface Agent {
  launch(input: RunInput, prompt: string): Launch;
  resume(input: RunInput, message?: string): Launch;
  parseHook(event: string, payload: unknown): HookEvent | undefined;
  denyToolUse(reason: string): unknown;
  lastMessage(transcriptPath: string): Promise<string | undefined>;
  blockStop(reason: string): unknown;
  trust(repo: string): Promise<void>;
}

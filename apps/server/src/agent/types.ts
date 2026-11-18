import type { Effort } from "@openmill/core";

export interface RunInput {
  docPath: string;
  projectPath?: string;
  branch: string;
  prBaseBranch: string;
  model?: string;
  effort: Effort;
  sessionId: string;
  hookCommand: string[];
  pushGate: boolean;
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
  | { type: "stop"; transcriptPath?: string; stopHookActive: boolean }
  | { type: "prompt"; transcriptPath?: string }
  | { type: "session_end"; transcriptPath?: string }
  | { type: "tool_use"; transcriptPath?: string; command?: string };

export interface Agent {
  launch(input: RunInput, prompt: string): Launch;
  resume(input: RunInput, message?: string): Launch;
  parseHook(event: string, payload: unknown): HookEvent | undefined;
  gateToolUse(event: Extract<HookEvent, { type: "tool_use" }>, gate: PushGate): unknown;
  lastMessage(transcriptPath: string): Promise<string | undefined>;
  blockStop(reason: string): unknown;
  trust(repo: string): Promise<void>;
}

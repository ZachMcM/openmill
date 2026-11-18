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
}

export interface Launch {
  command: string[];
  env: Record<string, string>;
}

export type HookEvent =
  | { type: "stop"; transcriptPath?: string; stopHookActive: boolean }
  | { type: "prompt"; transcriptPath?: string }
  | { type: "session_end"; transcriptPath?: string };

export interface Agent {
  launch(input: RunInput): Launch;
  resume(input: RunInput): Launch;
  parseHook(event: string, payload: unknown): HookEvent | undefined;
  lastMessage(transcriptPath: string): Promise<string | undefined>;
  blockStop(reason: string): unknown;
  trust(repo: string): Promise<void>;
}

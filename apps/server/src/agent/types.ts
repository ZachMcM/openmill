import type { ModelCatalog, PermissionMode } from "@openmill/core";

export interface RunInput {
  docPath: string;
  projectPath?: string;
  branch: string;
  prBaseBranch: string;
  model?: string;
  effort: string;
  permissionMode: PermissionMode;
  sessionId: string | null;
  hookCommand: string[];
  worktreePath: string;
  gitDir: string;
  gitCommonDir: string;
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
  | { type: "session_start"; sessionId: string; transcriptPath?: string }
  | {
      type: "stop";
      transcriptPath?: string;
      stopHookActive: boolean;
      lastMessage?: string;
      pendingWork?: boolean;
    }
  | { type: "prompt"; transcriptPath?: string; autoMode?: boolean }
  | { type: "session_end"; transcriptPath?: string }
  | { type: "tool_use"; transcriptPath?: string; command?: string }
  | { type: "permission_wait"; transcriptPath?: string; message?: string };

export type Readiness = { ok: true } | { ok: false; reason: string };

export interface Agent {
  presetSessionId: boolean;
  ready(permissionMode: PermissionMode): Promise<Readiness>;
  catalog(): Promise<ModelCatalog | undefined>;
  skillPrompt(skill: string, args: string): string;
  launch(input: RunInput, prompt: string): Launch;
  resume(input: RunInput, message?: string): Launch;
  parseHook(event: string, payload: unknown): HookEvent | undefined;
  denyToolUse(reason: string): unknown;
  lastMessage(transcriptPath: string): Promise<string | undefined>;
  blockStop(reason: string): unknown;
  trust(repo: string): Promise<void>;
}

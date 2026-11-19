import { join } from "node:path";
import { PLUGIN_NAME } from "@openmill/assets";
import { CODEX_MODELS_COMMAND, READY_CHECKS, parseCodexModels } from "@openmill/core";
import { z } from "zod";
import { exec } from "../exec.ts";
import { lastTranscriptText, preToolUseDenial, runChecks, shellQuote } from "./shared.ts";
import type { Agent, HookEvent, RunInput } from "./types.ts";

const HOOK_TYPES = {
  SessionStart: "session_start",
  Stop: "stop",
  UserPromptSubmit: "prompt",
  SessionEnd: "session_end",
  PreToolUse: "tool_use",
  PermissionRequest: "permission_wait",
} as const satisfies Record<string, HookEvent["type"]>;

const SESSION_HOOKS = ["SessionStart", "Stop", "UserPromptSubmit", "SessionEnd"] as const;

const SHELL_TOOL = "Bash";

const PROFILE = "openmill";

const hookPayloadSchema = z.object({
  session_id: z.string(),
  transcript_path: z.string().nullish(),
  stop_hook_active: z.boolean().optional(),
  last_assistant_message: z.string().nullish(),
  tool_name: z.string().optional(),
  tool_input: z
    .looseObject({ command: z.string().optional(), description: z.string().optional() })
    .optional(),
});

const rolloutLineSchema = z.object({
  type: z.literal("response_item"),
  payload: z.object({
    type: z.literal("message"),
    role: z.literal("assistant"),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  }),
});

const doctorSchema = z.object({
  checks: z.object({
    "config.load": z.object({ details: z.object({ model: z.string().optional() }) }),
  }),
});

function toml(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(toml).join(",")}]`;
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).map(
      ([key, item]) => `${JSON.stringify(key)}=${toml(item)}`,
    );

    return `{${entries.join(",")}}`;
  }

  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function config(key: string, value: unknown): string[] {
  return ["-c", `${key}=${toml(value)}`];
}

function hookArgs(input: RunInput): string[] {
  const base = input.hookCommand.map(shellQuote).join(" ");
  const hook = (event: keyof typeof HOOK_TYPES, matcher?: string) =>
    config(`hooks.${event}`, [
      {
        ...(matcher ? { matcher } : {}),
        hooks: [{ type: "command", command: `${base} hook ${event}` }],
      },
    ]);

  return [
    ...SESSION_HOOKS.flatMap((event) => hook(event)),
    ...hook("PreToolUse", SHELL_TOOL),
    // PermissionRequest fires before auto-review decides, so in auto mode it would page for
    // actions the reviewer then approves.
    ...(input.permissionMode === "bypass" ? hook("PermissionRequest", "*") : []),
  ];
}

// Workspace-write keeps a worktree's git metadata read-only, which lives under the main repo's
// .git, so commits fail without these write rules.
function permissionArgs(input: RunInput): string[] {
  if (input.permissionMode === "bypass") {
    return ["--dangerously-bypass-approvals-and-sandbox"];
  }

  return [
    "-a",
    "on-request",
    ...config("approvals_reviewer", "auto_review"),
    ...config("default_permissions", PROFILE),
    ...config(`permissions.${PROFILE}.extends`, ":workspace"),
    ...config(`permissions.${PROFILE}.filesystem`, {
      [input.gitCommonDir]: "write",
      [input.gitDir]: "write",
      [join(input.gitCommonDir, "hooks")]: "read",
    }),
    ...config(`permissions.${PROFILE}.network.enabled`, true),
  ];
}

function sharedArgs(input: RunInput): string[] {
  return [
    ...permissionArgs(input),
    "--dangerously-bypass-hook-trust",
    "-C",
    input.worktreePath,
    ...config("projects", { [input.worktreePath]: { trust_level: "trusted" } }),
    ...hookArgs(input),
    ...(input.model ? ["-m", input.model] : []),
    ...config("model_reasoning_effort", input.effort),
  ];
}

async function defaultModel(): Promise<string | undefined> {
  try {
    const report = doctorSchema.parse(
      JSON.parse(await exec("codex", ["doctor", "--json"], process.cwd())),
    );

    return report.checks["config.load"].details.model;
  } catch {
    return undefined;
  }
}

export const codexAgent: Agent = {
  presetSessionId: false,

  async ready(permissionMode) {
    const ready = await runChecks(READY_CHECKS.codex);

    if (ready.ok && permissionMode === "auto" && process.platform === "linux") {
      const bwrap = await runChecks([["bwrap", "--version"]]);

      return bwrap.ok ? bwrap : { ok: false, reason: "codex auto mode needs bubblewrap on Linux" };
    }

    return ready;
  },

  async catalog() {
    const [command, ...args] = CODEX_MODELS_COMMAND;
    const [models, model] = await Promise.all([exec(command, args, process.cwd()), defaultModel()]);

    return { defaultModel: model, models: parseCodexModels(JSON.parse(models)) };
  },

  skillPrompt(skill, args) {
    return `$${PLUGIN_NAME}:${skill} ${args}`;
  },

  launch(input, prompt) {
    return { command: ["codex", ...sharedArgs(input), prompt], env: {} };
  },

  resume(input, message) {
    return {
      command: [
        "codex",
        "resume",
        input.sessionId as string,
        ...sharedArgs(input),
        ...(message ? [message] : []),
      ],
      env: {},
    };
  },

  parseHook(event, payload) {
    const type = HOOK_TYPES[event as keyof typeof HOOK_TYPES];
    const parsed = hookPayloadSchema.safeParse(payload);

    if (!type || !parsed.success) {
      return undefined;
    }

    const transcriptPath = parsed.data.transcript_path ?? undefined;
    const tool = parsed.data.tool_input;
    const command = parsed.data.tool_name === SHELL_TOOL ? tool?.command : undefined;

    switch (type) {
      case "session_start":
        return { type, sessionId: parsed.data.session_id, transcriptPath };
      case "stop":
        return {
          type,
          transcriptPath,
          stopHookActive: parsed.data.stop_hook_active ?? false,
          lastMessage: parsed.data.last_assistant_message ?? undefined,
        };
      case "tool_use":
        return { type, transcriptPath, command };
      case "permission_wait":
        return { type, transcriptPath, message: tool?.description ?? tool?.command };
      default:
        return { type, transcriptPath };
    }
  },

  denyToolUse: preToolUseDenial,

  lastMessage(transcriptPath) {
    return lastTranscriptText(transcriptPath, (line) => {
      const parsed = rolloutLineSchema.safeParse(line);

      return parsed.success
        ? parsed.data.payload.content
            .flatMap((block) => (block.type === "output_text" && block.text ? [block.text] : []))
            .join("\n")
        : undefined;
    });
  },

  blockStop(reason) {
    return { decision: "block", reason };
  },

  async trust() {},
};

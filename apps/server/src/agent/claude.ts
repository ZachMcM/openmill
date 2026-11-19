import { readFile, realpath, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { PLUGIN_NAME, pluginDir } from "@openmill/assets";
import { READY_CHECKS } from "@openmill/core";
import { z } from "zod";
import { loadClaudeAgents } from "./agents.ts";
import { lastTranscriptText, preToolUseDenial, runChecks, shellQuote } from "./shared.ts";
import type { Agent, HookEvent, RunInput } from "./types.ts";

const HOOK_TYPES = {
  Stop: "stop",
  UserPromptSubmit: "prompt",
  SessionEnd: "session_end",
  PreToolUse: "tool_use",
  Notification: "permission_wait",
} as const satisfies Record<string, HookEvent["type"]>;

const SESSION_HOOKS = ["Stop", "UserPromptSubmit", "SessionEnd"] as const;

const hookPayloadSchema = z.object({
  session_id: z.string(),
  transcript_path: z.string().optional(),
  stop_hook_active: z.boolean().optional(),
  last_assistant_message: z.string().optional(),
  permission_mode: z.string().optional(),
  notification_type: z.string().optional(),
  message: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.looseObject({ command: z.string().optional() }).optional(),
});

const transcriptLineSchema = z.object({
  type: z.literal("assistant"),
  message: z.object({
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  }),
});

const configSchema = z.looseObject({
  projects: z
    .record(z.string(), z.looseObject({ hasTrustDialogAccepted: z.boolean().optional() }))
    .optional(),
});

function configPath(): string {
  return join(process.env.CLAUDE_CONFIG_DIR ?? homedir(), ".claude.json");
}

async function readConfig(path: string): Promise<z.infer<typeof configSchema>> {
  try {
    return configSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

function hooksSettings(input: RunInput): string {
  const base = input.hookCommand.map(shellQuote).join(" ");
  const hook = (event: keyof typeof HOOK_TYPES) => ({
    hooks: [{ type: "command", command: `${base} hook ${event}` }],
  });
  const hooks = {
    ...Object.fromEntries(SESSION_HOOKS.map((event) => [event, [hook(event)]])),
    PreToolUse: [{ matcher: "Bash", ...hook("PreToolUse") }],
    Notification: [{ matcher: "permission_prompt", ...hook("Notification") }],
  };

  return JSON.stringify({ hooks });
}

function sharedArgs(input: RunInput): string[] {
  return [
    ...(input.permissionMode === "auto"
      ? ["--permission-mode", "auto"]
      : ["--dangerously-skip-permissions"]),
    "--plugin-dir",
    pluginDir,
    "--agents",
    JSON.stringify(loadClaudeAgents()),
    "--settings",
    hooksSettings(input),
    ...(input.model ? ["--model", input.model] : []),
    "--effort",
    input.effort,
  ];
}

export const claudeAgent: Agent = {
  presetSessionId: true,

  ready() {
    return runChecks(READY_CHECKS.claude);
  },

  async catalog() {
    return undefined;
  },

  skillPrompt(skill, args) {
    return `/${PLUGIN_NAME}:${skill} ${args}`;
  },

  launch(input, prompt) {
    return {
      command: ["claude", "--session-id", input.sessionId as string, ...sharedArgs(input), prompt],
      env: {},
    };
  },

  resume(input, message) {
    return {
      command: [
        "claude",
        "--resume",
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

    const { transcript_path: transcriptPath, permission_mode: mode } = parsed.data;

    switch (type) {
      case "stop":
        return {
          type,
          transcriptPath,
          stopHookActive: parsed.data.stop_hook_active ?? false,
          lastMessage: parsed.data.last_assistant_message,
        };
      case "prompt":
        return { type, transcriptPath, autoMode: mode === undefined ? undefined : mode === "auto" };
      case "tool_use":
        return {
          type,
          transcriptPath,
          command: parsed.data.tool_name === "Bash" ? parsed.data.tool_input?.command : undefined,
        };
      case "permission_wait":
        return parsed.data.notification_type === "permission_prompt"
          ? { type, transcriptPath, message: parsed.data.message }
          : undefined;
      default:
        return { type, transcriptPath };
    }
  },

  denyToolUse: preToolUseDenial,

  lastMessage(transcriptPath) {
    return lastTranscriptText(transcriptPath, (line) => {
      const parsed = transcriptLineSchema.safeParse(line);

      return parsed.success
        ? parsed.data.message.content
            .flatMap((block) => (block.type === "text" && block.text ? [block.text] : []))
            .join("\n")
        : undefined;
    });
  },

  blockStop(reason) {
    return { decision: "block", reason };
  },

  // Interactive claude asks whether to trust every new folder, and a worktree inherits the trust
  // of its main repo, so trusting the repo lets each job start unattended.
  async trust(repo) {
    const trusted = await realpath(repo);
    const path = configPath();
    const config = await readConfig(path);

    if (config.projects?.[trusted]?.hasTrustDialogAccepted) {
      return;
    }

    const projects = config.projects ?? {};

    projects[trusted] = { ...projects[trusted], hasTrustDialogAccepted: true };

    const temp = `${path}.openmill-${process.pid}`;

    await writeFile(temp, `${JSON.stringify({ ...config, projects }, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, path);
  },
};

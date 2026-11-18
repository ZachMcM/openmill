import { readFile, realpath, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pluginDir } from "@openmill/assets";
import { z } from "zod";
import { loadClaudeAgents } from "./agents.ts";
import { pushGateDenial } from "./claude-push-gate.ts";
import type { Agent, HookEvent, RunInput } from "./types.ts";

const HOOK_TYPES = {
  Stop: "stop",
  UserPromptSubmit: "prompt",
  SessionEnd: "session_end",
  PreToolUse: "tool_use",
} as const satisfies Record<string, HookEvent["type"]>;

const SESSION_HOOKS = ["Stop", "UserPromptSubmit", "SessionEnd"] as const;

const hookPayloadSchema = z.object({
  session_id: z.string(),
  transcript_path: z.string().optional(),
  stop_hook_active: z.boolean().optional(),
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

function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

function hooksSettings(input: RunInput): string {
  const base = input.hookCommand.map(shellQuote).join(" ");
  const hook = (event: keyof typeof HOOK_TYPES) => ({
    hooks: [{ type: "command", command: `${base} hook ${event}` }],
  });
  const hooks: Record<string, unknown[]> = Object.fromEntries(
    SESSION_HOOKS.map((event) => [event, [hook(event)]]),
  );

  if (input.pushGate) {
    hooks.PreToolUse = [{ matcher: "Bash", ...hook("PreToolUse") }];
  }

  return JSON.stringify({ hooks });
}

function sharedArgs(input: RunInput): string[] {
  return [
    "--dangerously-skip-permissions",
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
  launch(input, prompt) {
    return {
      command: ["claude", "--session-id", input.sessionId, ...sharedArgs(input), prompt],
      env: {},
    };
  },

  resume(input, message) {
    return {
      command: [
        "claude",
        "--resume",
        input.sessionId,
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

    const { transcript_path: transcriptPath } = parsed.data;

    switch (type) {
      case "stop":
        return { type, transcriptPath, stopHookActive: parsed.data.stop_hook_active ?? false };
      case "tool_use":
        return {
          type,
          transcriptPath,
          command: parsed.data.tool_name === "Bash" ? parsed.data.tool_input?.command : undefined,
        };
      default:
        return { type, transcriptPath };
    }
  },

  gateToolUse(event, gate) {
    const reason = event.command ? pushGateDenial(event.command, gate) : undefined;

    return reason
      ? {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: reason,
          },
        }
      : null;
  },

  async lastMessage(transcriptPath) {
    const lines = (await readFile(transcriptPath, "utf8")).split("\n");

    for (const line of lines.toReversed()) {
      let json: unknown;

      try {
        json = JSON.parse(line);
      } catch {
        continue;
      }

      const parsed = transcriptLineSchema.safeParse(json);
      const text = parsed.success
        ? parsed.data.message.content
            .flatMap((block) => (block.type === "text" && block.text ? [block.text] : []))
            .join("\n")
            .trim()
        : "";

      if (text) {
        return text;
      }
    }

    return undefined;
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

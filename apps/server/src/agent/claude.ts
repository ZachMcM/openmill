import { readFile, realpath, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pluginDir } from "@openmill/assets";
import { z } from "zod";
import { loadClaudeAgents } from "./agents.ts";
import { startPrompt } from "./prompt.ts";
import type { Agent, HookEvent, RunInput } from "./types.ts";

const HOOK_TYPES = {
  Stop: "stop",
  UserPromptSubmit: "prompt",
  SessionEnd: "session_end",
} as const satisfies Record<string, HookEvent["type"]>;

const hookPayloadSchema = z.object({
  session_id: z.string(),
  transcript_path: z.string().optional(),
  stop_hook_active: z.boolean().optional(),
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

function hooksSettings(hookCommand: string[]): string {
  const base = hookCommand.map(shellQuote).join(" ");
  const hooks = Object.fromEntries(
    Object.keys(HOOK_TYPES).map((event) => [
      event,
      [{ hooks: [{ type: "command", command: `${base} hook ${event}` }] }],
    ]),
  );

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
    hooksSettings(input.hookCommand),
    ...(input.model ? ["--model", input.model] : []),
    "--effort",
    input.effort,
  ];
}

export const claudeAgent: Agent = {
  launch(input) {
    return {
      command: [
        "claude",
        "--session-id",
        input.sessionId,
        ...sharedArgs(input),
        startPrompt(input),
      ],
      env: {},
    };
  },

  resume(input) {
    return { command: ["claude", "--resume", input.sessionId, ...sharedArgs(input)], env: {} };
  },

  parseHook(event, payload) {
    const type = HOOK_TYPES[event as keyof typeof HOOK_TYPES];
    const parsed = hookPayloadSchema.safeParse(payload);

    if (!type || !parsed.success) {
      return undefined;
    }

    const { transcript_path: transcriptPath } = parsed.data;

    return type === "stop"
      ? { type, transcriptPath, stopHookActive: parsed.data.stop_hook_active ?? false }
      : { type, transcriptPath };
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

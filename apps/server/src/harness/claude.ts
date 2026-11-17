import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { pluginDir } from "@openmill/assets";
import { loadClaudeAgents } from "./agents.ts";
import { startPrompt } from "./prompt.ts";
import {
  resultEvent,
  runResultJsonSchema,
  type Harness,
  type HarnessEvent,
  type RunInput,
} from "./types.ts";

function options(input: RunInput, signal: AbortSignal): Options {
  const abortController = new AbortController();

  signal.addEventListener("abort", () => abortController.abort(), { once: true });

  return {
    cwd: input.worktree,
    plugins: [{ type: "local", path: pluginDir }],
    agents: loadClaudeAgents(),
    settingSources: ["user", "project"],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    ...(input.model ? { model: input.model } : {}),
    effort: input.effort,
    outputFormat: { type: "json_schema", schema: runResultJsonSchema },
    abortController,
  };
}

export const claudeHarness: Harness = {
  start(input, signal) {
    return events(query({ prompt: startPrompt(input), options: options(input, signal) }));
  },
  resume(sessionId, message, input, signal) {
    return events(
      query({ prompt: message, options: { ...options(input, signal), resume: sessionId } }),
    );
  },
};

async function* events(messages: AsyncIterable<SDKMessage>): AsyncIterable<HarnessEvent> {
  for await (const message of messages) {
    yield { type: "message", message };

    if (message.type === "system" && message.subtype === "init") {
      yield { type: "session", sessionId: message.session_id };
    }

    if (message.type === "result") {
      if (message.subtype === "success" && !message.is_error) {
        yield resultEvent(message.structured_output);
      } else {
        const detail = "errors" in message ? message.errors.join("; ") : message.result;

        yield { type: "error", error: `${message.subtype}: ${detail}` };
      }
    }
  }
}

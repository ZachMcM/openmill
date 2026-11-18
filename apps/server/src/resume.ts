import { pluginDir } from "@openmill/assets";
import { loadClaudeAgents } from "./harness/agents.ts";

export function resumeCommand(worktree: string, sessionId: string): string {
  return [
    "cd",
    shellQuote(worktree),
    "&&",
    "claude",
    "--resume",
    shellQuote(sessionId),
    "--plugin-dir",
    shellQuote(pluginDir),
    "--agents",
    shellQuote(JSON.stringify(loadClaudeAgents())),
  ].join(" ");
}

function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

import { fileURLToPath } from "node:url";

/** The skill every worker runs. Prompts invoke it by this name. */
export const WORKFLOW_SKILL = "autonomous-feature-pr";

/** Subagents the workflow skill calls before each commit. */
export const REVIEW_AGENTS = ["verifier", "code-simplifier"] as const;

/** Holds `<skill-name>/SKILL.md`, the shared format Claude Code and Codex both read. */
export const skillsDir: string = fileURLToPath(new URL("../skills", import.meta.url));

/** Claude Code subagents as `<name>.md`. */
export const claudeAgentsDir: string = fileURLToPath(new URL("../agents/claude", import.meta.url));

/** Codex subagents as `<name>.toml`. */
export const codexAgentsDir: string = fileURLToPath(new URL("../agents/codex", import.meta.url));

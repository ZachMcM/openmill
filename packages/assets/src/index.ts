import { fileURLToPath } from "node:url";

export const WORKFLOW_SKILL = "autonomous-feature-pr";

export const FOLLOWUP_SKILL = "address-pr-feedback";

export const REVIEW_AGENTS = ["verifier", "code-simplifier"] as const;

export const pluginDir: string = fileURLToPath(new URL("..", import.meta.url));

export const PLUGIN_NAME = "openmill";

export const skillsDir: string = fileURLToPath(new URL("../skills", import.meta.url));

export const claudeAgentsDir: string = fileURLToPath(new URL("../agents/claude", import.meta.url));

export const codexAgentsDir: string = fileURLToPath(new URL("../agents/codex", import.meta.url));

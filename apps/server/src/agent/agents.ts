import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REVIEW_AGENTS, claudeAgentsDir } from "@openmill/assets";
import { splitFrontmatter } from "@openmill/core";

interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
}

export function loadClaudeAgents(): Record<string, AgentDefinition> {
  const agents: Record<string, AgentDefinition> = {};

  for (const name of REVIEW_AGENTS) {
    const { data, body } = splitFrontmatter(
      readFileSync(join(claudeAgentsDir, `${name}.md`), "utf8"),
    );
    const agent: AgentDefinition = {
      description: String(data.description ?? ""),
      prompt: body.trim(),
    };

    if (typeof data.tools === "string") {
      agent.tools = data.tools.split(",").map((tool) => tool.trim());
    }

    if (typeof data.model === "string") {
      agent.model = data.model;
    }

    agents[typeof data.name === "string" ? data.name : name] = agent;
  }

  return agents;
}

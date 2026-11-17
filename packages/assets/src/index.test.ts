import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REVIEW_AGENTS,
  WORKFLOW_SKILL,
  claudeAgentsDir,
  codexAgentsDir,
  skillsDir,
} from "./index.ts";

describe("assets", () => {
  it("ships the workflow skill", () => {
    expect(existsSync(join(skillsDir, WORKFLOW_SKILL, "SKILL.md"))).toBe(true);
  });

  it.each(REVIEW_AGENTS)("ships the %s agent for both harnesses", (name) => {
    expect(existsSync(join(claudeAgentsDir, `${name}.md`))).toBe(true);
    expect(existsSync(join(codexAgentsDir, `${name}.toml`))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { parseCodexModels, resolveEffort, type ModelCatalog } from "./agents.ts";

const catalog: ModelCatalog = {
  defaultModel: "gpt-6.1-sol",
  models: parseCodexModels({
    models: [
      {
        slug: "gpt-6-luna",
        visibility: "list",
        priority: 6,
        default_reasoning_level: "medium",
        supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
      },
      {
        slug: "gpt-6.1-sol",
        visibility: "list",
        priority: 1,
        default_reasoning_level: "low",
        supported_reasoning_levels: [{ effort: "low" }, { effort: "ultra" }],
      },
    ],
  }),
};

describe("resolveEffort", () => {
  it("passes a level the model supports", () => {
    expect(resolveEffort("codex", "gpt-6-luna", "high", catalog)).toEqual({ ok: true });
  });

  it("checks against the default model when none is set", () => {
    expect(resolveEffort("codex", undefined, "ultra", catalog).ok).toBe(true);
    expect(resolveEffort("codex", undefined, "medium", catalog)).toEqual({
      ok: false,
      error: "gpt-6.1-sol supports low, ultra",
      model: "gpt-6.1-sol",
      fallback: "low",
    });
  });

  it("falls back to the first visible model when the default isn't in the catalog", () => {
    expect(
      resolveEffort("codex", undefined, "medium", { ...catalog, defaultModel: "<default>" }),
    ).toMatchObject({ ok: false, model: "gpt-6.1-sol" });
  });

  it("rejects an unsupported level with the model's list and its default as the reset", () => {
    expect(resolveEffort("codex", "gpt-6-luna", "ultra", catalog)).toEqual({
      ok: false,
      error: "gpt-6-luna supports low, medium, high",
      model: "gpt-6-luna",
      fallback: "medium",
    });
  });

  it("uses Claude's levels for Claude", () => {
    expect(resolveEffort("claude", undefined, "max", undefined).ok).toBe(true);
    expect(resolveEffort("claude", "claude-opus-5-5", "ultra", undefined)).toEqual({
      ok: false,
      error: "claude-opus-5-5 supports low, medium, high, xhigh, max",
      model: "claude-opus-5-5",
      fallback: "medium",
    });
  });
});

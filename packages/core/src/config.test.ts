import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, parseConfigValue, resolveConfig } from "./config.ts";

describe("config", () => {
  it("parses values by key", () => {
    expect(parseConfigValue("concurrency", "4")).toEqual({ ok: true, value: 4 });
    expect(parseConfigValue("concurrency", "0").ok).toBe(false);
    expect(parseConfigValue("concurrency", "1.5").ok).toBe(false);
    expect(parseConfigValue("effort", "xhigh")).toEqual({ ok: true, value: "xhigh" });
    expect(parseConfigValue("effort", "huge").ok).toBe(false);
    expect(parseConfigValue("harness", "codex").ok).toBe(false);
    expect(parseConfigValue("model", "opus")).toEqual({ ok: true, value: "opus" });
  });

  it("fills defaults and drops unknown or invalid stored values", () => {
    expect(resolveConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(resolveConfig({ concurrency: 3, effort: "nope", extra: 1, model: "sonnet" })).toEqual({
      ...DEFAULT_CONFIG,
      concurrency: 3,
      model: "sonnet",
    });
  });
});

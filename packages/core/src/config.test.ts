import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, parseConfigValue, resolveConfig } from "./config.ts";

describe("config", () => {
  it("parses values by key", () => {
    expect(parseConfigValue("concurrency", "4")).toEqual({ ok: true, value: 4 });
    expect(parseConfigValue("concurrency", "0").ok).toBe(false);
    expect(parseConfigValue("concurrency", "1.5").ok).toBe(false);
    expect(parseConfigValue("effort", "xhigh")).toEqual({ ok: true, value: "xhigh" });
    expect(parseConfigValue("effort", "huge").ok).toBe(false);
    expect(parseConfigValue("agent", "codex").ok).toBe(false);
    expect(parseConfigValue("model", "opus")).toEqual({ ok: true, value: "opus" });
    expect(parseConfigValue("notify_desktop", "false")).toEqual({ ok: true, value: false });
    expect(parseConfigValue("notify_desktop", "no").ok).toBe(false);
    expect(parseConfigValue("notify_command", "")).toEqual({ ok: true, value: undefined });
    expect(parseConfigValue("watch_interval", "30")).toEqual({ ok: true, value: 30 });
    expect(parseConfigValue("watch_interval", "29").ok).toBe(false);
    expect(parseConfigValue("review_push", "auto")).toEqual({ ok: true, value: "auto" });
    expect(parseConfigValue("ci_push", "never").ok).toBe(false);
    expect(parseConfigValue("followup_attempts", "0").ok).toBe(false);
    expect(parseConfigValue("trusted_bots", "a[bot], b[bot],")).toEqual({
      ok: true,
      value: ["a[bot]", "b[bot]"],
    });
  });

  it("fills defaults and drops unknown or invalid stored values", () => {
    expect(resolveConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(
      resolveConfig({
        concurrency: 3,
        effort: "nope",
        extra: 1,
        model: "sonnet",
        trusted_bots: ["a[bot]", "b[bot]"],
      }),
    ).toEqual({
      ...DEFAULT_CONFIG,
      concurrency: 3,
      model: "sonnet",
      trusted_bots: ["a[bot]", "b[bot]"],
    });
  });
});

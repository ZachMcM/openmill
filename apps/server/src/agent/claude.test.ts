import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { claudeAgent } from "./claude.ts";
import { startPrompt } from "./prompt.ts";
import type { RunInput } from "./types.ts";

const input: RunInput = {
  docPath: "/jobs/login/login.md",
  branch: "openmill/login",
  prBaseBranch: "main",
  model: "claude-opus-5-5",
  effort: "high",
  sessionId: "0b7c4a52-5f0e-4c61-9d53-6a4c1f6f2a10",
  hookCommand: ["/usr/bin/node", "/opt/open mill/openmill.mjs"],
  pushGate: false,
};

function settingsHooks(command: string[]) {
  return (
    JSON.parse(flag(command, "--settings") ?? "{}") as {
      hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
    }
  ).hooks;
}

function flag(command: string[], name: string): string | undefined {
  const index = command.indexOf(name);

  return index === -1 ? undefined : command[index + 1];
}

describe("claudeAgent.launch", () => {
  const { command } = claudeAgent.launch(input, startPrompt(input));

  it("starts a new interactive session with the given id and the workflow prompt", () => {
    expect(command[0]).toBe("claude");
    expect(command).toContain("--dangerously-skip-permissions");
    expect(command).not.toContain("-p");
    expect(flag(command, "--session-id")).toBe(input.sessionId);
    expect(flag(command, "--model")).toBe("claude-opus-5-5");
    expect(flag(command, "--effort")).toBe("high");
    expect(command.at(-1)).toMatch(/^\/openmill:autonomous-feature-pr \/jobs\/login\/login\.md\n/);
    expect(command.at(-1)).toContain("against main");
  });

  it("passes the review agents and per-run hooks that call openmill hook", () => {
    expect(Object.keys(JSON.parse(flag(command, "--agents") ?? "{}"))).toEqual(
      expect.arrayContaining(["verifier", "code-simplifier"]),
    );

    const hooks = settingsHooks(command);

    expect(Object.keys(hooks).toSorted()).toEqual(["SessionEnd", "Stop", "UserPromptSubmit"]);
    expect(hooks.Stop?.[0]?.hooks[0]?.command).toBe(
      "/usr/bin/node '/opt/open mill/openmill.mjs' hook Stop",
    );
  });

  it("adds a Bash PreToolUse hook only for gated runs", () => {
    const hooks = settingsHooks(claudeAgent.launch({ ...input, pushGate: true }, "go").command);

    expect(hooks.PreToolUse?.[0]?.matcher).toBe("Bash");
    expect(hooks.PreToolUse?.[0]?.hooks[0]?.command).toMatch(/ hook PreToolUse$/);
  });

  it("leaves the model out when none is set", () => {
    expect(claudeAgent.launch({ ...input, model: undefined }, "go").command).not.toContain(
      "--model",
    );
  });
});

describe("claudeAgent.resume", () => {
  it("resumes the session with the same settings and no prompt", () => {
    const launch = claudeAgent.launch(input, "go").command;
    const { command } = claudeAgent.resume(input);

    expect(flag(command, "--resume")).toBe(input.sessionId);
    expect(command).not.toContain("--session-id");
    expect(flag(command, "--settings")).toBe(flag(launch, "--settings"));
    expect(flag(command, "--agents")).toBe(flag(launch, "--agents"));
    expect(command.at(-1)).toBe("high");
    expect(claudeAgent.resume(input, "Push it.").command.at(-1)).toBe("Push it.");
  });
});

describe("claudeAgent.parseHook", () => {
  const payload = { session_id: "s1", transcript_path: "/t.jsonl" };

  it("reads stop, prompt, and session end events", () => {
    expect(claudeAgent.parseHook("Stop", { ...payload, stop_hook_active: true })).toEqual({
      type: "stop",
      transcriptPath: "/t.jsonl",
      stopHookActive: true,
    });
    expect(claudeAgent.parseHook("UserPromptSubmit", payload)?.type).toBe("prompt");
    expect(claudeAgent.parseHook("SessionEnd", payload)?.type).toBe("session_end");
  });

  it("reads the command of a Bash tool call and denies it when the gate holds it", () => {
    const event = claudeAgent.parseHook("PreToolUse", {
      ...payload,
      tool_name: "Bash",
      tool_input: { command: "git push" },
    });

    expect(event).toEqual({ type: "tool_use", transcriptPath: "/t.jsonl", command: "git push" });

    if (event?.type !== "tool_use") {
      throw new Error("expected a tool_use event");
    }

    expect(claudeAgent.gateToolUse(event, { open: false, branch: "openmill/login" })).toMatchObject(
      { hookSpecificOutput: { permissionDecision: "deny" } },
    );
    expect(claudeAgent.gateToolUse(event, { open: true, branch: "openmill/login" })).toBeNull();
  });

  it("ignores unknown events and malformed payloads", () => {
    expect(claudeAgent.parseHook("Notification", payload)).toBeUndefined();
    expect(claudeAgent.parseHook("Stop", { transcript_path: "/t.jsonl" })).toBeUndefined();
  });
});

describe("claudeAgent.lastMessage", () => {
  it("returns the last assistant text, skipping tool calls, thinking, and hook feedback", async () => {
    const path = fileURLToPath(new URL("transcript.fixture.jsonl", import.meta.url));

    expect(await claudeAgent.lastMessage(path)).toBe(
      "Should sessions expire after 30 days or never?",
    );
  });
});

describe("claudeAgent.trust", () => {
  it("trusts the repo and keeps the rest of the user's Claude config", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "openmill-trust-")));
    const config = join(dir, ".claude.json");
    const repo = join(dir, "app");

    vi.stubEnv("CLAUDE_CONFIG_DIR", dir);
    writeFileSync(
      config,
      JSON.stringify({ theme: "dark", projects: { "/src/app": { hasTrustDialogAccepted: true } } }),
    );

    try {
      mkdirSync(repo);
      await claudeAgent.trust(repo);

      expect(JSON.parse(readFileSync(config, "utf8"))).toEqual({
        theme: "dark",
        projects: {
          "/src/app": { hasTrustDialogAccepted: true },
          [repo]: { hasTrustDialogAccepted: true },
        },
      });
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

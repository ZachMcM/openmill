import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import hooks from "./codex-hooks.fixture.json" with { type: "json" };
import { codexAgent } from "./codex.ts";
import { startPrompt } from "./prompt.ts";
import type { RunInput } from "./types.ts";

const input: RunInput = {
  docPath: "/jobs/login/login.md",
  branch: "openmill/login",
  prBaseBranch: "main",
  model: "gpt-6.1-sol",
  effort: "ultra",
  permissionMode: "auto",
  sessionId: null,
  hookCommand: ["/usr/bin/node", "/opt/open mill/openmill.mjs"],
  worktreePath: "/home/me/.openmill/worktrees/app/login",
  gitDir: "/home/me/app/.git/worktrees/login",
  gitCommonDir: "/home/me/app/.git",
};

function configs(command: string[]): string[] {
  return command.flatMap((arg, index) => (command[index - 1] === "-c" ? [arg] : []));
}

describe("codexAgent.launch", () => {
  const { command } = codexAgent.launch(input, startPrompt(codexAgent, input));
  const overrides = configs(command);

  it("starts an interactive session in the worktree with the workflow skill", () => {
    expect(command[0]).toBe("codex");
    expect(command).toContain("--dangerously-bypass-hook-trust");
    expect(command.slice(command.indexOf("-C"), command.indexOf("-C") + 2)).toEqual([
      "-C",
      input.worktreePath,
    ]);
    expect(command.slice(command.indexOf("-m"), command.indexOf("-m") + 2)).toEqual([
      "-m",
      "gpt-6.1-sol",
    ]);
    expect(overrides).toContain('model_reasoning_effort="ultra"');
    expect(overrides).toContain(
      'projects={"/home/me/.openmill/worktrees/app/login"={"trust_level"="trusted"}}',
    );
    expect(command.at(-1)).toMatch(/^\$openmill:autonomous-feature-pr \/jobs\/login\/login\.md\n/);
  });

  it("runs auto mode in a workspace profile that can write the worktree's git metadata", () => {
    expect(command).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(command).not.toContain("-s");
    expect(overrides).toEqual(
      expect.arrayContaining([
        'approvals_reviewer="auto_review"',
        'default_permissions="openmill"',
        'permissions.openmill.extends=":workspace"',
        'permissions.openmill.filesystem={"/home/me/app/.git"="write","/home/me/app/.git/worktrees/login"="write","/home/me/app/.git/hooks"="read"}',
        "permissions.openmill.network.enabled=true",
      ]),
    );
  });

  it("passes per-run hooks that call openmill hook", () => {
    expect(overrides).toContain(
      `hooks.Stop=[{"hooks"=[{"type"="command","command"="/usr/bin/node '/opt/open mill/openmill.mjs' hook Stop"}]}]`,
    );
    expect(
      overrides.filter((arg) => arg.startsWith("hooks.")).map((arg) => arg.split("=")[0]),
    ).toEqual([
      "hooks.SessionStart",
      "hooks.Stop",
      "hooks.UserPromptSubmit",
      "hooks.SessionEnd",
      "hooks.PreToolUse",
    ]);
    expect(overrides.find((arg) => arg.startsWith("hooks.PreToolUse"))).toContain(
      '"matcher"="Bash"',
    );
  });

  it("bypasses approvals and the sandbox in bypass mode and listens for permission requests", () => {
    const bypass = codexAgent.launch({ ...input, permissionMode: "bypass" }, "go").command;

    expect(bypass).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(configs(bypass).some((arg) => arg.startsWith("permissions."))).toBe(false);
    expect(configs(bypass).some((arg) => arg.startsWith("hooks.PermissionRequest="))).toBe(true);
  });
});

describe("codexAgent.resume", () => {
  it("resumes the session by id with the same flags", () => {
    const resumed = { ...input, sessionId: "01a1f1f7-271e-7ff2-884d-0522638c9b93" };
    const launch = codexAgent.launch(resumed, "go").command;
    const { command } = codexAgent.resume(resumed, "Push it.");

    expect(command.slice(0, 3)).toEqual(["codex", "resume", resumed.sessionId]);
    expect(command.slice(3, -1)).toEqual(launch.slice(1, -1));
    expect(command.at(-1)).toBe("Push it.");
    expect(codexAgent.resume(resumed).command.at(-1)).toBe('model_reasoning_effort="ultra"');
  });
});

describe("codexAgent.parseHook", () => {
  it("reads the session id from SessionStart", () => {
    expect(codexAgent.parseHook("SessionStart", hooks.SessionStart)).toEqual({
      type: "session_start",
      sessionId: "01a1f1f7-271e-7ff2-884d-0522638c9b93",
      transcriptPath: hooks.SessionStart.transcript_path,
    });
  });

  it("reads the last assistant message from Stop", () => {
    expect(codexAgent.parseHook("Stop", hooks.Stop)).toEqual({
      type: "stop",
      transcriptPath: hooks.Stop.transcript_path,
      stopHookActive: false,
      lastMessage: "Should sessions expire after 30 days or never?",
    });
  });

  it("reads the shell command so the gates can deny it", () => {
    const event = codexAgent.parseHook("PreToolUse", hooks.PreToolUse);

    expect(event).toEqual({
      type: "tool_use",
      transcriptPath: hooks.PreToolUse.transcript_path,
      command: "gh pr ready 12",
    });
    expect(
      codexAgent.parseHook("PreToolUse", { ...hooks.PreToolUse, tool_name: "apply_patch" }),
    ).toMatchObject({ command: undefined });
  });

  it("reports permission requests", () => {
    expect(codexAgent.parseHook("PermissionRequest", hooks.PermissionRequest)).toEqual({
      type: "permission_wait",
      transcriptPath: hooks.PermissionRequest.transcript_path,
      message: "write a file outside the workspace",
    });
  });
});

describe("codexAgent.denyToolUse", () => {
  it("returns the PreToolUse deny shape Codex reads", () => {
    expect(codexAgent.denyToolUse("held")).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "held",
      },
    });
  });
});

describe("codexAgent.lastMessage", () => {
  it("returns the last assistant message in the rollout", async () => {
    const path = fileURLToPath(new URL("codex-rollout.fixture.jsonl", import.meta.url));

    expect(await codexAgent.lastMessage(path)).toBe(
      "Should sessions expire after 30 days or never?",
    );
  });
});

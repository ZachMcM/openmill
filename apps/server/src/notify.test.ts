import { exec, execFile } from "node:child_process";
import { PassThrough } from "node:stream";
import { DEFAULT_CONFIG } from "@openmill/core";
import type { Job } from "@openmill/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNotifier, notificationPayload } from "./notify.ts";

vi.mock("node:child_process", () => ({
  exec: vi.fn<typeof exec>(),
  execFile: vi.fn<typeof execFile>(),
}));
vi.mock("./resume.ts", () => ({
  resumeCommand: (worktree: string, sessionId: string) => `cd ${worktree} && resume ${sessionId}`,
}));

const job = {
  id: "add-login",
  repoPath: "/src/app",
  worktreePath: "/wt/add-login",
  state: "needs_input",
  prUrl: null,
  sessionId: "abc",
} as Job;

const reason = `Should "sessions" expire? It's unclear.\nMore detail here.`;
const payload = notificationPayload("needs_input", job, reason);
const body = `Should "sessions" expire? It's unclear.\nopenmill show add-login`;
const platform = process.platform;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

function desktopCall(): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  const [command, args, options] = vi.mocked(execFile).mock.calls[0] as unknown as [
    string,
    string[],
    { env: NodeJS.ProcessEnv },
  ];

  return { command, args, env: options.env };
}

beforeEach(() => {
  vi.mocked(execFile).mockReset();
  vi.mocked(exec).mockReset();
});

afterEach(() => setPlatform(platform));

describe("notificationPayload", () => {
  it("names the job and how to resume it", () => {
    expect(payload).toEqual({
      event: "needs_input",
      job: "add-login",
      repo: "/src/app",
      state: "needs_input",
      reason,
      pr_url: null,
      resume: "cd /wt/add-login && resume abc",
    });
    expect(notificationPayload("failed", { ...job, sessionId: null }, null).resume).toBeNull();
  });
});

describe("desktop notifications", () => {
  it("passes the title and body to osascript as arguments", () => {
    setPlatform("darwin");
    createNotifier(() => {})(payload, DEFAULT_CONFIG);

    const { command, args } = desktopCall();

    expect(command).toBe("osascript");
    expect(args.slice(-2)).toEqual(["openmill: add-login needs_input", body]);
    expect(args.slice(0, -2).join(" ")).not.toContain("sessions");
  });

  it("passes the title and body to notify-send after --", () => {
    setPlatform("linux");
    createNotifier(() => {})(payload, DEFAULT_CONFIG);

    expect(desktopCall()).toMatchObject({
      command: "notify-send",
      args: ["--", "openmill: add-login needs_input", body],
    });
  });

  it("passes the title and body to PowerShell through the environment", () => {
    setPlatform("win32");
    createNotifier(() => {})(payload, DEFAULT_CONFIG);

    const { command, args, env } = desktopCall();

    expect(command).toBe("powershell");
    expect(args.join(" ")).not.toContain("sessions");
    expect(env).toMatchObject({
      OPENMILL_NOTIFY_TITLE: "openmill: add-login needs_input",
      OPENMILL_NOTIFY_BODY: body,
    });
  });

  it("logs a missing command once and stops trying", () => {
    setPlatform("linux");
    vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error) => void;

      callback(Object.assign(new Error("spawn notify-send ENOENT"), { code: "ENOENT" }));
    }) as unknown as typeof execFile);

    const log = vi.fn<(message: string) => void>();
    const notify = createNotifier(log);

    notify(payload, DEFAULT_CONFIG);
    notify(payload, DEFAULT_CONFIG);

    expect(execFile).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("notify_command", () => {
  it("writes the payload to stdin and skips the desktop when it is off", () => {
    const stdin = new PassThrough();
    let written = "";

    stdin.on("data", (chunk: Buffer) => (written += chunk.toString()));
    vi.mocked(exec).mockReturnValue({ stdin } as unknown as ReturnType<typeof exec>);

    createNotifier(() => {})(payload, {
      ...DEFAULT_CONFIG,
      notify_desktop: false,
      notify_command: "cat > /dev/null",
    });

    expect(execFile).not.toHaveBeenCalled();
    expect(vi.mocked(exec).mock.calls[0]?.[0]).toBe("cat > /dev/null");
    expect(JSON.parse(written)).toEqual(payload);
  });
});

import { exec, execFile } from "node:child_process";
import type { Config, NotificationEvent } from "@openmill/core";
import type { Job } from "@openmill/db";

export interface NotificationPayload {
  event: NotificationEvent;
  job: string;
  repo: string;
  state: string;
  reason: string | null;
  pr_url: string | null;
  open: string;
}

export type Notify = (payload: NotificationPayload, config: Config) => void;

const COMMAND_TIMEOUT_MS = 10_000;
const BODY_LIMIT = 200;

const EVENT_LABELS: Record<NotificationEvent, string> = {
  needs_input: "needs input",
  needs_permission: "waiting for permission",
  failed: "failed",
  ready_for_review: "ready for review",
  followup_ready: "follow-up ready to push",
  followups_exhausted: "follow-ups exhausted",
  session_closed: "session closed",
};

export function notificationPayload(
  event: NotificationEvent,
  job: Job,
  reason: string | null,
): NotificationPayload {
  return {
    event,
    job: job.id,
    repo: job.repoPath,
    state: job.state,
    reason,
    pr_url: job.prUrl,
    open: `openmill open ${job.id}`,
  };
}

export function createNotifier(log: (message: string) => void): Notify {
  let desktopMissing = false;

  function desktop(payload: NotificationPayload): void {
    const title = `openmill: ${payload.job} ${EVENT_LABELS[payload.event]}`;
    const hint = `Run ${payload.open}.`;
    const limit = BODY_LIMIT - hint.length - 1;
    const reason = payload.reason?.replace(/\s+/g, " ").trim() ?? "";
    const clipped = reason.length > limit ? `${reason.slice(0, limit - 1).trimEnd()}…` : reason;
    const body = clipped ? `${clipped} ${hint}` : hint;
    const { command, args } = desktopCommand(title, body);

    execFile(command, args, (error) => {
      if (!error) {
        return;
      }

      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        desktopMissing = true;
        log(`desktop notifications are off until the server restarts: ${command} was not found`);
      } else {
        log(`desktop notification for ${payload.job} failed: ${error.message}`);
      }
    });
  }

  function runCommand(command: string, payload: NotificationPayload): void {
    const child = exec(command, { timeout: COMMAND_TIMEOUT_MS }, (error) => {
      if (error) {
        const why = error.killed ? `timed out after ${COMMAND_TIMEOUT_MS / 1000}s` : error.message;

        log(`notify_command for ${payload.job} failed: ${why}`);
      }
    });

    // A command that exits without reading stdin makes the write fail with EPIPE.
    child.stdin?.on("error", () => {});
    child.stdin?.end(JSON.stringify(payload));
  }

  return (payload, config) => {
    if (config.notify_desktop && !desktopMissing) {
      desktop(payload);
    }

    if (config.notify_command) {
      runCommand(config.notify_command, payload);
    }
  };
}

function desktopCommand(title: string, body: string): { command: string; args: string[] } {
  if (process.platform === "darwin") {
    return {
      command: "osascript",
      args: [
        "-e",
        "on run argv",
        "-e",
        "display notification (item 2 of argv) with title (item 1 of argv)",
        "-e",
        "end run",
        title,
        body,
      ],
    };
  }

  return { command: "notify-send", args: ["--", title, body] };
}

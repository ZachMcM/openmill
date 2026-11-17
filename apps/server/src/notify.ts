import { exec, execFile } from "node:child_process";
import type { Config, NotificationEvent } from "@openmill/core";
import type { Job } from "@openmill/db";
import { resumeCommand } from "./resume.ts";

export interface NotificationPayload {
  event: NotificationEvent;
  job: string;
  repo: string;
  state: string;
  reason: string | null;
  pr_url: string | null;
  resume: string | null;
}

export type Notify = (payload: NotificationPayload, config: Config) => void;

const COMMAND_TIMEOUT_MS = 10_000;

// Toasts only show for a registered AppUserModelID, so borrow the one Windows PowerShell ships with.
const WINDOWS_TOAST_SCRIPT = [
  "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
  "$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
  "$text = $template.GetElementsByTagName('text')",
  "$text.Item(0).AppendChild($template.CreateTextNode($env:OPENMILL_NOTIFY_TITLE)) | Out-Null",
  "$text.Item(1).AppendChild($template.CreateTextNode($env:OPENMILL_NOTIFY_BODY)) | Out-Null",
  "$toast = [Windows.UI.Notifications.ToastNotification]::new($template)",
  "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($toast)",
].join("; ");

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
    resume: job.sessionId ? resumeCommand(job.worktreePath, job.sessionId) : null,
  };
}

export function createNotifier(log: (message: string) => void): Notify {
  let desktopMissing = false;

  function desktop(payload: NotificationPayload): void {
    const title = `openmill: ${payload.job} ${payload.event}`;
    const firstLine = payload.reason?.split(/\r?\n/, 1)[0]?.trim();
    const show = `openmill show ${payload.job}`;
    const body = firstLine ? `${firstLine}\n${show}` : show;
    const { command, args, env } = desktopCommand(title, body);

    execFile(command, args, { env: { ...process.env, ...env } }, (error) => {
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

function desktopCommand(
  title: string,
  body: string,
): { command: string; args: string[]; env?: Record<string, string> } {
  switch (process.platform) {
    case "darwin":
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
    case "win32":
      return {
        command: "powershell",
        args: ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_TOAST_SCRIPT],
        env: { OPENMILL_NOTIFY_TITLE: title, OPENMILL_NOTIFY_BODY: body },
      };
    default:
      return { command: "notify-send", args: ["--", title, body] };
  }
}

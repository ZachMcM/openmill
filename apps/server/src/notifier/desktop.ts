import { execFile } from "node:child_process";
import { EVENT_LABELS, type Notifier } from "./types.ts";

const BODY_LIMIT = 200;

export function createDesktop(): Notifier {
  let missing = false;

  return {
    send(payload) {
      if (missing) {
        return Promise.resolve();
      }

      const title = `openmill: ${payload.job} ${EVENT_LABELS[payload.event]}`;
      const hint = `Run ${payload.open}.`;
      const limit = BODY_LIMIT - hint.length - 1;
      const reason = payload.reason?.replace(/\s+/g, " ").trim() ?? "";
      const clipped = reason.length > limit ? `${reason.slice(0, limit - 1).trimEnd()}…` : reason;
      const body = clipped ? `${clipped} ${hint}` : hint;
      const { command, args } = desktopCommand(title, body);

      return new Promise((resolve, reject) => {
        execFile(command, args, (error) => {
          if (!error) {
            resolve();
          } else if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            missing = true;
            reject(
              new Error(
                `${command} was not found, so desktop notifications are off until the server restarts`,
              ),
            );
          } else {
            reject(error);
          }
        });
      });
    },
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

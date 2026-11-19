import type { Config, NotificationEvent } from "@openmill/core";
import type { Job } from "@openmill/db";
import { createCommand } from "./command.ts";
import { createDesktop } from "./desktop.ts";
import * as discord from "./discord.ts";
import * as slack from "./slack.ts";
import type { NotificationPayload, Notifier, NotifierEntry, NotifierType } from "./types.ts";
import { postWebhook } from "./webhook.ts";

export type Notify = (
  payload: NotificationPayload,
  config: Config,
  entries: NotifierEntry[],
) => void;

export const CONNECTORS = { discord, slack } satisfies Record<NotifierType, unknown>;

export function isWebhookUrl(type: NotifierType, url: string): boolean {
  return CONNECTORS[type].isWebhookUrl(url);
}

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

export function sendTest(entry: NotifierEntry): Promise<void> {
  return postWebhook(entry.url, CONNECTORS[entry.type].formatTest());
}

function webhook(entry: NotifierEntry): Notifier {
  return {
    send: async (payload) => postWebhook(entry.url, CONNECTORS[entry.type].format(payload)),
  };
}

export function createNotify(log: (message: string) => void): Notify {
  const desktop = createDesktop();

  return (payload, config, entries) => {
    const active: Array<[string, Notifier]> = [];

    if (config.notify_desktop) {
      active.push(["desktop", desktop]);
    }

    if (config.notify_command) {
      active.push(["notify_command", createCommand(config.notify_command)]);
    }

    for (const entry of entries) {
      active.push([entry.name, webhook(entry)]);
    }

    for (const [name, notifier] of active) {
      notifier
        .send(payload)
        .catch((error: unknown) =>
          log(
            `notification to ${name} failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    }
  };
}

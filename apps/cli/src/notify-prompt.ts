import * as p from "@clack/prompts";
import {
  NOTIFIER_LABELS,
  NOTIFIER_NAME,
  NOTIFIER_NAME_HINT,
  NOTIFIER_TYPES,
  isWebhookUrl,
  type NotifierType,
} from "@openmill/server";
import type { Client } from "@openmill/server/client";
import { unwrap } from "./output.ts";
import { answer } from "./ui.ts";

const STEPS: Record<NotifierType, string> = {
  discord:
    "In Discord, open Server Settings → Integrations → Webhooks, click New Webhook, pick a channel, and click Copy Webhook URL. Use a private server or channel if the messages are just for you.",
  slack:
    "Go to api.slack.com/apps and create an app from scratch in your workspace. Open Incoming Webhooks, turn them on, click Add New Webhook, pick a channel or your own DM, and copy the URL.",
};

function freeName(type: NotifierType, taken: Set<string>): string {
  let name: string = type;

  for (let n = 2; taken.has(name); n += 1) {
    name = `${type}-${n}`;
  }

  return name;
}

export async function promptNotifiers(client: Client): Promise<void> {
  const chosen = answer(
    await p.multiselect({
      message: "Where should openmill send notifications?",
      options: NOTIFIER_TYPES.map((type) => ({ value: type, label: NOTIFIER_LABELS[type] })),
      required: false,
    }),
  );
  const { notifiers } = await unwrap(client.notifiers.$get());
  const taken = new Set(notifiers.map((entry) => entry.name));

  for (const type of chosen) {
    const label = NOTIFIER_LABELS[type];

    p.note(STEPS[type], label);

    const url = answer(
      await p.text({
        message: `${label} webhook URL`,
        validate: (input = "") =>
          isWebhookUrl(type, input.trim())
            ? undefined
            : `That doesn't look like a ${label} webhook URL.`,
      }),
    ).trim();
    const name = answer(
      await p.text({
        message: "Name",
        initialValue: freeName(type, taken),
        validate: (input = "") => {
          const name = input.trim();

          if (!NOTIFIER_NAME.test(name)) {
            return `Names must ${NOTIFIER_NAME_HINT}.`;
          }

          return taken.has(name) ? `${name} is already taken.` : undefined;
        },
      }),
    ).trim();

    await unwrap(client.notifiers.$post({ json: { name, type, url } }));
    taken.add(name);

    const { results } = await unwrap(client.notifiers.test.$post({ json: { name } }));
    const result = results[0];

    if (result?.ok) {
      p.log.success(`Sent a test message to ${name}.`);
    } else {
      p.log.error(
        `The test message to ${name} failed: ${result?.error}. Check the URL, then run openmill notify test ${name}, or openmill notify rm ${name} to remove it.`,
      );
    }
  }
}

import { chmod, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { CONNECTORS, isWebhookUrl } from "./notifier/index.ts";
import { matchedPrefix } from "./notifier/message.ts";
import {
  NOTIFIER_LABELS,
  NOTIFIER_NAME,
  NOTIFIER_NAME_HINT,
  NOTIFIER_TYPES,
  type NotifierEntry,
} from "./notifier/types.ts";

export const notifierEntrySchema = z.object({
  name: z.string().regex(NOTIFIER_NAME, NOTIFIER_NAME_HINT),
  type: z.enum(NOTIFIER_TYPES),
  url: z.string().min(1),
});

export async function readNotifiers(
  path: string,
  log: (message: string) => void,
): Promise<NotifierEntry[]> {
  let stored: unknown;

  try {
    stored = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  if (!Array.isArray(stored)) {
    throw new Error(`${path} must hold a JSON array`);
  }

  const entries: NotifierEntry[] = [];

  for (const [index, value] of stored.entries()) {
    const parsed = notifierEntrySchema.safeParse(value);

    if (!parsed.success) {
      log(`skipped notifier #${index + 1} in ${path}: it isn't a valid notifier`);
      continue;
    }

    const entry = parsed.data;

    if (!isWebhookUrl(entry.type, entry.url)) {
      log(
        `skipped notifier ${entry.name} in ${path}: its URL isn't a ${NOTIFIER_LABELS[entry.type]} webhook URL`,
      );
      continue;
    }

    if (entries.some((other) => other.name === entry.name)) {
      log(`skipped notifier ${entry.name} in ${path}: another notifier has the same name`);
      continue;
    }

    entries.push(entry);
  }

  return entries;
}

export async function writeNotifiers(path: string, entries: NotifierEntry[]): Promise<void> {
  await writeFile(path, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export function maskUrl(url: string): string {
  const prefixes = Object.values(CONNECTORS).flatMap((connector) => connector.WEBHOOK_PREFIXES);

  return `${matchedPrefix(url, prefixes) ?? ""}…${url.slice(-4)}`;
}

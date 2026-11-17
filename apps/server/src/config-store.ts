import { readFile, writeFile } from "node:fs/promises";
import { resolveConfig, type Config, type ConfigKey } from "@openmill/core";

export async function readConfig(path: string): Promise<Config> {
  return resolveConfig(await readStored(path));
}

export async function writeConfigValue(
  path: string,
  key: ConfigKey,
  value: Config[ConfigKey],
): Promise<Config> {
  const stored = await readStored(path);

  stored[key] = value;

  await writeFile(path, `${JSON.stringify(stored, null, 2)}\n`);

  return resolveConfig(stored);
}

async function readStored(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

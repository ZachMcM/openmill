export const HARNESSES = ["claude"] as const;
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export type HarnessName = (typeof HARNESSES)[number];
export type Effort = (typeof EFFORTS)[number];

export interface Config {
  concurrency: number;
  harness: HarnessName;
  model?: string;
  effort: Effort;
}

export const CONFIG_KEYS = ["concurrency", "harness", "model", "effort"] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];

export const DEFAULT_CONFIG: Config = { concurrency: 2, harness: "claude", effort: "medium" };

export type ParsedValue<T> = { ok: true; value: T } | { ok: false; error: string };

export function isConfigKey(key: string): key is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(key);
}

function parseOneOf<T extends string>(name: string, values: readonly T[]) {
  return (value: string): ParsedValue<T> =>
    (values as readonly string[]).includes(value)
      ? { ok: true, value: value as T }
      : { ok: false, error: `${name} must be one of ${values.join(", ")}` };
}

export const parseHarness = parseOneOf("harness", HARNESSES);
export const parseEffort = parseOneOf("effort", EFFORTS);

export function parseModel(value: string): ParsedValue<string> {
  return value.trim() === ""
    ? { ok: false, error: "model must not be empty" }
    : { ok: true, value: value.trim() };
}

export function parseConfigValue(key: ConfigKey, value: string): ParsedValue<Config[ConfigKey]> {
  switch (key) {
    case "concurrency": {
      const number = Number(value);

      return Number.isInteger(number) && number > 0
        ? { ok: true, value: number }
        : { ok: false, error: "concurrency must be a positive integer" };
    }
    case "harness":
      return parseHarness(value);
    case "model":
      return parseModel(value);
    case "effort":
      return parseEffort(value);
  }
}

export function resolveConfig(stored: unknown): Config {
  const config: Config = { ...DEFAULT_CONFIG };

  if (typeof stored !== "object" || stored === null) {
    return config;
  }

  for (const [key, raw] of Object.entries(stored)) {
    if (!isConfigKey(key) || raw === undefined || raw === null) {
      continue;
    }

    const parsed = parseConfigValue(key, String(raw));

    if (parsed.ok) {
      Object.assign(config, { [key]: parsed.value });
    }
  }

  return config;
}

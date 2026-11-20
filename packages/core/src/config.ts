export const AGENTS = ["claude", "codex"] as const;
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const PUSH_MODES = ["wait", "auto"] as const;
export const PERMISSION_MODES = ["auto", "bypass"] as const;
export const TERMINALS = ["rex", "herdr", "tmux"] as const;

export type AgentName = (typeof AGENTS)[number];
export type PushMode = (typeof PUSH_MODES)[number];
export type PermissionMode = (typeof PERMISSION_MODES)[number];
export type TerminalName = (typeof TERMINALS)[number];

export interface Config {
  concurrency: number;
  agent: AgentName;
  permission_mode: PermissionMode;
  terminal: TerminalName;
  model?: string;
  effort: string;
  notify_desktop: boolean;
  notify_command?: string;
  trusted_bots: string[];
  review_push: PushMode;
  ci_push: PushMode;
  followup_attempts: number;
}

export const CONFIG_KEYS = [
  "concurrency",
  "agent",
  "permission_mode",
  "terminal",
  "model",
  "effort",
  "notify_desktop",
  "notify_command",
  "trusted_bots",
  "review_push",
  "ci_push",
  "followup_attempts",
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];

export const DEFAULT_CONFIG: Config = {
  concurrency: 2,
  agent: "claude",
  permission_mode: "auto",
  terminal: "rex",
  effort: "medium",
  notify_desktop: true,
  trusted_bots: [],
  review_push: "wait",
  ci_push: "auto",
  followup_attempts: 3,
};

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

export const parseAgent = parseOneOf("agent", AGENTS);
export const parsePermissionMode = parseOneOf("permission_mode", PERMISSION_MODES);
export const parseTerminal = parseOneOf("terminal", TERMINALS);

function parsePositiveInteger(name: string, value: string): ParsedValue<number> {
  const number = Number(value);

  return Number.isInteger(number) && number > 0
    ? { ok: true, value: number }
    : { ok: false, error: `${name} must be a positive integer` };
}

function parseNonEmpty(name: string) {
  return (value: string): ParsedValue<string> =>
    value.trim() === ""
      ? { ok: false, error: `${name} must not be empty` }
      : { ok: true, value: value.trim() };
}

export const parseModel = parseNonEmpty("model");
export const parseEffort = parseNonEmpty("effort");

export function parseConfigValue(key: ConfigKey, value: string): ParsedValue<Config[ConfigKey]> {
  switch (key) {
    case "concurrency":
      return parsePositiveInteger(key, value);
    case "agent":
      return parseAgent(value);
    case "permission_mode":
      return parsePermissionMode(value);
    case "terminal":
      return parseTerminal(value);
    case "model":
      return parseModel(value);
    case "effort":
      return parseEffort(value);
    case "notify_desktop":
      return value === "true" || value === "false"
        ? { ok: true, value: value === "true" }
        : { ok: false, error: "notify_desktop must be true or false" };
    case "notify_command":
      return { ok: true, value: value.trim() === "" ? undefined : value };
    case "trusted_bots":
      return {
        ok: true,
        value: value
          .split(",")
          .map((login) => login.trim())
          .filter((login) => login !== ""),
      };
    case "review_push":
    case "ci_push":
      return parseOneOf(key, PUSH_MODES)(value);
    case "followup_attempts":
      return parsePositiveInteger(key, value);
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

  if (config.agent === "claude" && !(CLAUDE_EFFORTS as readonly string[]).includes(config.effort)) {
    config.effort = DEFAULT_CONFIG.effort;
  }

  return config;
}

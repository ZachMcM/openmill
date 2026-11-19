import { CLAUDE_EFFORTS, DEFAULT_CONFIG, type AgentName } from "./config.ts";

export const READY_CHECKS: Record<AgentName, Array<[string, ...string[]]>> = {
  claude: [
    ["claude", "--version"],
    ["claude", "auth", "status"],
  ],
  codex: [
    ["codex", "--version"],
    ["codex", "login", "status"],
  ],
};

export const CODEX_MODELS_COMMAND: [string, ...string[]] = ["codex", "debug", "models"];

export interface ModelEfforts {
  model: string;
  visible: boolean;
  efforts: readonly string[];
  defaultEffort: string;
}

export interface ModelCatalog {
  defaultModel?: string;
  models: ModelEfforts[];
}

export type EffortCheck =
  | { ok: true }
  | { ok: false; error: string; model: string; fallback: string };

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function parseCodexModels(json: unknown): ModelEfforts[] {
  const models = record(json).models;

  if (!Array.isArray(models)) {
    throw new Error("codex debug models returned no models list");
  }

  return models
    .map(record)
    .filter((entry) => typeof entry.slug === "string")
    .toSorted((a, b) => Number(a.priority ?? 0) - Number(b.priority ?? 0))
    .map((entry) => ({
      model: entry.slug as string,
      visible: entry.visibility === "list",
      efforts: (Array.isArray(entry.supported_reasoning_levels)
        ? entry.supported_reasoning_levels
        : []
      ).flatMap((level) => {
        const effort = record(level).effort;

        return typeof effort === "string" ? [effort] : [];
      }),
      defaultEffort: String(entry.default_reasoning_level ?? ""),
    }));
}

function catalogModel(catalog: ModelCatalog, model: string | undefined): ModelEfforts | undefined {
  const named = (name: string | undefined) => catalog.models.find((entry) => entry.model === name);

  return model
    ? named(model)
    : (named(catalog.defaultModel) ?? catalog.models.find((entry) => entry.visible));
}

export function resolveEffort(
  agent: AgentName,
  model: string | undefined,
  effort: string,
  catalog: ModelCatalog | undefined,
): EffortCheck {
  const target: Omit<ModelEfforts, "visible"> | undefined =
    agent === "claude"
      ? {
          model: model ?? "claude",
          efforts: CLAUDE_EFFORTS,
          defaultEffort: DEFAULT_CONFIG.effort,
        }
      : catalog && catalogModel(catalog, model);

  if (!target || target.efforts.includes(effort)) {
    return { ok: true };
  }

  return {
    ok: false,
    error: `${target.model} supports ${target.efforts.join(", ")}`,
    model: target.model,
    fallback: target.defaultEffort,
  };
}

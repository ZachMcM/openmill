import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { PLUGIN_NAME, REVIEW_AGENTS, codexAgentsDir, pluginDir } from "@openmill/assets";
import { run, runOrThrow } from "./system.ts";

export const PLUGIN_ID = `${PLUGIN_NAME}@${PLUGIN_NAME}`;

const PLUGIN_ENTRIES = [".claude-plugin", "skills", "agents"];

export function marketplaceManifest(version: string, description: string) {
  return {
    name: PLUGIN_NAME,
    owner: { name: PLUGIN_NAME },
    plugins: [{ name: PLUGIN_NAME, source: `./${PLUGIN_NAME}`, version, description }],
  };
}

export async function writeMarketplace(dir: string, version: string): Promise<void> {
  const target = join(dir, PLUGIN_NAME);

  await rm(target, { recursive: true, force: true });

  for (const entry of PLUGIN_ENTRIES) {
    await cp(join(pluginDir, entry), join(target, entry), { recursive: true });
  }

  const manifestPath = join(target, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { description: string };

  await writeFile(manifestPath, json({ ...manifest, version }));
  await mkdir(join(dir, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(dir, ".claude-plugin", "marketplace.json"),
    json(marketplaceManifest(version, manifest.description)),
  );
}

async function listNames(args: string[], key: "name" | "id"): Promise<string[]> {
  const parsed = JSON.parse(await runOrThrow("claude", args)) as Array<Record<string, unknown>>;

  return parsed.map((entry) => String(entry[key]));
}

export async function installPlugin(dir: string): Promise<void> {
  const marketplaces = await listNames(["plugin", "marketplace", "list", "--json"], "name");

  if (marketplaces.includes(PLUGIN_NAME)) {
    await runOrThrow("claude", ["plugin", "marketplace", "update", PLUGIN_NAME]);
  } else {
    await runOrThrow("claude", ["plugin", "marketplace", "add", dir]);
  }

  const plugins = await listNames(["plugin", "list", "--json"], "id");
  const action = plugins.includes(PLUGIN_ID) ? "update" : "install";

  await runOrThrow("claude", ["plugin", action, PLUGIN_ID]);
}

export async function uninstallPlugin(): Promise<void> {
  await run("claude", ["plugin", "uninstall", PLUGIN_ID]);
  await run("claude", ["plugin", "marketplace", "remove", PLUGIN_NAME]);
}

function codexAgentsHome(): string {
  return join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "agents");
}

export async function installCodexPlugin(dir: string): Promise<void> {
  await runOrThrow("codex", ["plugin", "marketplace", "add", dir]);
  await runOrThrow("codex", ["plugin", "add", PLUGIN_ID]);
  await mkdir(codexAgentsHome(), { recursive: true });

  for (const name of REVIEW_AGENTS) {
    await cp(join(codexAgentsDir, `${name}.toml`), join(codexAgentsHome(), `${name}.toml`));
  }
}

export async function uninstallCodexPlugin(): Promise<void> {
  await run("codex", ["plugin", "remove", PLUGIN_ID]);
  await run("codex", ["plugin", "marketplace", "remove", PLUGIN_NAME]);

  for (const name of REVIEW_AGENTS) {
    await rm(join(codexAgentsHome(), `${name}.toml`), { force: true });
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

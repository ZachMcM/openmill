import { realpathSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import {
  AGENTS,
  CLAUDE_EFFORTS,
  CODEX_MODELS_COMMAND,
  DEFAULT_CONFIG,
  READY_CHECKS,
  parseCodexModels,
  parseConfigValue,
  type AgentName,
  type ModelEfforts,
} from "@openmill/core";
import { readConfig, resolvePaths, writeConfigValue } from "@openmill/server";
import pc from "picocolors";
import pkg from "../package.json" with { type: "json" };
import { localClient, serverStatus, stopServer } from "./connect.ts";
import {
  installCodexPlugin,
  installPlugin,
  uninstallCodexPlugin,
  uninstallPlugin,
  writeMarketplace,
} from "./plugin.ts";
import { hasCommand, run, runInherited, runOrThrow } from "./system.ts";
import {
  installedGlobalVersion,
  isInside,
  isNewerVersion,
  meetsNodeVersion,
  MIN_NODE_MAJOR,
} from "./versions.ts";

export interface InstallOptions {
  yes: boolean;
}

export interface UninstallOptions extends InstallOptions {
  purge: boolean;
}

class Cancelled extends Error {}

function interactive(options: InstallOptions): boolean {
  return !options.yes && Boolean(process.stdin.isTTY);
}

function answer<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    throw new Cancelled();
  }

  return value as Exclude<T, symbol>;
}

async function step(title: string, task: () => Promise<string | undefined>): Promise<void> {
  const spinner = p.spinner();

  spinner.start(title);

  try {
    spinner.stop(`${title}${await task().then((note) => (note ? pc.dim(` (${note})`) : ""))}`);
  } catch (error) {
    spinner.error(title);
    throw error;
  }
}

async function checkPrerequisites(): Promise<AgentName[]> {
  if (!meetsNodeVersion(process.versions.node)) {
    throw new Error(
      `openmill needs Node ${MIN_NODE_MAJOR} or later, found ${process.versions.node}`,
    );
  }

  for (const tool of ["git", "gh"]) {
    if (!(await hasCommand(tool))) {
      throw new Error(`${tool} isn't installed or isn't on PATH`);
    }
  }

  if (!(await hasCommand("rex", ["version"]))) {
    throw new Error(
      "rex isn't installed or isn't on PATH. openmill runs every agent in a Rex window.",
    );
  }

  if (!(await run("gh", ["auth", "status"])).ok) {
    p.log.warn(`gh isn't signed in. Run ${pc.bold("gh auth login")} before queuing jobs.`);
  }

  return readyAgents();
}

async function passes(checks: Array<[string, ...string[]]>): Promise<boolean> {
  for (const [command, ...args] of checks) {
    if (!(await run(command, args)).ok) {
      return false;
    }
  }

  return true;
}

async function readyAgents(): Promise<AgentName[]> {
  const ready: AgentName[] = [];

  for (const agent of AGENTS) {
    if (await passes(READY_CHECKS[agent])) {
      ready.push(agent);
    }
  }

  if (ready.length === 0) {
    p.log.warn(
      "No agent CLI is ready. Install and sign in to claude or codex before queuing jobs.",
    );
  }

  return ready;
}

function runningBin(): string {
  return realpathSync(process.argv[1] as string);
}

async function globalRoot(): Promise<string> {
  return realpathSync((await runOrThrow("npm", ["root", "-g"])).trim());
}

async function installGlobal(): Promise<string | undefined> {
  const bin = runningBin();

  if (!bin.split(/[\\/]/).includes("node_modules")) {
    return "running from source, skipped";
  }

  if (isInside(bin, await globalRoot())) {
    return "already global";
  }

  const listed = await run("npm", ["ls", "-g", pkg.name, "--json", "--depth=0"]);

  if (installedGlobalVersion(listed.stdout, pkg.name) === pkg.version) {
    return `${pkg.version} already installed`;
  }

  await runOrThrow("npm", ["install", "-g", `${pkg.name}@${pkg.version}`]);

  return pkg.version;
}

const AGENT_LABELS: Record<AgentName, string> = { claude: "Claude", codex: "Codex" };

async function setUpPlugins(agents: AgentName[], home: string): Promise<void> {
  const dir = join(home, "plugin");

  if (agents.length > 0) {
    await writeMarketplace(dir, pkg.version);
  }

  for (const agent of agents) {
    await step(`Installing the ${AGENT_LABELS[agent]} plugin`, async () => {
      await (agent === "claude" ? installPlugin(dir) : installCodexPlugin(dir));

      return undefined;
    });
  }
}

async function stopRunningServer(): Promise<void> {
  await step("Stopping the old server", async () => {
    const client = localClient();

    if (!(await serverStatus(client))) {
      return "not running";
    }

    await stopServer(client);

    return "stopped";
  });
}

const CLAUDE_MODELS = [
  { value: "claude-opus-5-5", label: "Opus 5.5" },
  { value: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { value: "claude-haiku-5-5", label: "Haiku 5.5" },
  { value: "claude-fable-5-2", label: "Fable 5.2" },
];

const DEFAULT_MODEL = "";
const OTHER_MODEL = "other";

async function codexModels(): Promise<ModelEfforts[]> {
  const [command, ...args] = CODEX_MODELS_COMMAND;

  return parseCodexModels(JSON.parse(await runOrThrow(command, args)));
}

async function promptConfig(path: string, agents: AgentName[]): Promise<void> {
  if (agents.length > 1) {
    const current = await readConfig(path);
    const agent = answer(
      await p.select({
        message: "Which agent should run jobs by default?",
        options: agents.map((value) => ({ value, label: AGENT_LABELS[value] })),
        initialValue: agents.includes(current.agent) ? current.agent : agents[0],
      }),
    );

    await writeConfigValue(path, "agent", agent);
  }

  const current = await readConfig(path);

  const concurrency = parseConfigValue(
    "concurrency",
    answer(
      await p.text({
        message: "How many jobs can run at once?",
        initialValue: String(current.concurrency),
        validate: (input = "") => {
          const parsed = parseConfigValue("concurrency", input);

          return parsed.ok ? undefined : parsed.error;
        },
      }),
    ),
  );

  if (concurrency.ok) {
    await writeConfigValue(path, "concurrency", concurrency.value);
  }

  const codex = current.agent === "codex" ? await codexModels().catch(() => []) : [];
  const models =
    current.agent === "codex"
      ? codex
          .filter((entry) => entry.visible)
          .map((entry) => ({ value: entry.model, label: entry.model }))
      : [{ value: DEFAULT_MODEL, label: "Agent default" }, ...CLAUDE_MODELS];
  const custom =
    current.model && !models.some((model) => model.value === current.model)
      ? [{ value: current.model, label: current.model }]
      : [];
  let model = answer(
    await p.select({
      message: "Which model should agents use?",
      options: [
        ...models,
        ...custom,
        { value: OTHER_MODEL, label: "Other", hint: "type a model id" },
      ],
      initialValue: current.model ?? models[0]?.value,
    }),
  );

  if (model === OTHER_MODEL) {
    model = answer(
      await p.text({
        message: "Model id",
        validate: (input = "") => {
          const parsed = parseConfigValue("model", input);

          return parsed.ok ? undefined : parsed.error;
        },
      }),
    ).trim();
  }

  await writeConfigValue(path, "model", model === DEFAULT_MODEL ? undefined : model);

  const levels: Omit<ModelEfforts, "model" | "visible"> | undefined =
    current.agent === "codex"
      ? codex.find((entry) => entry.model === model)
      : { efforts: CLAUDE_EFFORTS, defaultEffort: DEFAULT_CONFIG.effort };
  let effort: string;

  if (levels) {
    effort = answer(
      await p.select({
        message: "How much effort should agents spend?",
        options: levels.efforts.map((value) => ({ value })),
        initialValue: levels.efforts.includes(current.effort)
          ? current.effort
          : levels.defaultEffort,
      }),
    );
  } else {
    effort = answer(
      await p.text({
        message: "Effort level",
        initialValue: current.effort,
        validate: (input = "") => {
          const parsed = parseConfigValue("effort", input);

          return parsed.ok ? undefined : parsed.error;
        },
      }),
    ).trim();
  }

  await writeConfigValue(path, "effort", effort);
}

export async function install(options: InstallOptions): Promise<void> {
  const paths = resolvePaths();

  p.intro(pc.inverse(` openmill ${pkg.version} `));

  try {
    const agents = await checkPrerequisites();

    await step("Installing openmill globally", installGlobal);
    await step("Creating the openmill home", async () => {
      await mkdir(paths.home, { recursive: true, mode: 0o700 });

      return paths.home;
    });

    await setUpPlugins(agents, paths.home);
    await stopRunningServer();

    if (agents.length === 1) {
      await writeConfigValue(paths.config, "agent", agents[0]);
    }

    if (interactive(options)) {
      await promptConfig(paths.config, agents);
    }

    p.note(
      `openmill add docs/feature.md\nopenmill ls${
        agents.includes("claude")
          ? "\n\nThe first Claude job's window shows Claude Code's Bypass Permissions warning.\nRun openmill open <id> and accept it once."
          : ""
      }`,
      "Next steps",
    );
    p.outro("openmill is installed");
  } catch (error) {
    if (error instanceof Cancelled) {
      p.cancel("Install cancelled");
      process.exitCode = 1;

      return;
    }

    throw error;
  }
}

export async function update(): Promise<void> {
  p.intro(pc.inverse(" openmill update "));

  const root = await globalRoot();

  if (!isInside(runningBin(), root)) {
    throw new Error("openmill isn't installed globally. Run npx openmill install first.");
  }

  try {
    const latest = (await runOrThrow("npm", ["view", pkg.name, "version"])).trim();

    if (isNewerVersion(latest, pkg.version)) {
      await step(`Installing openmill ${latest}`, async () => {
        await runOrThrow("npm", ["install", "-g", `${pkg.name}@${latest}`]);

        return undefined;
      });

      const dir = join(root, pkg.name);
      const installed = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
        bin: Record<string, string>;
      };

      process.exitCode = await runInherited(process.execPath, [
        join(dir, installed.bin[pkg.name] as string),
        "update",
      ]);

      return;
    }

    p.log.info(`Already on ${pkg.version}`);

    await setUpPlugins(await readyAgents(), resolvePaths().home);

    const status = await serverStatus(localClient());

    if (status && status.version !== pkg.version) {
      await stopRunningServer();
    }

    p.outro("openmill is up to date");
  } catch (error) {
    throw new Error(`${(error as Error).message}\nRun openmill update again to finish.`, {
      cause: error,
    });
  }
}

export async function uninstall(options: UninstallOptions): Promise<void> {
  const paths = resolvePaths();

  p.intro(pc.inverse(" openmill uninstall "));

  try {
    const client = localClient();

    await step("Stopping the server", async () => {
      if (!(await serverStatus(client))) {
        return "not running";
      }

      await stopServer(client);

      return undefined;
    });

    if (await hasCommand("claude")) {
      await step("Removing the Claude plugin", async () => {
        await uninstallPlugin();

        return undefined;
      });
    }

    if (await hasCommand("codex")) {
      await step("Removing the Codex plugin", async () => {
        await uninstallCodexPlugin();

        return undefined;
      });
    }

    await rm(join(paths.home, "plugin"), { recursive: true, force: true });

    await step("Removing the global package", async () => {
      await run("npm", ["uninstall", "-g", pkg.name]);

      return undefined;
    });

    if (options.purge) {
      const purge =
        options.yes ||
        (interactive(options) &&
          answer(
            await p.confirm({
              message: `Delete ${paths.home}? This removes every job, worktree, log, and config value.`,
              initialValue: false,
            }),
          ));

      if (!purge) {
        p.log.warn(`Kept ${paths.home}. Pass --yes with --purge to delete it without a prompt.`);
      } else {
        await step(`Deleting ${paths.home}`, async () => {
          await rm(paths.home, { recursive: true, force: true });

          return undefined;
        });
      }
    }

    p.outro("openmill is uninstalled");
  } catch (error) {
    if (error instanceof Cancelled) {
      p.cancel("Uninstall cancelled");
      process.exitCode = 1;

      return;
    }

    throw error;
  }
}

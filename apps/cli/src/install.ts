import { realpathSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import { EFFORTS, parseConfigValue } from "@openmill/core";
import { readConfig, resolvePaths, writeConfigValue } from "@openmill/server";
import type { Client } from "@openmill/server/client";
import pc from "picocolors";
import pkg from "../package.json" with { type: "json" };
import { connect, localClient, serverStatus, stopServer } from "./connect.ts";
import { promptNotifiers } from "./notify-prompt.ts";
import { unwrap } from "./output.ts";
import { installPlugin, uninstallPlugin, writeMarketplace } from "./plugin.ts";
import { hasCommand, run, runInherited, runOrThrow } from "./system.ts";
import { answer, Cancelled } from "./ui.ts";
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

function interactive(options: InstallOptions): boolean {
  return !options.yes && Boolean(process.stdin.isTTY);
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

async function checkPrerequisites(): Promise<{ claude: boolean }> {
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

  return { claude: await findClaude() };
}

async function findClaude(): Promise<boolean> {
  const claude = await hasCommand("claude");

  if (!claude) {
    p.log.warn(
      "The claude CLI isn't on PATH, so the plugin step is skipped. Install it before queuing jobs.",
    );
  }

  return claude;
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

async function setUpPlugin(title: string, home: string): Promise<void> {
  await step(title, async () => {
    const dir = join(home, "plugin");

    await writeMarketplace(dir, pkg.version);
    await installPlugin(dir);

    return undefined;
  });
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

const MODELS = [
  { value: "claude-opus-5-5", label: "Opus 5.5" },
  { value: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { value: "claude-haiku-5-5", label: "Haiku 5.5" },
  { value: "claude-fable-5-2", label: "Fable 5.2" },
];

const DEFAULT_MODEL = "";
const OTHER_MODEL = "other";

async function promptConfig(path: string): Promise<void> {
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

  const custom =
    current.model && !MODELS.some((model) => model.value === current.model)
      ? [{ value: current.model, label: current.model }]
      : [];
  let model = answer(
    await p.select({
      message: "Which model should agents use?",
      options: [
        { value: DEFAULT_MODEL, label: "Agent default" },
        ...custom,
        ...MODELS,
        { value: OTHER_MODEL, label: "Other", hint: "type a model id" },
      ],
      initialValue: current.model ?? DEFAULT_MODEL,
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

  const effort = answer(
    await p.select({
      message: "How much effort should agents spend?",
      options: EFFORTS.map((value) => ({ value })),
      initialValue: current.effort,
    }),
  );

  await writeConfigValue(path, "effort", effort);
}

async function setUpNotifiers(): Promise<void> {
  let client: Client;

  try {
    client = await connect();
  } catch {
    p.log.warn("Couldn't start the server to set up notifications. Run openmill notify add later.");

    return;
  }

  try {
    const { notifiers } = await unwrap(client.notifiers.$get());

    if (notifiers.length > 0) {
      p.note(
        notifiers.map((entry) => `${entry.name}  ${entry.type}  ${entry.url}`).join("\n"),
        "Notifications",
      );
    } else {
      await promptNotifiers(client);
    }
  } finally {
    // The server started from this process's binary, which may be a temporary npx copy, so stop it
    // and let the next command start it from the installed one.
    await stopServer(client);
  }
}

export async function install(options: InstallOptions): Promise<void> {
  const paths = resolvePaths();

  p.intro(pc.inverse(` openmill ${pkg.version} `));

  try {
    const { claude } = await checkPrerequisites();

    await step("Installing openmill globally", installGlobal);
    await step("Creating the openmill home", async () => {
      await mkdir(paths.home, { recursive: true, mode: 0o700 });

      return paths.home;
    });

    if (claude) {
      await setUpPlugin("Installing the Claude plugin", paths.home);
    }

    await stopRunningServer();

    if (interactive(options)) {
      await promptConfig(paths.config);
      await setUpNotifiers();
    }

    p.note(
      "openmill add docs/feature.md\nopenmill ls\n\nThe first job's window shows Claude Code's Bypass Permissions warning.\nRun openmill open <id> and accept it once.",
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

    if (await findClaude()) {
      await setUpPlugin("Refreshing the Claude plugin", resolvePaths().home);
    }

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
        await rm(join(paths.home, "plugin"), { recursive: true, force: true });

        return undefined;
      });
    }

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

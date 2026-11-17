import { realpathSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import { parseConfigValue, type ConfigKey } from "@openmill/core";
import { readConfig, resolvePaths, writeConfigValue } from "@openmill/server";
import pc from "picocolors";
import pkg from "../package.json" with { type: "json" };
import { localClient, serverStatus, stopServer } from "./connect.ts";
import { installPlugin, uninstallPlugin, writeMarketplace } from "./plugin.ts";
import { hasCommand, run, runOrThrow } from "./system.ts";
import { installedGlobalVersion, isInside, meetsNodeVersion, MIN_NODE_MAJOR } from "./versions.ts";

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

  if (!(await run("gh", ["auth", "status"])).ok) {
    p.log.warn(`gh isn't signed in. Run ${pc.bold("gh auth login")} before queuing jobs.`);
  }

  const claude = await hasCommand("claude");

  if (!claude) {
    p.log.warn(
      "The claude CLI isn't on PATH, so the plugin step is skipped and resume commands won't work. Headless runs still work.",
    );
  }

  return { claude };
}

async function installGlobal(): Promise<string | undefined> {
  const bin = realpathSync(process.argv[1] as string);

  if (!bin.split(/[\\/]/).includes("node_modules")) {
    return "running from source, skipped";
  }

  const root = (await runOrThrow("npm", ["root", "-g"])).trim();

  if (isInside(bin, realpathSync(root))) {
    return "already global";
  }

  const listed = await run("npm", ["ls", "-g", pkg.name, "--json", "--depth=0"]);

  if (installedGlobalVersion(listed.stdout, pkg.name) === pkg.version) {
    return `${pkg.version} already installed`;
  }

  await runOrThrow("npm", ["install", "-g", `${pkg.name}@${pkg.version}`]);

  return pkg.version;
}

async function stopRunningServer(options: InstallOptions): Promise<string | undefined> {
  const client = localClient();
  const status = await serverStatus(client);

  if (!status) {
    return "not running";
  }

  if ((status.running ?? 0) > 0) {
    const stop =
      interactive(options) &&
      answer(
        await p.confirm({
          message: `${status.running} jobs are running. Stop the server anyway? Their runs will be aborted.`,
          initialValue: false,
        }),
      );

    if (!stop) {
      p.log.warn(
        `Left the server running. Run ${pc.bold("openmill server stop")} once its jobs finish.`,
      );

      return undefined;
    }
  }

  await stopServer(client);

  return "stopped";
}

const CONFIG_PROMPTS: Array<{ key: ConfigKey; message: string }> = [
  { key: "concurrency", message: "How many jobs can run at once?" },
  { key: "model", message: "Which model should agents use? Leave empty for the harness default." },
];

async function promptConfig(path: string): Promise<void> {
  const current = await readConfig(path);

  for (const { key, message } of CONFIG_PROMPTS) {
    const value = answer(
      await p.text({
        message,
        initialValue: String(current[key] ?? ""),
        validate: (input = "") => {
          const parsed = parseConfigValue(key, input);

          return input.trim() === "" || parsed.ok ? undefined : parsed.error;
        },
      }),
    ).trim();
    const parsed = parseConfigValue(key, value);

    if (value !== "" && parsed.ok) {
      await writeConfigValue(path, key, parsed.value);
    }
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
      await step("Installing the Claude plugin", async () => {
        const dir = join(paths.home, "plugin");

        await writeMarketplace(dir, pkg.version);
        await installPlugin(dir);

        return undefined;
      });
    }

    await step("Stopping the old server", () => stopRunningServer(options));

    if (interactive(options)) {
      await promptConfig(paths.config);
    }

    p.note(`openmill add docs/feature.md\nopenmill ls`, "Next steps");
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

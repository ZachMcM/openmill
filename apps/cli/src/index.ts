#!/usr/bin/env node
import {
  CONFIG_KEYS,
  isConfigKey,
  parseAgent,
  parseEffort,
  parseModel,
  parsePermissionMode,
  parseTerminal,
  type ParsedValue,
} from "@openmill/core";
import { Argument, InvalidArgumentError, Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { NOTIFIER_TYPES, startServer, type NotifierType } from "@openmill/server";
import type { Client } from "@openmill/server/client";
import pc from "picocolors";
import { connect, isRunning, localClient, stopServer } from "./connect.ts";
import { collectDocs } from "./docs.ts";
import { hook, readStdin } from "./hook.ts";
import { install, uninstall, update } from "./install.ts";
import { promptNotifiers } from "./notify-prompt.ts";
import { fitLastColumn, table, unwrap } from "./output.ts";
import { Cancelled, fail, jobState, spin, state, warn } from "./ui.ts";

function option<T>(parse: (value: string) => ParsedValue<T>) {
  return (value: string): T => {
    const parsed = parse(value);

    if (!parsed.ok) {
      throw new InvalidArgumentError(parsed.error);
    }

    return parsed.value;
  };
}

async function runningClient(): Promise<Client | undefined> {
  const client = localClient();

  if (await isRunning(client)) {
    return client;
  }

  console.log(pc.dim("not running"));

  return undefined;
}

const program = new Command()
  .name("openmill")
  .description(pkg.description)
  .version(pkg.version, "-v, --version");

program
  .command("add")
  .description("queue design docs as jobs")
  .argument("<paths...>", "design docs or directories of them")
  .option("--repo <path>", "target repo (default: the git root of the current directory)")
  .option("--base <branch>", "base branch for jobs with no dependency")
  .option("--agent <name>", "agent for these jobs", option(parseAgent))
  .option(
    "--permission-mode <mode>",
    "permission mode for these jobs: auto or bypass",
    option(parsePermissionMode),
  )
  .option(
    "--terminal <name>",
    "terminal for these jobs: rex, herdr, or t3code",
    option(parseTerminal),
  )
  .option("--model <name>", "model for these jobs", option(parseModel))
  .option("--effort <level>", "effort for these jobs", option(parseEffort))
  .option("--force", "re-queue jobs that already started", false)
  .action(async (paths: string[], options) => {
    const { docs, warnings } = await collectDocs(paths, process.cwd());

    for (const warning of warnings) {
      warn(warning);
    }

    const client = await connect();
    const { jobs } = await spin(`queuing ${docs.length} docs`, () =>
      unwrap(
        client.jobs.$post({
          json: {
            repo: options.repo ?? process.cwd(),
            base: options.base,
            agent: options.agent,
            permissionMode: options.permissionMode,
            terminal: options.terminal,
            model: options.model,
            effort: options.effort,
            force: options.force,
            docs,
          },
        }),
      ),
    );

    for (const job of jobs) {
      console.log(
        `${job.action === "unchanged" ? pc.dim(job.action) : pc.green(job.action)} ${pc.bold(job.id)}`,
      );
    }
  });

program
  .command("ls")
  .description("list jobs")
  .action(async () => {
    const { jobs } = await unwrap((await connect()).jobs.$get());
    const header = ["ID", "STATE", "SESSION", "PR", "REASON"];

    console.log(
      table(
        header,
        fitLastColumn(
          header,
          jobs.map((job) => [
            pc.bold(job.id),
            jobState(job),
            pc.dim(job.sessionId ?? ""),
            job.prUrl ?? "",
            job.reason ?? "",
          ]),
        ),
      ),
    );
  });

program
  .command("show")
  .description("show a job, its window, and its Claude session")
  .argument("<id>")
  .action(async (id: string) => {
    const job = await unwrap(
      (await connect()).jobs[":id"].$get({ param: { id }, query: { repo: process.cwd() } }),
    );
    const fields: Array<[string, string]> = [
      ["id", pc.bold(job.id)],
      ["repo", job.repo],
      ["state", `${jobState(job)}${job.reason ? ` (${job.reason})` : ""}`],
      ["branch", `${job.branch}${job.prBaseBranch ? ` -> ${job.prBaseBranch}` : ""}`],
      ["worktree", job.worktree],
      ["window", job.window ?? "-"],
      ["session", job.sessionId ?? "-"],
      ["transcript", job.transcriptPath ?? "-"],
      ["pr", job.prUrl ?? "-"],
      job.link ? ["thread", job.link] : ["capture", job.capturePath ?? "-"],
      ["result", job.lastResult ? JSON.stringify(job.lastResult) : "-"],
    ];

    console.log(
      fields.map(([label, value]) => `${pc.dim(`${label}:`.padEnd(12))}${value}`).join("\n"),
    );
  });

program
  .command("open")
  .description("focus a job's window in its terminal")
  .argument("<id>")
  .action(async (id: string) => {
    const { url } = await unwrap(
      (await connect()).jobs[":id"].open.$post({ param: { id }, query: { repo: process.cwd() } }),
    );

    if (url) {
      console.log(url);
    }
  });

program
  .command("cancel")
  .description("close a job's window and cancel it")
  .argument("<id>")
  .action(async (id: string) => {
    const result = await unwrap(
      (await connect()).jobs[":id"].cancel.$post({ param: { id }, query: { repo: process.cwd() } }),
    );

    console.log(`${pc.bold(id)} is ${state(result.state)}`);
  });

program
  .command("requeue")
  .description(
    "resume a failed job's session, approve an awaiting_push job's changes, or retry a needs_input job's follow-ups",
  )
  .argument("<id>")
  .action(async (id: string) => {
    const result = await unwrap(
      (await connect()).jobs[":id"].requeue.$post({
        param: { id },
        query: { repo: process.cwd() },
      }),
    );

    console.log(`${pc.bold(id)} is ${state(result.state)}`);
  });

program
  .command("clean")
  .description("close the windows of done, merged, closed, and cancelled jobs")
  .action(async () => {
    const { closed } = await unwrap((await connect()).clean.$post());

    console.log(`closed ${closed} ${closed === 1 ? "window" : "windows"}`);
  });

program
  .command("hook", { hidden: true })
  .description("forward an agent hook event to the server")
  .argument("<event>")
  .action(async (event: string) => {
    await hook(event, await readStdin());
  });

const config = program.command("config").description("read and write config.json");

config
  .command("get")
  .argument("<key>", CONFIG_KEYS.join(", "))
  .action(async (key: string) => {
    if (!isConfigKey(key)) {
      throw new Error(`unknown config key ${key}`);
    }

    const { config: values } = await unwrap((await connect()).config.$get());

    console.log(String(values[key] ?? ""));
  });

config
  .command("set")
  .argument("<key>", CONFIG_KEYS.join(", "))
  .argument("<value>")
  .action(async (key: string, value: string) => {
    const { note } = await unwrap(
      (await connect()).config[":key"].$put({ param: { key }, json: { value } }),
    );

    if (note) {
      console.log(note);
    }
  });

config
  .command("unset")
  .description("remove a value so the default applies")
  .argument("<key>", CONFIG_KEYS.join(", "))
  .action(async (key: string) => {
    const { note } = await unwrap((await connect()).config[":key"].$delete({ param: { key } }));

    if (note) {
      console.log(note);
    }
  });

config.command("list").action(async () => {
  const { config: values } = await unwrap((await connect()).config.$get());

  console.log(
    table(
      ["KEY", "VALUE"],
      CONFIG_KEYS.map((key) => [
        key,
        values[key] === undefined ? pc.dim("(agent default)") : String(values[key]),
      ]),
    ),
  );
});

const notify = program.command("notify").description("send notifications to Discord and Slack");

notify
  .command("add")
  .description("add a Discord or Slack webhook, or set one up interactively")
  .addArgument(new Argument("[type]").choices(NOTIFIER_TYPES))
  .argument("[url]", "incoming webhook URL")
  .option("--name <name>", "name for this notifier (default: the type)")
  .action(
    async (
      type: NotifierType | undefined,
      url: string | undefined,
      options: { name?: string },
      command: Command,
    ) => {
      if (type && url) {
        const name = options.name ?? type;

        await unwrap((await connect()).notifiers.$post({ json: { name, type, url } }));
        console.log(`added ${pc.bold(name)}`);

        return;
      }

      if (type || !process.stdin.isTTY) {
        command.help({ error: true });
      }

      try {
        await promptNotifiers(await connect());
      } catch (error) {
        if (!(error instanceof Cancelled)) {
          throw error;
        }

        process.exitCode = 1;
      }
    },
  );

notify.command("ls").action(async () => {
  const { notifiers } = await unwrap((await connect()).notifiers.$get());

  if (notifiers.length === 0) {
    console.log("No notifiers. Run openmill notify add.");

    return;
  }

  console.log(
    table(
      ["NAME", "TYPE", "URL"],
      notifiers.map((entry) => [pc.bold(entry.name), entry.type, entry.url]),
    ),
  );
});

notify
  .command("rm")
  .argument("<name>")
  .action(async (name: string) => {
    await unwrap((await connect()).notifiers[":name"].$delete({ param: { name } }));
    console.log(`removed ${pc.bold(name)}`);
  });

notify
  .command("test")
  .description("send a test message to one notifier, or to all of them")
  .argument("[name]")
  .action(async (name: string | undefined) => {
    const { results } = await unwrap((await connect()).notifiers.test.$post({ json: { name } }));

    for (const result of results) {
      console.log(
        `${result.name}  ${result.ok ? pc.green("ok") : pc.red(`failed: ${result.error}`)}`,
      );
    }

    if (results.some((result) => !result.ok)) {
      process.exitCode = 1;
    }
  });

const server = program.command("server").description("manage the background server");

server.command("status").action(async () => {
  const client = await runningClient();

  if (!client) {
    return;
  }

  const status = await unwrap(client.status.$get());

  console.log(
    `${pc.green("running")} ${status.version} (pid ${status.pid}), ${status.running} running jobs, ${status.queued} queued`,
  );
});

server.command("stop").action(async () => {
  const client = await runningClient();

  if (!client) {
    return;
  }

  await spin("stopping the server", () => stopServer(client));
  console.log("stopped");
});

server
  .command("run", { hidden: true })
  .description("run the server in the foreground")
  .action(async () => {
    const running = await startServer({
      version: pkg.version,
      hookCommand: [process.execPath, ...process.execArgv, process.argv[1] as string],
      log: (message) => console.error(message),
    });

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.on(signal, () => void running.close());
    }

    await running.closed;
  });

program
  .command("install")
  .description("install openmill globally and set up the Claude plugin")
  .option("-y, --yes", "accept defaults without prompting", false)
  .action(install);

program
  .command("update")
  .description("update openmill to the latest release and refresh the Claude plugin")
  .action(update);

program
  .command("uninstall")
  .description("remove the Claude plugin and the global package")
  .option("--purge", "also delete the openmill home directory", false)
  .option("-y, --yes", "don't ask before deleting", false)
  .action(uninstall);

try {
  await program.parseAsync();
} catch (error) {
  fail((error as Error).message);
  process.exitCode = 1;
}

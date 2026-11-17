#!/usr/bin/env node
import {
  CONFIG_KEYS,
  isConfigKey,
  parseEffort,
  parseHarness,
  parseModel,
  type ParsedValue,
} from "@openmill/core";
import { InvalidArgumentError, Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { startServer } from "@openmill/server";
import type { Client } from "@openmill/server/client";
import { connect, isRunning, localClient } from "./connect.ts";
import { collectDocs } from "./docs.ts";
import { table, unwrap } from "./output.ts";

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

  console.log("not running");

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
  .option("--harness <name>", "harness for these jobs", option(parseHarness))
  .option("--model <name>", "model for these jobs", option(parseModel))
  .option("--effort <level>", "effort for these jobs", option(parseEffort))
  .option("--force", "re-queue jobs that already started", false)
  .action(async (paths: string[], options) => {
    const { docs, warnings } = await collectDocs(paths, process.cwd());

    for (const warning of warnings) {
      console.warn(`warning: ${warning}`);
    }

    const client = await connect();
    const { jobs } = await unwrap(
      client.jobs.$post({
        json: {
          repo: options.repo ?? process.cwd(),
          base: options.base,
          harness: options.harness,
          model: options.model,
          effort: options.effort,
          force: options.force,
          docs,
        },
      }),
    );

    for (const job of jobs) {
      console.log(`${job.action} ${job.id}`);
    }
  });

program
  .command("ls")
  .description("list jobs")
  .action(async () => {
    const { jobs } = await unwrap((await connect()).jobs.$get());

    console.log(
      table(
        ["ID", "STATE", "REASON", "SESSION", "PR"],
        jobs.map((job) => [
          job.id,
          job.state,
          job.reason ?? "",
          job.sessionId ?? "",
          job.prUrl ?? "",
        ]),
      ),
    );
  });

program
  .command("show")
  .description("show a job and how to resume its session")
  .argument("<id>")
  .action(async (id: string) => {
    const job = await unwrap(
      (await connect()).jobs[":id"].$get({ param: { id }, query: { repo: process.cwd() } }),
    );
    const lines = [
      `id:        ${job.id}`,
      `repo:      ${job.repo}`,
      `state:     ${job.state}${job.reason ? ` (${job.reason})` : ""}`,
      `branch:    ${job.branch}${job.prBaseBranch ? ` -> ${job.prBaseBranch}` : ""}`,
      `worktree:  ${job.worktree}`,
      `session:   ${job.sessionId ?? "-"}`,
      `pr:        ${job.prUrl ?? "-"}`,
      `log:       ${job.logPath ?? "-"}`,
      `result:    ${job.lastResult ? JSON.stringify(job.lastResult) : "-"}`,
    ];

    if (job.resumeCommand) {
      lines.push("", "Resume the session:", `  ${job.resumeCommand}`);
    }

    console.log(lines.join("\n"));
  });

program
  .command("stop")
  .description("abort a running job so you can take it over")
  .argument("<id>")
  .action(async (id: string) => {
    const { state } = await unwrap(
      (await connect()).jobs[":id"].stop.$post({ param: { id }, query: { repo: process.cwd() } }),
    );

    console.log(`${id} is ${state}. Run \`openmill show ${id}\` for the resume command.`);
  });

program
  .command("requeue")
  .description("hand a paused, needs_input, or failed job back to the queue")
  .argument("<id>")
  .action(async (id: string) => {
    const { state } = await unwrap(
      (await connect()).jobs[":id"].requeue.$post({
        param: { id },
        query: { repo: process.cwd() },
      }),
    );

    console.log(`${id} is ${state}`);
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
    await unwrap((await connect()).config[":key"].$put({ param: { key }, json: { value } }));
  });

config.command("list").action(async () => {
  const { config: values } = await unwrap((await connect()).config.$get());

  console.log(
    table(
      ["KEY", "VALUE"],
      CONFIG_KEYS.map((key) => [key, String(values[key] ?? "(harness default)")]),
    ),
  );
});

const server = program.command("server").description("manage the background server");

server.command("status").action(async () => {
  const client = await runningClient();

  if (!client) {
    return;
  }

  const status = await unwrap(client.status.$get());

  console.log(
    `running (pid ${status.pid}), ${status.running} running jobs, ${status.queued} queued`,
  );
});

server.command("stop").action(async () => {
  const client = await runningClient();

  if (!client) {
    return;
  }

  await unwrap(client.shutdown.$post());
  console.log("stopped");
});

server
  .command("run", { hidden: true })
  .description("run the server in the foreground")
  .action(async () => {
    const running = await startServer({ log: (message) => console.error(message) });

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.on(signal, () => void running.close());
    }

    await running.closed;
  });

try {
  await program.parseAsync();
} catch (error) {
  console.error(`error: ${(error as Error).message}`);
  process.exitCode = 1;
}

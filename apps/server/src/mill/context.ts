import type { Config, PrObservation, TerminalName } from "@openmill/core";
import type { Db, Job } from "@openmill/db";
import type { Agent } from "../agent/types.ts";
import type { GitHub } from "../github.ts";
import type { Notify } from "../notifier/index.ts";
import type { NotifierEntry } from "../notifier/types.ts";
import type { Paths } from "../paths.ts";
import type { Terminal } from "../terminal/types.ts";

export interface MillContext {
  db: Db;
  paths: Paths;
  terminals: Record<TerminalName, Terminal>;
  agents: Record<string, Agent>;
  github: GitHub;
  hookCommand: string[];
  log: (message: string) => void;
  debug: (message: string) => void;
  notifier: Notify;
  notifiers: NotifierEntry[];
  config: Config;
  preparing: Set<number>;
  staleHeads: Map<number, string>;
  tasklessStops: Set<number>;
  schedule: () => void;
  refresh: (job: Job) => Promise<PrObservation | undefined>;
}

import type { Config } from "@openmill/core";
import type { Db } from "@openmill/db";
import type { Agent } from "../agent/types.ts";
import type { GitHub } from "../github.ts";
import type { Notify } from "../notify.ts";
import type { Paths } from "../paths.ts";
import type { Terminal } from "../terminal/types.ts";

export interface MillContext {
  db: Db;
  paths: Paths;
  terminal: Terminal;
  agents: Record<string, Agent>;
  github: GitHub;
  hookCommand: string[];
  log: (message: string) => void;
  notifier: Notify;
  config: Config;
  preparing: Set<number>;
  staleHeads: Map<number, string>;
  busyRuns: Set<number>;
  schedule: () => void;
}

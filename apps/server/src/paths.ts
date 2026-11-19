import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export interface Paths {
  home: string;
  db: string;
  config: string;
  notifiers: string;
  socket: string;
  pid: string;
  log: string;
  rexSession: string;
  herdrWorkspace: string;
  t3Hooks: string;
  t3Token: string;
  jobsDir: string;
  worktreesDir: string;
}

export function resolvePaths(): Paths {
  const home = process.env.OPENMILL_HOME ?? join(homedir(), ".openmill");

  return {
    home,
    db: join(home, "openmill.db"),
    config: join(home, "config.json"),
    notifiers: join(home, "notifiers.json"),
    socket: join(home, "server.sock"),
    pid: join(home, "server.pid"),
    log: join(home, "server.log"),
    rexSession: join(home, "rex-session"),
    herdrWorkspace: join(home, "herdr-workspace"),
    t3Hooks: join(home, "t3-hooks.json"),
    t3Token: join(home, "t3-token.json"),
    jobsDir: join(home, "jobs"),
    worktreesDir: join(home, "worktrees"),
  };
}

function repoDirName(repoPath: string): string {
  return `${basename(repoPath)}-${shortHash(repoPath)}`;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

export function jobDir(paths: Paths, repoPath: string, id: string): string {
  return join(paths.jobsDir, repoDirName(repoPath), id);
}

export function worktreePath(paths: Paths, repoPath: string, id: string): string {
  return join(paths.worktreesDir, repoDirName(repoPath), id);
}

export function branchName(id: string): string {
  return `openmill/${id}`;
}

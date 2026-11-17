import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export interface Paths {
  home: string;
  db: string;
  config: string;
  socket: string;
  pid: string;
  log: string;
  jobsDir: string;
  worktreesDir: string;
}

export function resolvePaths(): Paths {
  const home = process.env.OPENMILL_HOME ?? join(homedir(), ".openmill");

  return {
    home,
    db: join(home, "openmill.db"),
    config: join(home, "config.json"),
    socket: socketPath(home),
    pid: join(home, "server.pid"),
    log: join(home, "server.log"),
    jobsDir: join(home, "jobs"),
    worktreesDir: join(home, "worktrees"),
  };
}

// Windows has no unix socket files, so the server uses a named pipe unique to the home directory.
function socketPath(home: string): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\openmill-${shortHash(home)}`;
  }

  return join(home, "server.sock");
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

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { exec } from "./exec.ts";

const repoLocks = new Map<string, Promise<unknown>>();

// git locks .git/config and refs, so concurrent worktree adds in one repo fail.
export function withRepoLock<T>(repo: string, task: () => Promise<T>): Promise<T> {
  const next = (repoLocks.get(repo) ?? Promise.resolve()).catch(() => {}).then(task);

  repoLocks.set(repo, next);

  return next;
}

export async function gitRoot(dir: string): Promise<string> {
  const stdout = await exec("git", ["rev-parse", "--show-toplevel"], dir);

  return resolve(stdout.trim());
}

export async function fetchDefaultBranch(repo: string): Promise<string> {
  await exec("git", ["fetch", "origin"], repo);

  const stdout = await exec("git", ["ls-remote", "--symref", "origin", "HEAD"], repo);
  const match = /^ref: refs\/heads\/(\S+)\s+HEAD/m.exec(stdout);

  if (!match?.[1]) {
    throw new Error("could not find the default branch of origin");
  }

  return match[1];
}

async function branchExists(repo: string, branch: string): Promise<boolean> {
  try {
    await exec("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], repo);

    return true;
  } catch {
    return false;
  }
}

export async function ensureWorktree(
  repo: string,
  path: string,
  branch: string,
  start: string,
): Promise<void> {
  if (existsSync(path)) {
    return;
  }

  await mkdir(dirname(path), { recursive: true });
  await exec("git", ["worktree", "prune"], repo);

  if (await branchExists(repo, branch)) {
    await exec("git", ["worktree", "add", path, branch], repo);
  } else {
    await exec("git", ["worktree", "add", "--no-track", path, "-b", branch, start], repo);
  }
}

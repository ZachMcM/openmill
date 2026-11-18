import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { BranchState } from "@openmill/core";
import { exec } from "./exec.ts";

const repoLocks = new Map<string, Promise<unknown>>();

// git locks .git/config and refs, so concurrent worktree adds in one repo fail.
export function withRepoLock<T>(repo: string, task: () => Promise<T>): Promise<T> {
  const next = (repoLocks.get(repo) ?? Promise.resolve()).catch(() => {}).then(task);

  repoLocks.set(repo, next);

  return next;
}

export async function git(cwd: string, args: string[]): Promise<string> {
  return (await exec("git", args, cwd)).trim();
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

export async function removeWorktree(repo: string, path: string, branch: string): Promise<void> {
  if (existsSync(path)) {
    await exec("git", ["worktree", "remove", "--force", path], repo);
  }

  if (await branchExists(repo, branch)) {
    await exec("git", ["branch", "-D", branch], repo);
  }
}

export async function fetchBranch(job: {
  repoPath: string;
  worktreePath: string;
  branchName: string;
  baseBranch: string | null;
}): Promise<string> {
  await ensureWorktree(
    job.repoPath,
    job.worktreePath,
    job.branchName,
    job.baseBranch ?? job.branchName,
  );
  await git(job.worktreePath, ["fetch", "origin"]);

  return git(job.worktreePath, ["rev-parse", `origin/${job.branchName}`]);
}

export async function fastForward(
  worktree: string,
  branch: string,
): Promise<{ head: string } | { problem: string }> {
  const remote = `origin/${branch}`;

  if (await isDirty(worktree)) {
    return { problem: "the worktree has uncommitted changes" };
  }

  const [ahead = 0, behind = 0] = (
    await git(worktree, ["rev-list", "--left-right", "--count", `HEAD...${remote}`])
  )
    .split(/\s+/)
    .map(Number);

  if (ahead > 0 && behind > 0) {
    return { problem: `the branch has diverged from ${remote}` };
  }

  await git(worktree, ["merge", "--ff-only", remote]);

  return { head: await git(worktree, ["rev-parse", "HEAD"]) };
}

async function isDirty(worktree: string): Promise<boolean> {
  return (await git(worktree, ["status", "--porcelain"])) !== "";
}

export async function branchState(
  worktree: string,
  branch: string,
  startSha: string | null,
): Promise<BranchState> {
  const [head, unpushed, dirty, rebaseDir] = await Promise.all([
    git(worktree, ["rev-parse", "HEAD"]),
    git(worktree, ["rev-list", "--count", `origin/${branch}..HEAD`]).catch(() => "1"),
    isDirty(worktree),
    git(worktree, ["rev-parse", "--git-path", "rebase-merge"]),
  ]);

  return {
    progressed: head !== startSha,
    unpushed: Number(unpushed) > 0,
    dirty: dirty || existsSync(resolve(worktree, rebaseDir)),
  };
}

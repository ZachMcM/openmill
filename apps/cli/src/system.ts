import { execFile, spawn } from "node:child_process";

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function run(command: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(command, args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: stdout.toString(),
        stderr: stderr.toString() || (error?.message ?? ""),
      });
    });
  });
}

export async function runOrThrow(command: string, args: string[]): Promise<string> {
  const result = await run(command, args);

  if (!result.ok) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }

  return result.stdout;
}

export async function hasCommand(command: string, versionArgs = ["--version"]): Promise<boolean> {
  return (await run(command, versionArgs)).ok;
}

export function runInherited(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    spawn(command, args, { stdio: "inherit" })
      .on("error", reject)
      .on("close", (code) => resolve(code ?? 1));
  });
}

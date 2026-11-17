import { execFile } from "node:child_process";

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

const isWindows = process.platform === "win32";

// npm and other tools are .cmd shims on Windows, which Node only runs through a shell.
function quote(arg: string): string {
  return /^[\w./:\\=@-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '\\"')}"`;
}

export function run(command: string, args: string[]): Promise<RunResult> {
  const [file, argv] = isWindows ? [[command, ...args].map(quote).join(" "), []] : [command, args];

  return new Promise((resolve) => {
    execFile(
      file,
      argv,
      { shell: isWindows, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: stdout.toString(),
          stderr: stderr.toString() || (error?.message ?? ""),
        });
      },
    );
  });
}

export async function runOrThrow(command: string, args: string[]): Promise<string> {
  const result = await run(command, args);

  if (!result.ok) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }

  return result.stdout;
}

export async function hasCommand(command: string): Promise<boolean> {
  return (await run(command, ["--version"])).ok;
}

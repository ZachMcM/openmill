import { execFile } from "node:child_process";

export function exec(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr.trim() || error.message;

        reject(
          Object.assign(new Error(`${command} ${args.join(" ")} failed: ${detail}`), { detail }),
        );
      } else {
        resolve(stdout);
      }
    });
  });
}

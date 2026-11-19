import { readFile } from "node:fs/promises";
import { exec } from "../exec.ts";
import type { Readiness } from "./types.ts";

export function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

export async function runChecks(checks: Array<[string, ...string[]]>): Promise<Readiness> {
  for (const [command, ...args] of checks) {
    try {
      await exec(command, args, process.cwd());
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }
  }

  return { ok: true };
}

export function preToolUseDenial(reason: string): unknown {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

export async function lastTranscriptText(
  path: string,
  text: (line: unknown) => string | undefined,
): Promise<string | undefined> {
  const lines = (await readFile(path, "utf8")).split("\n");

  for (const line of lines.toReversed()) {
    let json: unknown;

    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }

    const found = text(json)?.trim();

    if (found) {
      return found;
    }
  }

  return undefined;
}

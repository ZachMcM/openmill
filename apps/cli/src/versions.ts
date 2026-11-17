import { isAbsolute, relative, resolve, sep } from "node:path";

export const MIN_NODE_MAJOR = 24;

export function meetsNodeVersion(version: string): boolean {
  return Number(version.replace(/^v/, "").split(".")[0]) >= MIN_NODE_MAJOR;
}

export function isInside(path: string, dir: string): boolean {
  const rel = relative(resolve(dir), resolve(path));

  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function installedGlobalVersion(npmLsOutput: string, name: string): string | undefined {
  const parsed = JSON.parse(npmLsOutput || "{}") as {
    dependencies?: Record<string, { version?: string }>;
  };

  return parsed.dependencies?.[name]?.version;
}

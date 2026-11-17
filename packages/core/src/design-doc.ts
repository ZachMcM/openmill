import { splitFrontmatter } from "./frontmatter.ts";

// Ids become branch and directory names, and git rejects ref names ending in ".lock".
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface DesignDocMeta {
  id: string;
  dependsOn: string[];
  project?: string;
}

export type DesignDocParse =
  | { kind: "doc"; meta: DesignDocMeta }
  | { kind: "no-id" }
  | { kind: "invalid"; error: string };

export function parseDesignDoc(content: string): DesignDocParse {
  let data: Record<string, unknown>;

  try {
    data = splitFrontmatter(content).data;
  } catch (error) {
    return { kind: "invalid", error: `invalid frontmatter: ${(error as Error).message}` };
  }

  if (data.id === undefined || data.id === null) {
    return { kind: "no-id" };
  }

  if (typeof data.id !== "string" || !ID_PATTERN.test(data.id) || data.id.endsWith(".lock")) {
    return {
      kind: "invalid",
      error: `id must match ${ID_PATTERN} (letters, digits, ".", "_", "-"), got ${JSON.stringify(data.id)}`,
    };
  }

  const dependsOn = parseDependsOn(data.depends_on);

  if (typeof dependsOn === "string") {
    return { kind: "invalid", error: dependsOn };
  }

  if (data.project !== undefined && (typeof data.project !== "string" || data.project === "")) {
    return { kind: "invalid", error: "project must be a folder path" };
  }

  return {
    kind: "doc",
    meta: { id: data.id, dependsOn, project: data.project as string | undefined },
  };
}

function parseDependsOn(value: unknown): string[] | string {
  if (value === undefined || value === null) {
    return [];
  }

  const paths = Array.isArray(value) ? value : [value];

  if (paths.some((path) => typeof path !== "string" || path === "")) {
    return "depends_on must be a path or a list of paths";
  }

  return paths as string[];
}

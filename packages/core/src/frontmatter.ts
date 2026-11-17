import { parse } from "yaml";

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function splitFrontmatter(content: string): Frontmatter {
  const match = FRONTMATTER.exec(content);

  if (!match) {
    return { data: {}, body: content };
  }

  const data: unknown = parse(match[1] ?? "");

  if (data === null || data === undefined) {
    return { data: {}, body: content.slice(match[0].length) };
  }

  if (typeof data !== "object" || Array.isArray(data)) {
    throw new Error("frontmatter must be a YAML mapping");
  }

  return { data: data as Record<string, unknown>, body: content.slice(match[0].length) };
}

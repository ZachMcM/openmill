import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { parseDesignDoc } from "@openmill/core";
import type { AddRequest } from "@openmill/server";

type AddDoc = AddRequest["docs"][number];

export interface CollectedDocs {
  docs: AddDoc[];
  warnings: string[];
}

const SKIPPED_DIRS = new Set([".git", "node_modules"]);

export async function collectDocs(inputs: string[], cwd: string): Promise<CollectedDocs> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const byPath = new Map<string, AddDoc & { dependsOnPaths: string[] }>();

  async function load(path: string, explicit: boolean): Promise<void> {
    const existing = byPath.get(path);

    if (existing) {
      existing.explicit ||= explicit;

      return;
    }

    let content: string;

    try {
      content = await readFile(path, "utf8");
    } catch {
      errors.push(`${path}: cannot read file`);

      return;
    }

    const parsed = parseDesignDoc(content);

    if (parsed.kind === "invalid") {
      errors.push(`${path}: ${parsed.error}`);

      return;
    }

    if (parsed.kind === "no-id") {
      if (explicit) {
        warnings.push(`skipping ${path}: no id in frontmatter`);
      } else {
        errors.push(`${path}: is a dependency but has no id in frontmatter`);
      }

      return;
    }

    const dir = dirname(path);
    const doc = {
      id: parsed.meta.id,
      path,
      content,
      project: parsed.meta.project
        ? await readProject(resolve(dir, parsed.meta.project), errors, path)
        : undefined,
      dependsOn: [],
      dependsOnPaths: parsed.meta.dependsOn.map((dep) => resolve(dir, dep)),
      explicit,
    };

    byPath.set(path, doc);

    for (const dep of doc.dependsOnPaths) {
      await load(dep, false);
    }
  }

  for (const input of inputs) {
    const path = resolve(cwd, input);
    const info = await stat(path).catch(() => undefined);

    if (!info) {
      errors.push(`${path}: no such file or directory`);
    } else if (info.isDirectory()) {
      for (const file of await markdownFiles(path)) {
        await load(file, true);
      }
    } else {
      await load(path, true);
    }
  }

  const docs = [...byPath.values()].map(({ dependsOnPaths, ...doc }) => ({
    ...doc,
    dependsOn: dependsOnPaths.flatMap((dep) => byPath.get(dep)?.id ?? []),
  }));

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  if (docs.length === 0) {
    throw new Error("no design docs with an id found");
  }

  return { docs, warnings };
}

async function markdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory() && !SKIPPED_DIRS.has(entry.name)) {
      files.push(...(await markdownFiles(path)));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
      files.push(path);
    }
  }

  return files.toSorted();
}

async function readProject(
  folder: string,
  errors: string[],
  docPath: string,
): Promise<AddDoc["project"]> {
  const overview = ["README.md", "index.md"]
    .map((name) => join(folder, name))
    .find((path) => existsSync(path));

  if (!overview) {
    errors.push(`${docPath}: project ${folder} has no README.md or index.md`);

    return undefined;
  }

  return { path: overview, content: await readFile(overview, "utf8") };
}

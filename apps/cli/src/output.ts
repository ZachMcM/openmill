import { stripVTControlCharacters as visible } from "node:util";
import pc from "picocolors";

type Body<R> = R extends { json(): Promise<infer T> } ? T : never;

export async function unwrap<R extends { ok: boolean; json(): Promise<unknown> }>(
  response: Promise<R>,
): Promise<Exclude<Body<R>, { error: string }>> {
  const res = await response;
  const body = await res.json();

  if (!res.ok) {
    const message = (body as { error?: unknown }).error;

    throw new Error(typeof message === "string" ? message : "request failed");
  }

  return body as Exclude<Body<R>, { error: string }>;
}

export function fitLastColumn(header: string[], rows: string[][]): string[][] {
  const columns = process.stdout.isTTY ? process.stdout.columns : undefined;
  const last = header.length - 1;
  const used = header
    .slice(0, last)
    .reduce(
      (sum, title, column) =>
        sum + Math.max(title.length, ...rows.map((row) => visible(row[column] ?? "").length)) + 2,
      0,
    );
  const room = columns ? Math.max(columns - used, header[last]?.length ?? 0) : Infinity;

  return rows.map((row) => {
    const text = (row[last] ?? "").replace(/\s+/g, " ").trim();
    const cell = text.length > room ? `${text.slice(0, room - 1)}…` : text;

    return [...row.slice(0, last), cell];
  });
}

export function table(header: string[], rows: string[][]): string {
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => visible(row[column] ?? "").length)),
  );

  return [header.map((title) => pc.dim(title)), ...rows]
    .map((row) =>
      row
        .map((cell, column) => cell + " ".repeat((widths[column] ?? 0) - visible(cell).length))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

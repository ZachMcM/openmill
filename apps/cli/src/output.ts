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

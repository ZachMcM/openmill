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
    Math.max(title.length, ...rows.map((row) => (row[column] ?? "").length)),
  );

  return [header, ...rows]
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

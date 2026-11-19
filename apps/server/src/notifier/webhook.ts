const TIMEOUT_MS = 10_000;

export async function postWebhook(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).trim().slice(0, 200);

    throw new Error(
      [`${res.status} ${res.statusText}`.trimEnd(), detail].filter(Boolean).join(": "),
    );
  }
}

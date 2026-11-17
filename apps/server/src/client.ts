import { request } from "node:http";
import { hc } from "hono/client";
import type { AppType } from "./app.ts";

function socketFetch(socketPath: string): typeof fetch {
  return async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const payload = req.body ? Buffer.from(await req.arrayBuffer()) : undefined;

    return new Promise<Response>((resolve, reject) => {
      const outgoing = request(
        {
          socketPath,
          method: req.method,
          path: `${url.pathname}${url.search}`,
          headers: Object.fromEntries(req.headers),
        },
        (res) => {
          const chunks: Buffer[] = [];

          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const headers = new Headers();

            for (const [name, value] of Object.entries(res.headers)) {
              if (value !== undefined) {
                headers.set(name, Array.isArray(value) ? value.join(", ") : value);
              }
            }

            resolve(
              new Response(Buffer.concat(chunks), { status: res.statusCode ?? 500, headers }),
            );
          });
          res.on("error", reject);
        },
      );

      outgoing.on("error", reject);
      outgoing.end(payload);
    });
  };
}

export function createClient(socketPath: string) {
  return hc<AppType>("http://openmill", { fetch: socketFetch(socketPath) });
}

export type Client = ReturnType<typeof createClient>;

import pkg from "../package.json" with { type: "json" };
import { startServer } from "./index.ts";

const server = await startServer({
  version: pkg.version,
  log: (message) => console.error(message),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void server.close());
}

await server.closed;
process.exit(0);

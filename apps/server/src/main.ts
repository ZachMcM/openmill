import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };
import { startServer } from "./index.ts";

const server = await startServer({
  version: pkg.version,
  hookCommand: [
    process.execPath,
    fileURLToPath(new URL("../../cli/src/index.ts", import.meta.url)),
  ],
  log: (message) => console.error(message),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void server.close());
}

await server.closed;
process.exit(0);

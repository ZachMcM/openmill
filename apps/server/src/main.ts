import { startServer } from "./index.ts";

const server = startServer({ dbPath: process.env.OPENMILL_DB ?? "openmill.db" });

process.on("SIGINT", () => {
  server.close();
  process.exit(0);
});

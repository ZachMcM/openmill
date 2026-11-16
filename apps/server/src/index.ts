import { createDb } from "@openmill/db";

export interface ServerOptions {
  dbPath: string;
}

export function startServer(options: ServerOptions) {
  const db = createDb(options.dbPath);

  return {
    close() {
      db.$client.close();
    },
  };
}

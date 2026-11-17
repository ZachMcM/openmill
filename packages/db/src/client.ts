import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";

export type Db = ReturnType<typeof createDb>;

const migrationsFolder: string = fileURLToPath(new URL("../drizzle", import.meta.url));

function createDb(path: string) {
  const client = new DatabaseSync(path);

  client.exec("PRAGMA journal_mode = WAL;");
  client.exec("PRAGMA foreign_keys = ON;");

  return drizzle({ client });
}

export function openDb(path: string): Db {
  const db = createDb(path);

  migrate(db, { migrationsFolder });

  return db;
}

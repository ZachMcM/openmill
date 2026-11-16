import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";

export type Db = ReturnType<typeof createDb>;

export function createDb(path: string) {
  const client = new DatabaseSync(path);

  client.exec("PRAGMA journal_mode = WAL;");
  client.exec("PRAGMA foreign_keys = ON;");

  return drizzle({ client });
}

export function runMigrations(db: Db, migrationsFolder: string) {
  migrate(db, { migrationsFolder });
}

import { describe, expect, it } from "vitest";
import { createDb } from "./client.ts";

describe("createDb", () => {
  it("opens an in-memory database with foreign keys enabled", async () => {
    const db = createDb(":memory:");
    const row = await db.get<{ foreign_keys: number }>("PRAGMA foreign_keys;");

    expect(row?.foreign_keys).toBe(1);
    db.$client.close();
  });
});

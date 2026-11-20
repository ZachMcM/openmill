import { describe, expect, it } from "vitest";
import { parseSince } from "./since.ts";

describe("parseSince", () => {
  const now = new Date("2026-11-19T12:00:00Z");

  it("subtracts each duration unit from now", () => {
    expect(parseSince("30m", now)).toEqual(new Date("2026-11-19T11:30:00Z"));
    expect(parseSince("2h", now)).toEqual(new Date("2026-11-19T10:00:00Z"));
    expect(parseSince("3d", now)).toEqual(new Date("2026-11-16T12:00:00Z"));
    expect(parseSince("1w", now)).toEqual(new Date("2026-11-12T12:00:00Z"));
  });

  it("reads a bare date as local midnight", () => {
    expect(parseSince("2026-11-01", now)).toEqual(new Date(2026, 10, 1));
  });

  it("uses a full timestamp as given", () => {
    expect(parseSince("2026-11-01T08:15:00Z", now)).toEqual(new Date("2026-11-01T08:15:00Z"));
  });

  it.each(["0d", "3x", "-2h", ""])("rejects %j", (input) => {
    expect(() => parseSince(input, now)).toThrow(
      `invalid --since value "${input}" (use a duration like 3d or a date like 2026-11-01)`,
    );
  });
});

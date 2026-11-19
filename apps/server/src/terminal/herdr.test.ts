import { describe, expect, it } from "vitest";
import fixture from "./herdr.fixture.json" with { type: "json" };
import { paneAlive, parseBlocks } from "./herdr.ts";

describe("herdr output", () => {
  it("labels each pane with its tab", () => {
    expect(parseBlocks(fixture.tabList.result, fixture.paneList.result)).toEqual([
      { blockId: "w1:p1", label: "1" },
      { blockId: "w1:p2", label: "job-a" },
    ]);
  });

  it("treats a pane as alive while its command, not its shell, is in the foreground", () => {
    expect(paneAlive(fixture.shellProcess.result)).toBe(false);
    expect(paneAlive(fixture.commandProcess.result)).toBe(true);
  });
});

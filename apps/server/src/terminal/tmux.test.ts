import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePanes } from "./tmux.ts";

describe("tmux output", () => {
  it("reads each pane's window name and whether its command is still running", () => {
    const fixture = readFileSync(new URL("./tmux.fixture.txt", import.meta.url), "utf8");

    expect(parsePanes(fixture)).toEqual([
      { blockId: "%0", label: "job-a", alive: true },
      { blockId: "%1", label: "job-b", alive: false },
    ]);
  });
});

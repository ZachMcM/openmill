import { describe, expect, it } from "vitest";
import { fastLaneInterval } from "./fast-lane.ts";

describe("fastLaneInterval", () => {
  it("ticks every second up to 10 requests a tick", () => {
    expect(fastLaneInterval(1)).toBe(1);
    expect(fastLaneInterval(10)).toBe(1);
  });

  it("grows linearly past 10 requests a tick", () => {
    expect(fastLaneInterval(20)).toBe(2);
    expect(fastLaneInterval(30)).toBe(3);
  });
});

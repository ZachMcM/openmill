import { describe, expect, it } from "vitest";
import { ancestors, checkGraph, findCycle, stackParent } from "./graph.ts";

function graph(edges: Record<string, string[]>): Map<string, string[]> {
  return new Map(Object.entries(edges));
}

describe("dependency graph", () => {
  it("collects ancestors through chains", () => {
    expect(ancestors(graph({ a: [], b: ["a"], c: ["b"] }), "c")).toEqual(new Set(["a", "b"]));
  });

  it("finds cycles", () => {
    expect(findCycle(graph({ a: ["b"], b: ["c"], c: ["a"] }))).toEqual(["a", "b", "c", "a"]);
    expect(findCycle(graph({ a: [], b: ["a"] }))).toBeUndefined();
  });

  it("stacks on the deepest dependency of a chain", () => {
    const chain = graph({ a: [], b: ["a"], c: ["a", "b"] });

    expect(stackParent(chain, "a")).toBeNull();
    expect(stackParent(chain, "c")).toBe("b");
  });

  it("has no stack parent for independent dependencies", () => {
    expect(stackParent(graph({ a: [], b: [], c: ["a", "b"] }), "c")).toBeUndefined();
  });

  it("accepts a valid graph", () => {
    expect(checkGraph(graph({ a: [], b: ["a"] }), ["a", "b"])).toEqual({ ok: true });
  });

  it("rejects cycles, unknown jobs, and independent parents", () => {
    expect(checkGraph(graph({ a: ["a"] }), ["a"])).toMatchObject({
      error: expect.stringContaining("cycle"),
    });
    expect(checkGraph(graph({ a: ["x"] }), ["a"])).toMatchObject({
      error: expect.stringContaining("unknown"),
    });
    expect(checkGraph(graph({ a: [], b: [], c: ["a", "b"] }), ["c"])).toMatchObject({
      error: expect.stringContaining("ancestor chain"),
    });
  });
});

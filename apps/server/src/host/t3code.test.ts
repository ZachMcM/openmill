import { describe, expect, it } from "vitest";
import { parseRuntimeOrigin, threadLink } from "./t3code.ts";

describe("T3 Code host", () => {
  it("reads the origin from server-runtime.json", () => {
    const runtime = JSON.stringify({
      version: 1,
      pid: 59685,
      port: 47311,
      origin: "http://127.0.0.1:47311",
      startedAt: "2026-11-19T06:11:48.092Z",
    });

    expect(parseRuntimeOrigin(runtime)).toBe("http://127.0.0.1:47311");
  });

  it("links a thread in the T3 web app", () => {
    expect(threadLink("0c120e08-a2a8\n", "mcp:d91c5f1f")).toBe(
      "https://app.t3.codes/threads/0c120e08-a2a8/mcp%3Ad91c5f1f",
    );
  });
});

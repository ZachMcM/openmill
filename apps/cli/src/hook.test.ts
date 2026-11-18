import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect } from "./connect.ts";
import { hook } from "./hook.ts";

vi.mock("./connect.ts", () => ({ connect: vi.fn<typeof connect>() }));

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "openmill-hook-"));
  vi.stubEnv("OPENMILL_HOME", home);
  vi.stubEnv("OPENMILL_RUN_ID", "7");
  vi.mocked(connect).mockRejectedValue(new Error("the openmill server didn't start"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

describe("openmill hook", () => {
  it("prints nothing, keeps exit code 0, and logs when the server can't be reached", async () => {
    const stdout = vi.spyOn(process.stdout, "write");
    const stderr = vi.spyOn(process.stderr, "write");

    await hook("Stop", JSON.stringify({ session_id: "s1", stop_hook_active: false }));

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    expect(process.exitCode ?? 0).toBe(0);
    expect(readFileSync(join(home, "hook.log"), "utf8")).toMatch(
      /Stop: the openmill server didn't start/,
    );
  });
});

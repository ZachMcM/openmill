import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installedGlobalVersion, isInside, isNewerVersion, meetsNodeVersion } from "./versions.ts";

describe("meetsNodeVersion", () => {
  it("accepts 24 and later and rejects older majors", () => {
    expect(meetsNodeVersion("24.0.0")).toBe(true);
    expect(meetsNodeVersion("v26.1.0")).toBe(true);
    expect(meetsNodeVersion("22.12.0")).toBe(false);
  });
});

describe("isInside", () => {
  const root = join("prefix", "lib", "node_modules");

  it("matches files under the directory", () => {
    expect(isInside(join(root, "openmill", "dist", "bin", "openmill.mjs"), root)).toBe(true);
  });

  it("rejects siblings that share a name prefix", () => {
    expect(isInside(join("prefix", "lib", "node_modules_old", "openmill"), root)).toBe(false);
  });

  it("rejects the directory itself and its parents", () => {
    expect(isInside(root, root)).toBe(false);
    expect(isInside("prefix", root)).toBe(false);
  });
});

describe("installedGlobalVersion", () => {
  it("reads the version from npm ls output", () => {
    const output = JSON.stringify({ dependencies: { openmill: { version: "0.2.0" } } });

    expect(installedGlobalVersion(output, "openmill")).toBe("0.2.0");
  });

  it("handles empty output when nothing is installed", () => {
    expect(installedGlobalVersion("", "openmill")).toBeUndefined();
    expect(installedGlobalVersion("{}", "openmill")).toBeUndefined();
  });
});

describe("isNewerVersion", () => {
  it("detects a newer major, minor, or patch", () => {
    expect(isNewerVersion("1.0.0", "0.5.1")).toBe(true);
    expect(isNewerVersion("0.6.0", "0.5.1")).toBe(true);
    expect(isNewerVersion("0.5.2", "0.5.1")).toBe(true);
  });

  it("rejects equal and older versions", () => {
    expect(isNewerVersion("0.5.1", "0.5.1")).toBe(false);
    expect(isNewerVersion("0.5.0", "0.5.1")).toBe(false);
  });

  it("compares numerically", () => {
    expect(isNewerVersion("0.10.0", "0.9.0")).toBe(true);
    expect(isNewerVersion("0.9.0", "0.10.0")).toBe(false);
  });
});

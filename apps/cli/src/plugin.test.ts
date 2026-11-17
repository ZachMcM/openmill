import { describe, expect, it } from "vitest";
import { marketplaceManifest, PLUGIN_ID } from "./plugin.ts";

describe("marketplaceManifest", () => {
  it("lists the plugin under the id the installer uses", () => {
    const manifest = marketplaceManifest("0.3.0", "workflow skill");
    const [plugin] = manifest.plugins;

    expect(`${plugin?.name}@${manifest.name}`).toBe(PLUGIN_ID);
    expect(plugin).toMatchObject({ source: "./openmill", version: "0.3.0" });
  });
});

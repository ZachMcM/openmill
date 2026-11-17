import { defineConfig } from "tsdown";

const assets = "../../packages/assets";

export default defineConfig({
  entry: { "bin/openmill": "src/index.ts" },
  platform: "node",
  target: "node24",
  format: "esm",
  deps: { alwaysBundle: [/^@openmill\//] },
  copy: [
    `${assets}/.claude-plugin`,
    `${assets}/skills`,
    `${assets}/agents`,
    "../../packages/db/drizzle",
    { from: "../../README.md", to: "." },
  ],
});

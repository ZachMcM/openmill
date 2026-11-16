#!/usr/bin/env node
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };

const program = new Command()
  .name("openmill")
  .description(pkg.description)
  .version(pkg.version, "-v, --version");

await program.parseAsync();

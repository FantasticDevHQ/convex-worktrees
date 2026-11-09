#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { installToolkit } from "./scripts/worktree/installer.mts";

try {
  if (process.argv.length !== 3)
    throw new Error("Usage: node install.mts /path/to/your/repository");
  const source = fileURLToPath(new URL(".", import.meta.url));
  const count = installToolkit(source, process.argv[2]);
  console.log(`Installed ${count} source files. Configure paths and package scripts before setup.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

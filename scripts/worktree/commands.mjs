import { existsSync } from "node:fs";

import path from "node:path";

import { spawn } from "node:child_process";

import { root, frontend, stateFile, sleep } from "./context.mjs";
import { projectLock } from "./registry.mjs";
import { state, childEnv } from "./config.mjs";
import { ownedRunning, serve, start, stopOnly } from "./processes.mjs";
import { setup, teardown, prune } from "./lifecycle.mjs";

export async function main() {
  const command = process.argv[2];
  if (command === "setup") await setup(process.argv.includes("--prepare-only"));
  else if (command === "start")
    await projectLock(
      () => start(process.argv.includes("--frontend")),
      "shared-convex-cache",
    );
  else if (command === "stop") {
    await stopOnly(await state());
    console.log("Stopped; ports and database preserved.");
  } else if (command === "teardown") await teardown();
  else if (command === "cleanup") await teardown(true);
  else if (command === "prune") await prune();
  else if (command === "_serve") {
    const s = await state();
    if (!process.argv.includes(`--owner=${s.id}`))
      throw new Error("Invalid process ownership token.");
    await serve(s, process.argv.includes("--frontend"));
  } else if (
    (command === "backend" || command === "dev") &&
    existsSync(stateFile)
  ) {
    const s = await state();
    if (await ownedRunning(s)) throw new Error("Backend already running.");
    await projectLock(() => start(command === "dev"), "shared-convex-cache");
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await stopOnly(s);
    };
    process.on("SIGTERM", () => void stop());
    process.on("SIGINT", () => void stop());
    while (!stopping && (await ownedRunning(s))) await sleep(250);
  } else if (command === "frontend") {
    const s = await state();
    const child = spawn(
      process.execPath,
      [
        path.join(root, "node_modules/next/dist/bin/next"),
        "dev",
        "--port",
        String(s.ports.web),
      ],
      { cwd: frontend, env: childEnv(s), stdio: "inherit" },
    );
    process.on("SIGTERM", () => child.kill("SIGINT"));
    process.on("SIGINT", () => child.kill("SIGINT"));
    child.on("exit", (code) => process.exit(code ?? 1));
  } else
    throw new Error(
      "Run worktree:setup first. Commands: setup, start, stop, teardown, cleanup --yes, prune, dev, backend, frontend",
    );
}

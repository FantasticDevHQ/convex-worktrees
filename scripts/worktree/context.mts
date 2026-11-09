import type { Layout } from "./types.mts";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const requested = await fs.realpath(process.cwd());
let root = requested;
while (
  !existsSync(path.join(root, "scripts/worktree.config.json")) &&
  path.dirname(root) !== root
)
  root = path.dirname(root);
if (!existsSync(path.join(root, "scripts/worktree.config.json")))
  root = requested;
const layout: Layout = await fs
  .readFile(path.join(root, "scripts/worktree.config.json"), "utf8")
  .then(JSON.parse)
  .catch((e) => {
    if (e.code === "ENOENT") return {};
    throw e;
  });
const backend = path.join(root, layout.backend || ".");
const frontend = path.join(root, layout.frontend || ".");
const frontendEnv = path.join(frontend, ".env.local");
const script = fileURLToPath(new URL("./cli.mts", import.meta.url));
const dir = path.join(root, ".worktree");
const stateFile = path.join(dir, "local.json");
const configFile = path.join(backend, ".convex/local/default/config.json");
const registry =
  process.env.WORKTREE_REGISTRY_DIR ||
  path.join(homedir(), ".local/state/convex-worktrees");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Callers name the persisted shape; their ownership/config checks still run at runtime.
const read = async <T,>(file: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
};

export {
  root,
  backend,
  frontend,
  frontendEnv,
  script,
  dir,
  stateFile,
  configFile,
  registry,
  sleep,
  read,
  layout,
};

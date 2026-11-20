// Opt-in storage for a worktree's own settings outside the checkout.
//
// Layout `"envFiles": false` stops the toolkit writing `.env.local` files: the
// frontend values are computed from `.worktree/local.json` and passed to the
// child processes. A profile's `configStore` additionally keeps those values,
// with the generated secrets, in a Doppler branch config named for the
// worktree, and runs the backend and frontend under `doppler run`.
//
// Values set from argv are ports, URLs and deployment names only. Generated
// secrets reach Doppler on stdin and are never printed.
import type { BackendState, ConfigStore, StoreRecord } from "./types.mts";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { backend, layout } from "./context.mts";
import { safe } from "./files.mts";

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const slug = /^[a-z0-9][a-z0-9_-]*$/;

/** Fails unless `store` is a valid `configStore` declaration. */
export function validateStore(store: unknown, profile: string): ConfigStore {
  const fail = (): never => {
    throw new Error(`Profile configuration: invalid configStore in ${profile}`);
  };
  if (
    !object(store) ||
    Object.keys(store).some(
      (key) => !["kind", "project", "config"].includes(key),
    )
  )
    fail();
  const { kind, project, config } = store as Record<string, unknown>;
  if (
    kind !== "doppler" ||
    typeof project !== "string" ||
    !slug.test(project) ||
    typeof config !== "string" ||
    !slug.test(config) ||
    config.includes("_")
  )
    fail();
  return {
    kind: "doppler",
    project: project as string,
    config: config as string,
  };
}

/**
 * The branch config for one worktree: `<root>_wt_<checkout>_<id8>`. The
 * checkout name makes it readable in Doppler; the identity prefix keeps two
 * checkouts with the same directory name apart.
 */
export function branchName(store: ConfigStore, root: string, id: string) {
  const name = path
    .basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `${store.config}_wt_${name || "checkout"}_${id.replace(/-/g, "").slice(0, 8)}`;
}

/** Only a branch config this toolkit named can be written or deleted. */
export function assertOwnedBranch(record: StoreRecord) {
  if (
    record.kind !== "doppler" ||
    !slug.test(record.project) ||
    !new RegExp(`^${record.root}_wt_[a-z0-9_]+_[0-9a-f]{8}$`).test(
      record.config,
    )
  )
    throw new Error("Refusing a Doppler config this worktree did not create.");
}

/** The values the frontend needs for this worktree's local backend. */
export function frontendValues(s: BackendState): Record<string, string> {
  return {
    CONVEX_DEPLOYMENT: `anonymous:${s.deployment || `anonymous-${path.basename(backend)}`}`,
    NEXT_PUBLIC_CONVEX_URL: `http://127.0.0.1:${s.ports.cloud}`,
    NEXT_PUBLIC_CONVEX_SITE_URL: `http://127.0.0.1:${s.ports.site}`,
    NEXT_PUBLIC_SITE_URL: `http://localhost:${s.ports.web}`,
    PORT: String(s.ports.web),
  };
}

// The Convex CLI writes the selected deployment and its URLs to `.env.local`
// in the backend directory on every configure, even with `--env-file`.
const convexWritten =
  /^(?:CONVEX_DEPLOYMENT|[A-Z0-9_]*CONVEX_(?:URL|SITE_URL))$/;

/**
 * With `envFiles: false`, removes the backend `.env.local` when it holds only
 * what the Convex CLI writes there. A file with any other key is left alone.
 */
export async function removeConvexEnvFile() {
  if (layout.envFiles !== false) return;
  const file = path.join(backend, ".env.local");
  await safe(file);
  const content = await fs.readFile(file, "utf8").catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (content === null) return;
  const keys = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => /^(?:export\s+)?([A-Za-z0-9_]+)\s*=/.exec(line)?.[1] ?? "");
  if (keys.every((key) => convexWritten.test(key)))
    await fs.rm(file, { force: true });
}

// Doppler must never point a child at a cloud deployment, whatever the
// inherited config holds. These keys are removed after Doppler injects values.
const remoteConvexKeys = [
  "CONVEX_DEPLOY_KEY",
  "CONVEX_DEPLOYMENT_TOKEN",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
  "CONVEX_URL",
  "CONVEX_SITE_URL",
];

/**
 * Wraps `command` in `doppler run` for the worktree's branch config. Doppler
 * runs with the developer's real HOME (its login lives there); `env` then
 * restores the isolated values in `isolated`, which take precedence over
 * anything Doppler injects.
 */
export function wrap(
  record: StoreRecord | undefined,
  command: string[],
  isolated: Record<string, string>,
) {
  if (!record) return command;
  assertOwnedBranch(record);
  return [
    "doppler",
    "run",
    "--project",
    record.project,
    "--config",
    record.config,
    "--",
    "env",
    ...remoteConvexKeys.flatMap((key) => ["-u", key]),
    ...Object.entries(isolated).map(([key, value]) => `${key}=${value}`),
    ...command,
  ];
}

function doppler(args: string[], input?: string) {
  return new Promise<{ code: number | null; output: string }>(
    (resolve, reject) => {
      const child = spawn("doppler", args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
      let output = "";
      child.stdout.on("data", (d) => (output += d));
      child.stderr.on("data", (d) => (output += d));
      child.once("error", (error: NodeJS.ErrnoException) =>
        reject(
          error.code === "ENOENT"
            ? new Error(
                "Doppler CLI not found. Install it and run `doppler login`.",
              )
            : error,
        ),
      );
      child.stdin.on("error", () => {});
      child.stdin.end(input);
      child.once("exit", (code) => resolve({ code, output }));
    },
  );
}

async function must(args: string[], what: string, input?: string) {
  const { code } = await doppler(args, input);
  // Doppler output can echo values; report only what failed.
  if (code !== 0)
    throw new Error(
      `Doppler ${what} failed (exit ${code}). Run \`doppler login\` and check access to the project.`,
    );
}

// `configs get` fails both for a missing config and for a missing login; only
// the first may be treated as absent.
async function exists(record: StoreRecord) {
  const { code, output } = await doppler([
    "configs",
    "get",
    "--project",
    record.project,
    "--config",
    record.config,
    "--json",
  ]);
  if (code === 0) return true;
  if (/could not find|not found/i.test(output)) return false;
  throw new Error(
    `Doppler could not read config ${record.config} (exit ${code}). Run \`doppler login\` and check access to the project.`,
  );
}

/**
 * Creates the branch config if it does not exist, then writes `values`
 * (non-secret, via argv) and `secrets` (via stdin, one key per call).
 */
export async function writeBranch(
  record: StoreRecord,
  values: Record<string, string>,
  secrets: Record<string, string> = {},
) {
  assertOwnedBranch(record);
  const scope = ["--project", record.project, "--config", record.config];
  if (!(await exists(record)))
    await must(
      [
        "configs",
        "create",
        record.config,
        "--project",
        record.project,
        "--environment",
        record.root,
      ],
      `create config ${record.config}`,
    );
  if (Object.keys(values).length)
    await must(
      [
        "secrets",
        "set",
        ...scope,
        "--silent",
        ...Object.entries(values).map(([k, v]) => `${k}=${v}`),
      ],
      `set ${Object.keys(values).join(", ")} in ${record.config}`,
    );
  for (const [key, value] of Object.entries(secrets))
    await must(
      ["secrets", "set", key, ...scope, "--silent"],
      `set ${key} in ${record.config}`,
      value,
    );
}

/** Reads the branch config's resolved values (inherited ones included). */
export async function readBranch(
  record: StoreRecord,
): Promise<Record<string, string>> {
  assertOwnedBranch(record);
  const { code, output } = await doppler([
    "secrets",
    "download",
    "--no-file",
    "--format",
    "json",
    "--project",
    record.project,
    "--config",
    record.config,
  ]);
  if (code !== 0)
    throw new Error(
      `Doppler could not read config ${record.config} (exit ${code}).`,
    );
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    JSON.parse(output) as Record<string, unknown>,
  ))
    if (typeof value === "string") values[key] = value;
  return values;
}

/** Deletes the worktree's branch config. A config that is already gone is fine. */
export async function deleteBranch(record: StoreRecord) {
  assertOwnedBranch(record);
  const scope = ["--project", record.project, "--config", record.config];
  if (!(await exists(record))) return;
  await must(
    ["configs", "delete", ...scope, "--yes", "--silent"],
    `delete config ${record.config}`,
  );
}

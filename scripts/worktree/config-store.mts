// Opt-in storage for a worktree's own settings outside the checkout.
//
// Layout `"envFiles": false` stops the toolkit writing `.env.local` files: the
// frontend values are computed from `.worktree/local.json` and passed to the
// child processes. A profile's `configStore` additionally keeps those values,
// with the generated secrets, in a Doppler branch config named for the
// worktree, and runs the backend and frontend under `doppler run`. Only both
// together leave no `.env*` file at all: without a store, generated secrets
// stay in `.worktree/backend.env`.
//
// Values set from argv are ports, URLs and deployment names only. Generated
// secrets reach Doppler on stdin and are never printed.
import type { BackendState, ConfigStore, StoreRecord } from "./types.mts";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { root, backend, layout } from "./context.mts";
import { safe } from "./files.mts";

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const slug = /^[a-z0-9][a-z0-9_-]*$/;
// Doppler's staging and production configs. A worktree branches from one only
// when the profile says so explicitly.
const protectedConfig = /^(?:stg|prd|staging|prod|production)$/;

/** Fails unless `store` is a valid `configStore` declaration. */
export function validateStore(store: unknown, profile: string): ConfigStore {
  const fail = (reason = ""): never => {
    throw new Error(
      `Profile configuration: invalid configStore in ${profile}${reason}`,
    );
  };
  if (
    !object(store) ||
    Object.keys(store).some(
      (key) => !["kind", "project", "config", "allowProtected"].includes(key),
    )
  )
    fail();
  const { kind, project, config, allowProtected } = store as Record<
    string,
    unknown
  >;
  if (
    kind !== "doppler" ||
    typeof project !== "string" ||
    !slug.test(project) ||
    typeof config !== "string" ||
    !slug.test(config) ||
    config.includes("_") ||
    (allowProtected !== undefined && typeof allowProtected !== "boolean")
  )
    fail();
  if (protectedConfig.test(config as string) && allowProtected !== true)
    fail(
      `: ${config} is a staging or production config; set "allowProtected": true to branch from it`,
    );
  return {
    kind: "doppler",
    project: project as string,
    config: config as string,
    ...(allowProtected === true ? { allowProtected: true } : {}),
  };
}

/**
 * The branch config for one worktree: `<root>_wt_<checkout>_<id8>`. The
 * checkout name makes it readable in Doppler; the identity prefix keeps two
 * checkouts with the same directory name apart.
 */
export function branchName(store: ConfigStore, checkout: string, id: string) {
  const name = path
    .basename(checkout)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `${store.config}_wt_${name || "checkout"}_${id.replace(/-/g, "").slice(0, 8)}`;
}

/** A worktree's state: its identity and the branch config it recorded. */
type Owner = Pick<BackendState, "id" | "configStore">;

/**
 * The branch config of this checkout. Only the exact name this checkout and
 * identity produce can be written or deleted, so a copied or edited
 * `.worktree/local.json` cannot reach another worktree's config.
 */
export function ownedBranch(s: Owner): StoreRecord {
  const record = s.configStore;
  if (
    !record ||
    record.kind !== "doppler" ||
    !slug.test(record.project) ||
    !slug.test(record.root) ||
    record.config !==
      branchName(
        { kind: "doppler", project: record.project, config: record.root },
        root,
        s.id,
      )
  )
    throw new Error("Refusing a Doppler config this worktree did not create.");
  return record;
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

const readText = (file: string) =>
  fs.readFile(file, "utf8").catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });

/**
 * With `envFiles: false`, removes the backend `.env.local` when it holds only
 * what the Convex CLI writes there, and the `.gitignore` it creates for it. A
 * file with any other key, or a tracked or edited `.gitignore`, is left alone.
 */
export async function removeConvexEnvFile() {
  if (layout.envFiles !== false) return;
  const file = path.join(backend, ".env.local");
  await safe(file);
  const content = await readText(file);
  if (content !== null) {
    const keys = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map(
        (line) => /^(?:export\s+)?([A-Za-z0-9_]+)\s*=/.exec(line)?.[1] ?? "",
      );
    if (keys.every((key) => convexWritten.test(key)))
      await fs.rm(file, { force: true });
  }
  await removeConvexGitignore();
}

// When it writes `.env.local` and finds no `.gitignore` beside it, the Convex
// CLI creates one that ignores only that file.
async function removeConvexGitignore() {
  const file = path.join(backend, ".gitignore");
  await safe(file);
  const content = await readText(file);
  if (content === null || content.trim() !== ".env.local") return;
  // A committed `.gitignore` is the project's own, whatever it holds.
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", file], {
    cwd: backend,
    stdio: "ignore",
  });
  if (tracked.status !== 0) await fs.rm(file, { force: true });
}

// Strips every Convex key Doppler injects, as `childEnv` does for the parent
// environment, except those the branch config sets for this worktree; then
// restores the isolated values and replaces itself with the command.
const stripConvex = (keep: string[]) =>
  `for key in $(env | sed -n 's/^\\(\\(NEXT_PUBLIC_\\)\\{0,1\\}CONVEX_[A-Za-z0-9_]*\\)=.*/\\1/p'); do ` +
  `case " ${keep.join(" ")} " in *" $key "*) ;; *) unset "$key" ;; esac; done; ` +
  `exec env "$@"`;

/**
 * Wraps `command` in `doppler run` for the worktree's branch config. Doppler
 * runs with the developer's real HOME (its login lives there) and writes no
 * fallback copy of the secrets to disk. `isolated` values then take precedence
 * over anything Doppler injects.
 */
export function wrap(
  s: BackendState,
  command: string[],
  isolated: Record<string, string>,
) {
  if (!s.configStore) return command;
  const record = ownedBranch(s);
  const keep = Object.keys(frontendValues(s)).filter((key) =>
    /^(?:NEXT_PUBLIC_)?CONVEX_/.test(key),
  );
  return [
    "doppler",
    "run",
    "--no-fallback",
    "--project",
    record.project,
    "--config",
    record.config,
    "--",
    "sh",
    "-c",
    stripConvex(keep),
    "sh",
    ...Object.entries(isolated).map(([key, value]) => `${key}=${value}`),
    ...command,
  ];
}

function doppler(args: string[], input?: string) {
  return new Promise<{ code: number | null; stdout: string; output: string }>(
    (resolve, reject) => {
      const child = spawn("doppler", args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
      let stdout = "",
        output = "";
      child.stdout.on("data", (d) => {
        stdout += d;
        output += d;
      });
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
      child.once("exit", (code) => resolve({ code, stdout, output }));
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
async function exists(project: string, config: string) {
  const { code, output } = await doppler([
    "configs",
    "get",
    "--project",
    project,
    "--config",
    config,
    "--json",
  ]);
  if (code === 0) return true;
  if (/could not find|not found/i.test(output)) return false;
  throw new Error(
    `Doppler could not read config ${config} (exit ${code}). Run \`doppler login\` and check access to the project.`,
  );
}

// Resolved values of a config. Only stdout is parsed, so a notice on stderr
// cannot break it, and a parse failure never quotes what it read.
async function download(project: string, config: string) {
  const { code, stdout } = await doppler([
    "secrets",
    "download",
    "--no-file",
    "--format",
    "json",
    "--project",
    project,
    "--config",
    config,
  ]);
  if (code !== 0)
    throw new Error(
      `Doppler could not read config ${config} (exit ${code}). Run \`doppler login\` and check access to the project.`,
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`Doppler returned unreadable values for ${config}.`);
  }
  if (!object(parsed))
    throw new Error(`Doppler returned unreadable values for ${config}.`);
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed))
    if (typeof value === "string") values[key] = value;
  return values;
}

/**
 * Creates the branch config if it does not exist, then writes `values`
 * (non-secret, via argv) and `secrets` (via stdin, one key per call).
 */
export async function writeBranch(
  s: Owner,
  values: Record<string, string>,
  secrets: Record<string, string> = {},
) {
  const record = ownedBranch(s);
  const scope = ["--project", record.project, "--config", record.config];
  if (!(await exists(record.project, record.config)))
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
export async function readBranch(s: Owner): Promise<Record<string, string>> {
  const record = ownedBranch(s);
  return await download(record.project, record.config);
}

/**
 * Of `keys`, those the branch config does not hold as its own: absent, or
 * only inherited from its root. All of them when the config does not exist.
 */
export async function missingSecrets(s: Owner, keys: string[]) {
  const record = ownedBranch(s);
  if (!keys.length) return [];
  if (!(await exists(record.project, record.config))) return keys;
  const branch = await download(record.project, record.config);
  const inherited = await download(record.project, record.root);
  return keys.filter((key) => !branch[key] || branch[key] === inherited[key]);
}

/** Deletes the worktree's branch config. A config that is already gone is fine. */
export async function deleteBranch(s: Owner) {
  const record = ownedBranch(s);
  if (!(await exists(record.project, record.config))) return;
  await must(
    [
      "configs",
      "delete",
      "--project",
      record.project,
      "--config",
      record.config,
      "--yes",
      "--silent",
    ],
    `delete config ${record.config}`,
  );
}

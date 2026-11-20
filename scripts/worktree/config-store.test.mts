// TDV-34: a worktree's settings live in its own Doppler branch config and the
// toolkit writes no `.env*` file. A fake `doppler` on PATH stands in for the
// CLI, so these tests never reach the network.
import type { TestContext } from "node:test";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./cli.mts", import.meta.url));

// Values in a config are the branch's own over its root's, like Doppler's
// inheritance. `run` forwards SIGINT/SIGTERM as the real CLI does. Every
// command prints a notice on stderr, as the real CLI does when an update is out.
const fakeDoppler = String.raw`#!/usr/bin/env node
const fs = require("node:fs"), { spawn } = require("node:child_process");
const file = process.env.FAKE_DOPPLER_STORE, log = process.env.FAKE_DOPPLER_LOG;
const argv = process.argv.slice(2);
const store = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { configs: {} };
const save = () => fs.writeFileSync(file, JSON.stringify(store));
const flag = (name) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const dash = argv.indexOf("--");
const own = dash < 0 ? argv : argv.slice(0, dash);
fs.appendFileSync(log, JSON.stringify({ argv: own, home: process.env.HOME }) + "\n");
if (process.env.FAKE_DOPPLER_LOGGED_OUT) { console.error("Doppler Error: you must provide a token"); process.exit(1); }
console.error("Doppler CLI notice: a newer version is available");
const name = flag("--config");
const missing = () => { console.error("Doppler Error: Could not find requested config '" + name + "'"); process.exit(1); };
const resolved = (n) => { const c = store.configs[n]; return c.inherits ? { ...store.configs[c.inherits].values, ...c.values } : { ...c.values }; };
const [group, verb] = argv;
if (group === "configs" && verb === "get") { if (!store.configs[name]) missing(); console.log("{}"); }
else if (group === "configs" && verb === "create") {
  const env = flag("--environment"); if (!store.configs[env]) process.exit(3);
  store.configs[argv[2]] = { inherits: env, values: {} }; save();
} else if (group === "configs" && verb === "delete") { if (!store.configs[name]) missing(); delete store.configs[name]; save(); }
else if (group === "secrets" && verb === "set") {
  if (!store.configs[name]) missing();
  const pairs = own.slice(2).filter((a, i, all) => !a.startsWith("-") && !["--project", "--config"].includes(all[i - 1]));
  if (pairs.length === 1 && !pairs[0].includes("=")) store.configs[name].values[pairs[0]] = fs.readFileSync(0, "utf8");
  else for (const pair of pairs) { const at = pair.indexOf("="); store.configs[name].values[pair.slice(0, at)] = pair.slice(at + 1); }
  save();
} else if (group === "secrets" && verb === "download") { if (!store.configs[name]) missing(); console.log(JSON.stringify(resolved(name))); }
else if (group === "run") {
  if (!store.configs[name]) missing();
  const child = spawn(argv[dash + 1], argv.slice(dash + 2), { stdio: "inherit", env: { ...process.env, ...resolved(name) } });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
} else process.exit(2);
`;

// Convex: like the real CLI, every \`dev\` writes .env.local in the backend
// directory, and a .gitignore for it when there is none. Bootstrap writes the
// local config, \`env set\` copies the import file, and a long-running \`dev\`
// records its environment and reports ready.
const fakeConvex = String.raw`
const fs = require("node:fs"), path = require("node:path"), args = process.argv.slice(2);
const seen = (name) => fs.writeFileSync(name, JSON.stringify(process.env));
if (args[0] === "dev") {
  const kept = fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l && !/CONVEX|convex dev/.test(l)) : [];
  fs.writeFileSync(".env.local", [...kept, "# Deployment used by \x60npx convex dev\x60", "CONVEX_DEPLOYMENT=anonymous:anonymous-x # team: anonymous", "", "CONVEX_URL=http://127.0.0.1:1", "NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:2", ""].join("\n"));
  if (!fs.existsSync(".gitignore")) fs.writeFileSync(".gitignore", "\n.env.local\n");
}
if (args[0] === "env") fs.copyFileSync(args[args.indexOf("--from-file") + 1], "imported");
else if (!fs.existsSync(".convex/local/default/config.json")) {
  fs.mkdirSync(".convex/local/default", { recursive: true });
  fs.writeFileSync(".convex/local/default/config.json", JSON.stringify({ deploymentName: "anonymous-" + path.basename(process.cwd()),
    ports: { cloud: Number(args[args.indexOf("--local-cloud-port") + 1]), site: Number(args[args.indexOf("--local-site-port") + 1]) } }));
} else if (!args.includes("--once")) { seen("convex-env.json"); console.log("Convex functions ready"); setInterval(() => {}, 1000); }
`;
const fakeNext = String.raw`require("node:fs").writeFileSync("next-env.json", JSON.stringify({ ...process.env, argv: process.argv.slice(2) })); setInterval(() => {}, 1000);`;

const layout = (store?: object) => ({
  env: {
    EMAIL_DELIVERY_MODE: "dry-run",
    STRIPE_SECRET_KEY: "sk_test_placeholder",
  },
  secretEnv: ["BETTER_AUTH_SECRET"],
  siteUrlEnv: ["SITE_URL"],
  envFiles: false,
  profiles: { doppler: { ...(store ? { configStore: store } : {}) } },
});
const dopplerStore = {
  kind: "doppler",
  project: "example-app",
  config: "dev",
};

async function fixture(t: TestContext) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "worktree-store-")));
  // Hooks run in reverse order: stop any started worktree before removing it.
  const started: string[] = [];
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.after(async () => {
    for (const root of started) await run(root, ["stop"]);
  });
  const bin = join(dir, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "doppler"), fakeDoppler);
  await chmod(join(bin, "doppler"), 0o755);
  const storeFile = join(dir, "doppler.json"),
    log = join(dir, "doppler.log");
  // The shared dev config, as a developer's Doppler login would see it.
  await writeFile(
    storeFile,
    JSON.stringify({
      configs: {
        dev: {
          values: {
            STRIPE_SECRET_KEY: "sk_test_from_dev",
            CONVEX_DEPLOY_KEY: "never-reaches-a-child",
            CONVEX_ADMIN_KEY: "never-reaches-a-child",
            NEXT_PUBLIC_CONVEX_EXTRA: "never-reaches-a-child",
          },
        },
      },
    }),
  );
  await writeFile(log, "");
  const env = (extra: Record<string, string> = {}) => ({
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    WORKTREE_REGISTRY_DIR: join(dir, "registry"),
    FAKE_DOPPLER_STORE: storeFile,
    FAKE_DOPPLER_LOG: log,
    ...extra,
  });
  async function run(
    root: string,
    args: string[],
    extra: Record<string, string> = {},
  ) {
    return await new Promise<{ code: number | null; output: string }>(
      (resolve) => {
        const child = spawn(process.execPath, [script, ...args], {
          cwd: root,
          env: env(extra),
        });
        let output = "";
        child.stdout.on("data", (d) => (output += d));
        child.stderr.on("data", (d) => (output += d));
        child.on("error", (error) =>
          resolve({ code: -1, output: error.message }),
        );
        child.on("exit", (code) => resolve({ code, output }));
      },
    );
  }
  async function root(name: string, config: object, fakes = false) {
    const path = join(dir, name);
    await mkdir(join(path, "scripts"), { recursive: true });
    await writeFile(join(path, "convex.json"), "{}");
    await writeFile(
      join(path, "scripts/worktree.config.json"),
      JSON.stringify(config),
    );
    if (fakes)
      for (const [pkg, source] of [
        ["convex", fakeConvex],
        ["next", fakeNext],
      ]) {
        await mkdir(join(path, "node_modules", pkg), { recursive: true });
        await writeFile(
          join(path, "node_modules", pkg, "package.json"),
          JSON.stringify({ name: pkg, bin: { [pkg]: "cli.cjs" } }),
        );
        await writeFile(join(path, "node_modules", pkg, "cli.cjs"), source);
      }
    return path;
  }
  const doppler = async () =>
    JSON.parse(await readFile(storeFile, "utf8")).configs as Record<
      string,
      { inherits?: string; values: Record<string, string> }
    >;
  const calls = async () =>
    (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { argv: string[]; home: string });
  const state = async (root: string) =>
    JSON.parse(await readFile(join(root, ".worktree/local.json"), "utf8"));
  const start = (root: string) => {
    started.push(root);
    return run(root, ["start", "--frontend"]);
  };
  return { dir, run, root, doppler, calls, state, start };
}

/** Every `.env*` file in the checkout, outside node_modules. */
async function envFiles(root: string) {
  const entries = await readdir(root, { recursive: true });
  return entries.filter(
    (entry) => !entry.startsWith("node_modules") && /(^|\/)\.env/.test(entry),
  );
}

test("setup keeps the worktree's ports, URLs and secret in its own branch config of dev", async (t) => {
  const f = await fixture(t),
    a = await f.root("tdv-12", layout(dopplerStore));
  const result = await f.run(a, [
    "setup",
    "--prepare-only",
    "--profile",
    "doppler",
  ]);
  assert.equal(result.code, 0, result.output);
  const s = await f.state(a);
  const name = `dev_wt_tdv_12_${s.id.replace(/-/g, "").slice(0, 8)}`;
  assert.deepEqual(s.configStore, {
    kind: "doppler",
    project: "example-app",
    root: "dev",
    config: name,
    seeded: true,
  });
  const configs = await f.doppler();
  assert.equal(configs[name].inherits, "dev");
  const values = configs[name].values;
  assert.equal(values.NEXT_PUBLIC_SITE_URL, `http://localhost:${s.ports.web}`);
  assert.equal(
    values.NEXT_PUBLIC_CONVEX_URL,
    `http://127.0.0.1:${s.ports.cloud}`,
  );
  assert.equal(
    values.NEXT_PUBLIC_CONVEX_SITE_URL,
    `http://127.0.0.1:${s.ports.site}`,
  );
  assert.equal(values.PORT, String(s.ports.web));
  assert.equal(values.SITE_URL, `http://localhost:${s.ports.web}`);
  assert.equal(values.CONVEX_DEPLOYMENT, "anonymous:anonymous-tdv-12");
  assert.match(values.BETTER_AUTH_SECRET, /^[0-9a-f]{64}$/);
  assert.deepEqual(configs.dev.values, {
    STRIPE_SECRET_KEY: "sk_test_from_dev",
    CONVEX_DEPLOY_KEY: "never-reaches-a-child",
    CONVEX_ADMIN_KEY: "never-reaches-a-child",
    NEXT_PUBLIC_CONVEX_EXTRA: "never-reaches-a-child",
  });
  // The secret went over stdin, never argv or output.
  const argv = (await f.calls()).flatMap((call) => call.argv).join(" ");
  assert.doesNotMatch(argv, new RegExp(values.BETTER_AUTH_SECRET));
  assert.doesNotMatch(result.output, new RegExp(values.BETTER_AUTH_SECRET));
  assert.deepEqual(await envFiles(a), []);

  // A rerun reuses the config and keeps its secret.
  assert.equal(
    (await f.run(a, ["setup", "--prepare-only", "--profile", "doppler"])).code,
    0,
  );
  assert.equal(
    (await f.doppler())[name].values.BETTER_AUTH_SECRET,
    values.BETTER_AUTH_SECRET,
  );
  assert.equal(
    (await f.calls()).filter((call) => call.argv[1] === "create").length,
    1,
  );
});

test("setup imports the backend values from the branch config and leaves no import file", async (t) => {
  const f = await fixture(t),
    a = await f.root("import", layout(dopplerStore), true);
  const result = await f.run(a, ["setup", "--profile", "doppler"]);
  assert.equal(result.code, 0, result.output);
  const s = await f.state(a);
  const values = (await f.doppler())[s.configStore.config].values;
  const imported = await readFile(join(a, "imported"), "utf8");
  assert.match(
    imported,
    new RegExp(`^BETTER_AUTH_SECRET=${values.BETTER_AUTH_SECRET}$`, "m"),
  );
  assert.match(
    imported,
    new RegExp(`^SITE_URL=http://localhost:${s.ports.web}$`, "m"),
  );
  // Doppler's value replaces the placeholder default; layout defaults remain.
  assert.match(imported, /^STRIPE_SECRET_KEY=sk_test_from_dev$/m);
  assert.match(imported, /^EMAIL_DELIVERY_MODE=dry-run$/m);
  await assert.rejects(readFile(join(a, ".worktree/backend.env")), {
    code: "ENOENT",
  });
  assert.equal(values.CONVEX_DEPLOYMENT, `anonymous:${s.deployment}`);
  assert.deepEqual(await envFiles(a), []);
});

test("start runs Convex and Next.js under doppler run with the worktree's branch config", async (t) => {
  const f = await fixture(t),
    a = await f.root("serve", layout(dopplerStore), true);
  assert.equal((await f.run(a, ["setup", "--profile", "doppler"])).code, 0);
  const s = await f.state(a);
  const started = await f.start(a);
  assert.equal(started.code, 0, started.output);
  for (let n = 0; n < 100; n++) {
    if ((await readdir(a)).includes("next-env.json")) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const runs = (await f.calls()).filter((call) => call.argv[0] === "run");
  assert.equal(runs.length, 2);
  for (const call of runs) {
    assert.deepEqual(call.argv, [
      "run",
      "--no-fallback",
      "--project",
      "example-app",
      "--config",
      s.configStore.config,
    ]);
    // Doppler reads the developer's own login.
    assert.equal(call.home, process.env.HOME);
  }
  const next = JSON.parse(await readFile(join(a, "next-env.json"), "utf8"));
  const convex = JSON.parse(await readFile(join(a, "convex-env.json"), "utf8"));
  assert.deepEqual(next.argv, ["dev", "--port", String(s.ports.web)]);
  assert.equal(
    next.NEXT_PUBLIC_CONVEX_URL,
    `http://127.0.0.1:${s.ports.cloud}`,
  );
  assert.equal(next.NEXT_PUBLIC_SITE_URL, `http://localhost:${s.ports.web}`);
  assert.equal(next.STRIPE_SECRET_KEY, "sk_test_from_dev");
  for (const env of [next, convex]) {
    assert.equal(env.HOME, join(a, ".worktree/home"));
    assert.equal(env.CONVEX_AGENT_MODE, "anonymous");
    assert.equal(env.CONVEX_DEPLOYMENT, `anonymous:${s.deployment}`);
    // Every Convex key Doppler injects is stripped, not only named ones.
    assert.equal(env.CONVEX_DEPLOY_KEY, undefined);
    assert.equal(env.CONVEX_ADMIN_KEY, undefined);
    assert.equal(env.NEXT_PUBLIC_CONVEX_EXTRA, undefined);
  }
  assert.equal((await f.run(a, ["stop"])).code, 0);
  assert.deepEqual(await envFiles(a), []);
});

test("teardown keeps the branch config; cleanup deletes only this worktree's", async (t) => {
  const f = await fixture(t);
  const a = await f.root("a", layout(dopplerStore)),
    b = await f.root("b", layout(dopplerStore));
  for (const root of [a, b])
    assert.equal(
      (await f.run(root, ["setup", "--prepare-only", "--profile", "doppler"]))
        .code,
      0,
    );
  const [sa, sb] = [await f.state(a), await f.state(b)];
  assert.notEqual(sa.configStore.config, sb.configStore.config);
  assert.equal((await f.run(a, ["teardown"])).code, 0);
  assert.ok((await f.doppler())[sa.configStore.config]);
  assert.deepEqual(await envFiles(a), []);
  const cleaned = await f.run(a, ["cleanup", "--yes"]);
  assert.equal(cleaned.code, 0, cleaned.output);
  const configs = await f.doppler();
  assert.deepEqual(
    Object.keys(configs).sort(),
    ["dev", sb.configStore.config].sort(),
  );
  assert.equal(
    configs[sb.configStore.config].values.PORT,
    String(sb.ports.web),
  );
  await assert.rejects(readFile(join(a, ".worktree/local.json")), {
    code: "ENOENT",
  });
});

test("cleanup refuses to delete a config the worktree did not create", async (t) => {
  const f = await fixture(t),
    a = await f.root("guard", layout(dopplerStore));
  assert.equal(
    (await f.run(a, ["setup", "--prepare-only", "--profile", "doppler"])).code,
    0,
  );
  const s = await f.state(a);
  // The root config, and a sibling worktree's config whose name has the same
  // shape, as a copied or edited local.json would record.
  const sibling = "dev_wt_other_checkout_deadbeef";
  const store = join(f.dir, "doppler.json");
  const data = JSON.parse(await readFile(store, "utf8"));
  data.configs[sibling] = { inherits: "dev", values: { PORT: "1" } };
  await writeFile(store, JSON.stringify(data));
  for (const config of ["dev", sibling]) {
    s.configStore.config = config;
    await writeFile(join(a, ".worktree/local.json"), JSON.stringify(s));
    const result = await f.run(a, ["cleanup", "--yes"]);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /did not create/);
  }
  const configs = await f.doppler();
  assert.ok(configs.dev);
  assert.ok(configs[sibling]);
  assert.ok(!(await f.calls()).some((call) => call.argv[1] === "delete"));
});

test("a rerun replaces a missing secret and drops a leftover import file", async (t) => {
  const f = await fixture(t),
    a = await f.root("rerun", layout(dopplerStore));
  const prepare = () =>
    f.run(a, ["setup", "--prepare-only", "--profile", "doppler"]);
  assert.equal((await prepare()).code, 0);
  const s = await f.state(a);
  // The branch loses its own secret while the root has one to inherit, and
  // an interrupted import left its file behind.
  const store = join(f.dir, "doppler.json");
  const data = JSON.parse(await readFile(store, "utf8"));
  delete data.configs[s.configStore.config].values.BETTER_AUTH_SECRET;
  data.configs.dev.values.BETTER_AUTH_SECRET = "inherited-from-dev";
  await writeFile(store, JSON.stringify(data));
  await writeFile(
    join(a, ".worktree/backend.env"),
    "BETTER_AUTH_SECRET=leftover\n",
  );
  const result = await prepare();
  assert.equal(result.code, 0, result.output);
  const own = (await f.doppler())[s.configStore.config].values;
  assert.match(own.BETTER_AUTH_SECRET, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(
    await readFile(join(a, ".worktree/backend.env"), "utf8"),
    /leftover/,
  );
});

test("a staging or production config needs an explicit opt-in", async (t) => {
  const f = await fixture(t);
  for (const config of ["prd", "stg"]) {
    const a = await f.root(config, layout({ ...dopplerStore, config }));
    const result = await f.run(a, [
      "setup",
      "--prepare-only",
      "--profile",
      "doppler",
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /allowProtected/);
  }
  const a = await f.root(
    "opted-in",
    layout({ ...dopplerStore, config: "prd", allowProtected: true }),
  );
  const result = await f.run(a, [
    "setup",
    "--prepare-only",
    "--profile",
    "doppler",
  ]);
  assert.doesNotMatch(result.output, /invalid configStore/);
});

test("a missing Doppler login stops setup without printing values", async (t) => {
  const f = await fixture(t),
    a = await f.root("logged-out", layout(dopplerStore));
  const result = await f.run(
    a,
    ["setup", "--prepare-only", "--profile", "doppler"],
    { FAKE_DOPPLER_LOGGED_OUT: "1" },
  );
  assert.notEqual(result.code, 0);
  assert.match(result.output, /doppler login/);
  assert.doesNotMatch(result.output, /[0-9a-f]{64}/);
  assert.deepEqual(await envFiles(a), []);
});

test("setup without a store writes no .env file and hands values to processes directly", async (t) => {
  const f = await fixture(t),
    a = await f.root("no-doppler", layout(), true);
  const result = await f.run(a, ["setup"]);
  assert.equal(result.code, 0, result.output);
  const s = await f.state(a);
  assert.equal(s.configStore, undefined);
  assert.deepEqual(await f.calls(), []);
  const env = await f.run(a, ["env"]);
  assert.equal(env.code, 0, env.output);
  assert.deepEqual(JSON.parse(env.output), {
    CONVEX_DEPLOYMENT: `anonymous:${s.deployment}`,
    NEXT_PUBLIC_CONVEX_URL: `http://127.0.0.1:${s.ports.cloud}`,
    NEXT_PUBLIC_CONVEX_SITE_URL: `http://127.0.0.1:${s.ports.site}`,
    NEXT_PUBLIC_SITE_URL: `http://localhost:${s.ports.web}`,
    PORT: String(s.ports.web),
  });
  assert.equal((await f.start(a)).code, 0);
  for (let n = 0; n < 100; n++) {
    if ((await readdir(a)).includes("next-env.json")) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const next = JSON.parse(await readFile(join(a, "next-env.json"), "utf8"));
  assert.equal(
    next.NEXT_PUBLIC_CONVEX_URL,
    `http://127.0.0.1:${s.ports.cloud}`,
  );
  assert.equal((await f.run(a, ["stop"])).code, 0);
  assert.equal((await f.run(a, ["teardown"])).code, 0);
  assert.deepEqual(await envFiles(a), []);
  assert.ok(!(await readdir(a)).includes(".gitignore"));
});

test("a backend .env.local with keys of its own is left alone", async (t) => {
  const f = await fixture(t),
    a = await f.root("own-file", layout(), true);
  await writeFile(join(a, ".env.local"), "CUSTOM=keep\n");
  assert.equal((await f.run(a, ["setup"])).code, 0);
  assert.match(await readFile(join(a, ".env.local"), "utf8"), /^CUSTOM=keep$/m);
});

test("a .gitignore the project wrote is left alone", async (t) => {
  const f = await fixture(t),
    a = await f.root("own-ignore", layout(), true);
  await writeFile(join(a, ".gitignore"), "node_modules\n.env.local\n");
  assert.equal((await f.run(a, ["setup"])).code, 0);
  assert.equal(
    await readFile(join(a, ".gitignore"), "utf8"),
    "node_modules\n.env.local\n",
  );
});

test("setup refuses an invalid configStore and a store change", async (t) => {
  const f = await fixture(t);
  const bad = await f.root(
    "bad",
    layout({ ...dopplerStore, config: "dev_personal" }),
  );
  assert.match(
    (await f.run(bad, ["setup", "--prepare-only"])).output,
    /invalid configStore in doppler/,
  );
  const a = await f.root("change", layout(dopplerStore));
  assert.equal(
    (await f.run(a, ["setup", "--prepare-only", "--profile", "doppler"])).code,
    0,
  );
  const result = await f.run(a, ["setup", "--prepare-only"]);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /keeps its settings in Doppler/);
});

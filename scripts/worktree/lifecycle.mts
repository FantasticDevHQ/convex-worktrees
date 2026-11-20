import type { BackendState, BackendConfig, Layout } from "./types.mts";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";

import path from "node:path";

import { randomUUID, randomBytes } from "node:crypto";

import {
  root,
  backend,
  frontendEnv,
  dir,
  stateFile,
  configFile,
  read,
  layout,
} from "./context.mts";
import { safe, json, upsert } from "./files.mts";
import { locked, projectLock, available } from "./registry.mts";
import {
  state,
  checkConfig,
  cli,
  convexArgs,
  assertBootstrapIsolation,
} from "./config.mts";
import { serviceStatus } from "./services.mts";
import { run, ownedRunning, stopOnly } from "./processes.mts";
import { refreshCheckout } from "./freshness.mts";

import { validateProfiles, runHooks } from "./hooks.mts";
import { branchName, frontendValues, writeBranch, readBranch, missingSecrets, deleteBranch } from "./config-store.mts";

export async function setup(prepareOnly: boolean) {
  const profile = validateProfiles();
  await refreshCheckout(root);
  if (layout.convex === false) {
    await safe(dir);
    await safe(stateFile);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    if (existsSync(stateFile)) {
      const existing = await state();
      if (existing.serviceProfile && await ownedRunning(existing)) throw new Error("Services already running. Stop them before setup.");
    }
    else await json(stateFile, { version: 1, root, id: randomUUID(), mode: "none" });
    await runHooks(profile, "afterPrepare", await state());
    console.log("Worktree ready; no backend or frontend services configured.");
    return;
  }
  if (!existsSync(path.join(backend, "convex.json")))
    throw new Error("Run from the Convex project directory.");
  await safe(dir);
  await safe(configFile);
  await safe(frontendEnv);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(dir, "home"), { recursive: true, mode: 0o700 });
  let s = await read<BackendState | null>(stateFile, null);
  if (!s && existsSync(configFile))
    throw new Error(
      "Refusing unmanaged local backend state. Use a fresh checkout.",
    );
  if (s) {
    s = await state() as BackendState;
    await checkConfig(s);
  }
  const store = profile?.configStore;
  if (s?.configStore && (!store || store.project !== s.configStore.project || store.config !== s.configStore.root))
    throw new Error(`This worktree keeps its settings in Doppler ${s.configStore.project}/${s.configStore.config}. Run setup with the profile that declares it, or cleanup --yes first.`);
  if (store) {
    // The import file holds secrets only while an import runs; drop any copy
    // an interrupted setup left behind.
    await safe(path.join(dir, "backend.env"));
    await fs.rm(path.join(dir, "backend.env"), { force: true });
  }
  // Serialize both per-checkout preparation and cross-repository allocations.
  s = await locked(async (leases) => {
    const existing = await read<BackendState | null>(stateFile, null);
    if (existing) s = existing;
    if (await ownedRunning(s))
      throw new Error("Backend already running. Stop it before setup.");
    if (s) {
      for (const port of Object.values(s.ports)) {
        const other = Object.entries(leases).find(
          ([p, v]) => p !== root && Object.values(v.ports).includes(port),
        );
        if (other || !(await available(port)))
          throw new Error(
            `Reserved port ${port} is busy; stop its owner or explicitly cleanup/reconfigure.`,
          );
      }
    } else {
      const used = new Set(
        Object.values(leases).flatMap((v) => Object.values(v.ports)),
      );
      const ports = [];
      for (let port = 18000; port < 48000 && ports.length < 3; port++) {
        if (!used.has(port) && (await available(port))) ports.push(port);
      }
      if (ports.length !== 3) throw new Error("No free worktree ports.");
      s = {
        version: 1,
        root,
        id: randomUUID(),
        ports: { web: ports[0], cloud: ports[1], site: ports[2] },
        deployment: null,
      };
      await json(stateFile, s);
    }
    // Record the branch config before creating it, so cleanup can find it.
    if (store && !s.configStore) {
      s.configStore = { kind: store.kind, project: store.project, root: store.config, config: branchName(store, root, s.id) };
      await json(stateFile, s);
    }
    leases[root] = { id: s.id, ports: s.ports };
    const cloud = `http://127.0.0.1:${s.ports.cloud}`,
      site = `http://127.0.0.1:${s.ports.site}`;
    const selection = `anonymous:${s.deployment || `anonymous-${path.basename(backend)}`}`;
    await upsert(path.join(dir, "convex.env"), {
      CONVEX_DEPLOYMENT: selection,
    });
    if (layout.envFiles !== false) {
    await upsert(
      frontendEnv,
      {
        CONVEX_DEPLOYMENT: selection,
        NEXT_PUBLIC_CONVEX_URL: cloud,
        NEXT_PUBLIC_CONVEX_SITE_URL: site,
        NEXT_PUBLIC_SITE_URL: `http://localhost:${s.ports.web}`,
        PORT: s.ports.web,
      },
      [
        "CONVEX_DEPLOY_KEY",
        "CONVEX_DEPLOYMENT_TOKEN",
        "CONVEX_SELF_HOSTED_URL",
        "CONVEX_SELF_HOSTED_ADMIN_KEY",
        "CONVEX_AGENT_MODE",
        "CONVEX_URL",
        "CONVEX_SITE_URL",
      ],
    );
    await upsert(
      path.join(backend, ".env.local"),
      { CONVEX_DEPLOYMENT: selection },
      [
        "CONVEX_DEPLOY_KEY",
        "CONVEX_DEPLOYMENT_TOKEN",
        "CONVEX_SELF_HOSTED_URL",
        "CONVEX_SELF_HOSTED_ADMIN_KEY",
      ],
    );
    }
    const backendEnv = path.join(dir, "backend.env");
    await safe(backendEnv);
    if (!existsSync(backendEnv)) {
      const config = await read<Layout>(
        path.join(root, "scripts/worktree.config.json"),
        {},
      );
      const values = { ...config.env };
      // With a config store the generated secrets and site URLs live in the
      // branch config; they are added to the import file just before import.
      if (!s.configStore) {
      for (const key of config.secretEnv || [])
        values[key] = randomBytes(32).toString("hex");
      for (const key of config.siteUrlEnv || [])
        values[key] = `http://localhost:${s.ports.web}`;
      }
      await upsert(backendEnv, values);
    }
    return s;
  });
  if (!s) throw new Error("Worktree allocation did not return state.");
  const prepared = s;
  if (prepared.configStore) {
    const siteUrls = Object.fromEntries((layout.siteUrlEnv || []).map((key) => [key, `http://localhost:${prepared.ports.web}`]));
    // Generate each secret the branch does not hold as its own, so a removed
    // secret is replaced rather than silently inherited from the root config.
    const generate = prepared.configStore.seeded ? await missingSecrets(prepared, layout.secretEnv || []) : layout.secretEnv || [];
    await writeBranch(prepared, { ...frontendValues(prepared), ...siteUrls }, Object.fromEntries(generate.map((key) => [key, randomBytes(32).toString("hex")])));
    prepared.configStore.seeded = true;
    await json(stateFile, prepared);
  }
  await runHooks(profile, "afterPrepare", prepared);
  if (!prepareOnly)
    await projectLock(async () => {
      // First run uses the documented non-TTY anonymous flow, which generates a unique
      // name rather than the agent-mode constant that can select legacy HOME state.
      if (!prepared.deployment) {
        await assertBootstrapIsolation(backend);
        await run(convexArgs(prepared, ["--once"]), prepared, {
          bootstrap: true,
        });
        const config = await read<BackendConfig | null>(configFile, null);
        if (
          !config?.deploymentName?.startsWith("anonymous-") ||
          config.ports?.cloud !== prepared.ports.cloud ||
          config.ports?.site !== prepared.ports.site
        ) {
          throw new Error(
            "Bootstrap did not create an isolated anonymous backend at the requested ports.",
          );
        }
        prepared.deployment = config.deploymentName;
        await json(stateFile, prepared);
        await upsert(path.join(dir, "convex.env"), {
          CONVEX_DEPLOYMENT: `anonymous:${prepared.deployment}`,
        });
        if (layout.envFiles !== false) {
        await upsert(frontendEnv, {
          CONVEX_DEPLOYMENT: `anonymous:${prepared.deployment}`,
        });
        }
        if (prepared.configStore)
          await writeBranch(prepared, { CONVEX_DEPLOYMENT: `anonymous:${prepared.deployment}` });
      }
      await checkConfig(prepared, true);
      if (prepared.configStore) {
        // The worktree's own keys come from its branch config, over defaults.
        const stored = await readBranch(prepared);
        const keys = [...(layout.secretEnv || []), ...(layout.siteUrlEnv || []), ...Object.keys(layout.env || {})];
        await safe(path.join(dir, "backend.env"));
        await upsert(path.join(dir, "backend.env"), Object.fromEntries(keys.filter((key) => stored[key]).map((key) => [key, stored[key]])));
      }
      await runHooks(profile, "beforeImport", prepared);
      await safe(path.join(dir, "backend.env"));
      try {
      await run(
        [
          cli(),
          "env",
          "set",
          "--env-file",
          path.join(dir, "convex.env"),
          "--from-file",
          path.join(dir, "backend.env"),
        ],
        prepared,
      );
      } finally {
        // Doppler holds these values; the import file exists only for the import.
        if (prepared.configStore) await fs.rm(path.join(dir, "backend.env"), { force: true });
      }
      await run(convexArgs(prepared, ["--once"]), prepared);
      await checkConfig(prepared, true);
      await runHooks(profile, "afterPush", prepared);
    }, "shared-convex-cache");
  console.log(
    `Worktree ${prepareOnly ? "prepared" : "ready"}: web=${prepared.ports.web} convex=${prepared.ports.cloud} site=${prepared.ports.site}`,
  );
}

export async function teardown(cleanup = false) {
  if (!existsSync(stateFile)) {
    console.log("No managed worktree state.");
    return;
  }
  const s = await state();
  if (cleanup && !process.argv.includes("--yes"))
    throw new Error(
      s.mode === "none"
        ? "Cleanup deletes managed worktree state. Pass --yes explicitly."
        : "Cleanup deletes this worktree database. Pass --yes explicitly.",
    );
  if (s.mode === "none") {
    await stopOnly(s);
    if (cleanup) {
      await safe(dir);
      if (s.serviceProfile) {
        await serviceStatus(s);
        await safe(path.join(dir, "backend.log"));
        await fs.rm(path.join(dir, "backend.log"), { force: true });
        await fs.rm(path.join(dir, "services.json"), { force: true });
      }
      await fs.rm(stateFile);

      // Only remove our own identity file. A user may keep unrelated files in
      // .worktree; an empty directory can be removed without recursive deletion.
      try { await fs.rmdir(dir); }
      catch (error) { if (error.code !== "ENOTEMPTY" && error.code !== "EEXIST") throw error; }
    }
    console.log(cleanup ? "Managed worktree state cleaned." : "No managed services; worktree state preserved.");
    return;
  }
  if (cleanup) await checkConfig(s);
  await stopOnly(s);
  // Teardown keeps the branch config; cleanup deletes only this worktree's.
  if (cleanup && s.configStore) await deleteBranch(s);
  await locked(async (leases) => {
    if (leases[root]?.id === s.id) delete leases[root];
    if (cleanup) {
      await safe(path.join(backend, ".convex/local/default"));
      await fs.rm(path.join(backend, ".convex/local/default"), {
        recursive: true,
        force: true,
      });
      if (layout.envFiles !== false) {
      await upsert(frontendEnv, {}, [
        "CONVEX_DEPLOYMENT",
        "CONVEX_URL",
        "CONVEX_SITE_URL",
        "NEXT_PUBLIC_CONVEX_URL",
        "NEXT_PUBLIC_CONVEX_SITE_URL",
        "NEXT_PUBLIC_SITE_URL",
        "PORT",
      ]);
      await upsert(path.join(backend, ".env.local"), {}, ["CONVEX_DEPLOYMENT"]);
      }
      await safe(dir);
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
  console.log(
    cleanup
      ? "Local database and managed config cleaned."
      : "Stopped; reservations released; database preserved.",
  );
}

export async function prune() {
  let count = 0;
  await locked(async (leases) => {
    for (const [checkout, lease] of Object.entries(leases)) {
      if (existsSync(path.join(checkout, ".worktree/local.json"))) continue;
      let free = true;
      for (const port of Object.values(lease.ports))
        if (!(await available(port))) free = false;
      if (free) {
        delete leases[checkout];
        count++;
      }
    }
  });
  console.log(`Released ${count} removed-checkout reservation(s).`);
}

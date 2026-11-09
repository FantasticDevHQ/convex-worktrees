import type { ChildProcess } from "node:child_process";
import type { BackendState, WorktreeState, Runtime, Layout } from "./types.mts";
import fs from "node:fs/promises";
import { openSync, closeSync } from "node:fs";

import path from "node:path";

import { spawn, execFileSync } from "node:child_process";

import {
  root,
  backend,
  frontend,
  script,
  dir,
  sleep,
  read,
  layout,
  stateFile,
} from "./context.mts";
import { launchServices, stopChildren, serviceStatus, markServicesStopped } from "./services.mts";
import { safe, json } from "./files.mts";
import { alive, locked, available } from "./registry.mts";
import { state, checkConfig, childEnv, convexArgs } from "./config.mts";
import { packageBin } from "./dependencies.mts";

export async function run(
  args: string[],
  s: BackendState,
  { bootstrap = false, input, timeout = 180000 }: { bootstrap?: boolean; input?: string; timeout?: number } = {},
) {
  let failure: (Error & { output?: string }) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: backend,
        env: childEnv(s, bootstrap),
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (d) => {
        output += d;
        process.stdout.write(d);
      });
      child.stderr.on("data", (d) => {
        output += d;
        process.stderr.write(d);
      });
      const timer = setTimeout(() => child.kill("SIGINT"), timeout);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.stdin.on("error", () => {});
      child.stdin.end(input);
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else {
          const error: Error & { output?: string } = new Error(
            `Convex command failed (${code ?? "timeout/signal"}).`,
          );
          error.output = output;
          reject(error);
        }
      });
    });
  } catch (error) {
    failure = error;
  }
  // A normal --once run flushes cleanup; skip-push does not reliably do so.
  let stopped = false;
  for (let n = 0; n < 200; n++) {
    if ((await available(s.ports.cloud)) && (await available(s.ports.site))) {
      stopped = true;
      break;
    }
    await sleep(100);
  }
  if (!stopped)
    throw new Error("Convex command exited but local ports did not close.");
  if (failure) {
    const config = await read<Layout>(
      path.join(root, "scripts/worktree.config.json"),
      {},
    );
    const expected =
      bootstrap &&
      (config.bootstrapMissingEnv || []).some((key) =>
        failure.output?.includes(`${key} is not set`),
      );
    if (!expected) throw failure;
    console.log(
      "Fresh backend configured; setting declared local environment before retrying the schema push.",
    );
  }
}

export async function ownedRunning(s: WorktreeState | null) {
  if (!s) return false;
  const runtime = await read<Runtime | null>(path.join(dir, "runtime.json"), null);
  if (!runtime || !alive(runtime.pid)) return false;
  let command: string;
  try {
    command = execFileSync(
      "ps",
      ["-p", String(runtime.pid), "-o", "stat=,command="],
      { encoding: "utf8" },
    );
  } catch (error) {
    if (error.status === 1) return false; // Exited between the liveness and ownership checks.
    throw error;
  }
  // A supervisor can exit before its parent reaps it. Never signal a zombie.
  if (/^\s*Z/.test(command)) return false;
  if (!command.includes(script) || !command.includes(`--owner=${s.id}`)) {
    throw new Error(
      "Recorded PID belongs to another process; refusing to signal it.",
    );
  }
  return runtime;
}

export async function reserve(s: BackendState) {
  await locked(async (leases) => {
    for (const [p, v] of Object.entries(leases)) {
      if (
        p !== root &&
        Object.values(v.ports).some((port) =>
          Object.values(s.ports).includes(port),
        )
      )
        throw new Error(
          "Worktree ports have been reassigned; run setup after resolving reservations.",
        );
    }
    for (const port of [s.ports.cloud, s.ports.site])
      if (!(await available(port)))
        throw new Error(`Reserved port ${port} is busy.`);
    leases[root] = { id: s.id, ports: s.ports };
  });
}

export async function serve(s: WorktreeState, withFrontend = false) {
  const managed = s.mode !== "none";
  if (managed) await checkConfig(s, true);
  const profile = s.serviceProfile ? validateProfiles(layout, ["--profile", s.serviceProfile]) : null;
  const backendArgs = managed ? convexArgs(s) : null;
  const frontendBin = withFrontend ? packageBin("next", "next", [frontend, root]) : null;
  const runtimeFile = path.join(dir, "runtime.json");
  const runtime = { pid: process.pid, id: s.id, ready: false };
  await safe(runtimeFile);
  await json(runtimeFile, runtime);
  const children: ChildProcess[] = [];
  let stopping = false;
  let markStopped: (() => Promise<void>) | undefined;
  async function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    await stopChildren(children);
    if (markStopped) await markStopped();
    await markServicesStopped(s);
    await fs.rm(runtimeFile, { force: true });
    process.exit(code);
  }
  const failure = (message: string) => { console.error(message); void stop(1); };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
  try {
    if (managed) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, backendArgs!, { cwd: backend, env: childEnv(s), stdio: ["ignore", "pipe", "pipe"] });
        children.push(child);
        let output = "";
        const timer = setTimeout(() => reject(new Error("Backend readiness timed out")), 120000);
        const consume = (data: Buffer) => {
          process.stdout.write(data);
          output = (output + data).slice(-65536);
          if (output.includes("Convex functions ready")) { clearTimeout(timer); resolve(); }
        };
        child.stdout.on("data", consume); child.stderr.on("data", consume);
        child.once("error", (error) => { clearTimeout(timer); reject(error); if (!stopping) failure(error.message); });
        child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Backend exited (${code})`)); if (!stopping) failure(`Backend exited (${code})`); });
      });
    }
    markStopped = await launchServices(profile, s, children, failure, () => stopping);
    if (stopping) return;
    if (withFrontend && s.mode !== "none") {
      const web = spawn(process.execPath, [frontendBin!, "dev", "--port", String(s.ports.web)], { cwd: frontend, env: childEnv(s), stdio: "inherit" });
      children.push(web);
      web.once("error", (error) => { if (!stopping) failure(error.message); });
      web.once("exit", (code) => { if (!stopping) failure(`Frontend exited (${code})`); });
    }
    runtime.ready = true;
    await json(runtimeFile, runtime);
  } catch (error) { failure(error.message); }
}

import { validateProfiles, runHooks } from "./hooks.mts";

export async function start(withFrontend = false) {
  const explicit = validateProfiles();
  const s = await state();
  const profile = explicit ?? (s.serviceProfile ? validateProfiles(layout, ["--profile", s.serviceProfile]) : null);
  if (await ownedRunning(s)) {
    if (explicit && explicit.name !== s.serviceProfile) throw new Error("Stop before changing the active service profile.");
    console.log("Already running.");
    return;
  }
  if (s.mode === "none" && withFrontend) throw new Error("No frontend configured with convex:false.");
  if (s.mode !== "none") {
    await checkConfig(s, true);
    convexArgs(s);
    if (withFrontend) packageBin("next", "next", [frontend, root]);
  }
  await runHooks(explicit, "beforeStart", s);
  if (profile) { s.serviceProfile = profile.name; await json(stateFile, s); }
  if (s.mode === "none" && !Object.keys(profile?.services ?? {}).length) {
    console.log("No backend or frontend services configured; nothing to start or stop.");
    return;
  }
  if (s.mode !== "none") await reserve(s);
  await serviceStatus(s);
  await json(path.join(dir, "services.json"), { id: s.id, profile: profile?.name ?? null, services: {} });
  await safe(path.join(dir, "runtime.json"));
  await safe(path.join(dir, "backend.log"));
  const log = openSync(path.join(dir, "backend.log"), "w", 0o600);
  const child = spawn(
    process.execPath,
    [script, "_serve", `--owner=${s.id}`, ...(withFrontend ? ["--frontend"] : [])],
    {
      cwd: root,
      env: process.env,
      detached: true,
      stdio: ["ignore", log, log],
    },
  );
  closeSync(log);
  child.unref();
  const deadline = Date.now() + 125000 + Object.values(profile?.services ?? {}).reduce((total, service) => total + service.readiness.timeoutMs, 0);
  while (Date.now() < deadline) {
    const statuses = await serviceStatus(s);
    const failed = Object.values(statuses?.services ?? {}).find((record) => record.status === "failed");
    if (failed || !alive(child.pid)) {
      await stopOnly(s);
      throw new Error(failed?.error ?? "Supervisor exited; inspect .worktree/backend.log.");
    }
    const runtime = await read<Runtime | null>(path.join(dir, "runtime.json"), null);
    if (runtime?.id === s.id && runtime.pid === child.pid && runtime.ready) {
      console.log(
        s.mode === "none" ? "Profile services ready." : `Backend ready at http://127.0.0.1:${s.ports.cloud}${withFrontend ? `; frontend http://localhost:${s.ports.web}` : ""}`,
      );
      return;
    }
    await sleep(100);
  }
  await stopOnly(s);
  throw new Error(
    "Backend readiness timed out; inspect .worktree/backend.log.",
  );
}

export async function stopOnly(s: WorktreeState) {
  if (s.mode === "none" && !s.serviceProfile) return;
  const runtime = await ownedRunning(s);
  if (!runtime) return;
  process.kill(runtime.pid, "SIGTERM");
  for (let n = 0; n < 200; n++) {
    if (!alive(runtime.pid)) {
      if (s.mode === "none") return;
      for (let attempt = 0; attempt < 200; attempt++) {
        if ((await available(s.ports.cloud)) && (await available(s.ports.site)))
          return;
        await sleep(100);
      }
      throw new Error("Backend process exited but its ports have not closed.");
    }
    await sleep(100);
  }
  throw new Error("Owned process did not stop; ports remain reserved.");
}

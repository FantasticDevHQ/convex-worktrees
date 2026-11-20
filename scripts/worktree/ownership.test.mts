// Ownership checks on the recorded supervisor PID. A fake `ps` first on PATH
// replays what Linux reports while a supervisor exits, so the window that made
// "readiness timeout and nonzero readiness fail with names" flaky is exercised
// on every run instead of by chance. Each test runs `stop` with a service
// profile set, so a wrong ownership answer would signal the stand-in process.
import type { TestContext } from "node:test";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("./cli.mts", import.meta.url));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;
const exited = async (pid: number) => {
  for (let n = 0; n < 50 && alive(pid); n++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  return !alive(pid);
};

/**
 * `psOutputs` are the lines the fake ps prints on successive calls; the last
 * repeats. `{owner}` stands for the supervisor command line of this checkout.
 * With `removeRuntimeOnCall`, that ps call also deletes runtime.json, as the
 * supervisor's own stop() does before it exits.
 */
async function fixture(
  t: TestContext,
  psOutputs: string[],
  { removeRuntimeOnCall }: { removeRuntimeOnCall?: number } = {},
) {
  const base = await fs.realpath(
    await fs.mkdtemp(path.join(tmpdir(), "worktree-ownership-")),
  );
  const root = path.join(base, "checkout"),
    bin = path.join(base, "bin");
  await fs.mkdir(path.join(root, "scripts"), { recursive: true });
  await fs.mkdir(bin);
  await fs.writeFile(
    path.join(root, "scripts/worktree.config.json"),
    JSON.stringify({ convex: false, profiles: { example: { services: {} } } }),
  );
  // A real process we own stands in for the supervisor, so liveness checks pass.
  const stand = spawn("sleep", ["30"], { stdio: "ignore" });
  t.after(async () => {
    stand.kill("SIGKILL");
    await fs.rm(base, { recursive: true, force: true });
  });
  const env = {
    ...process.env,
    WORKTREE_REGISTRY_DIR: path.join(base, "registry"),
  };
  const setup = spawnSync(process.execPath, [cli, "setup"], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
    env,
  });
  assert.equal(setup.status, 0, setup.stderr + setup.stdout);
  const stateFile = path.join(root, ".worktree/local.json");
  const state = JSON.parse(await fs.readFile(stateFile, "utf8"));
  // Without a profile, stop returns before it looks at the recorded PID.
  await fs.writeFile(
    stateFile,
    JSON.stringify({ ...state, serviceProfile: "example" }),
  );
  const runtimeFile = path.join(root, ".worktree/runtime.json");
  await fs.writeFile(
    runtimeFile,
    JSON.stringify({ id: state.id, pid: stand.pid, ready: false }),
  );
  const owner = `Ss   ${process.execPath} ${cli} _serve --owner=${state.id}`;
  const lines = psOutputs.map((line) =>
    quote(line.replaceAll("{owner}", owner)),
  );
  const calls = path.join(bin, "calls");
  await fs.writeFile(
    path.join(bin, "ps"),
    `#!/bin/sh
n=$(cat ${quote(calls)} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${quote(calls)}
${removeRuntimeOnCall ? `[ $n -eq ${removeRuntimeOnCall} ] && rm -f ${quote(runtimeFile)}` : ""}
case $n in
${lines.map((line, n) => `${n + 1}) echo ${line} ;;`).join("\n")}
*) echo ${lines.at(-1)} ;;
esac
`,
    { mode: 0o755 },
  );
  const run = async (command: string) => {
    await fs.rm(calls, { force: true });
    const started = Date.now();
    // Asynchronous, so this process keeps reaping the stand-in once it is signalled.
    const child = spawn(process.execPath, [cli, command], {
      cwd: root,
      env: { ...env, PATH: `${bin}:${process.env.PATH}` },
      timeout: 15000,
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    const [status] = await once(child, "close");
    return { status, stdout, stderr, ms: Date.now() - started };
  };
  return { pid: stand.pid!, run };
}

test("an exiting supervisor with an emptied command line is not running and is never signalled", async (t) => {
  // Linux ps output for a supervisor between releasing its memory and becoming a zombie.
  const f = await fixture(t, [
    "Rs   [MainThread]",
    "Rs   [MainThread]",
    "Zs   [MainThread] <defunct>",
  ]);
  const status = await f.run("status");
  assert.equal(status.status, 0, status.stderr + status.stdout);
  assert.equal(JSON.parse(status.stdout).running, false);
  const stop = await f.run("stop");
  assert.equal(stop.status, 0, stop.stderr + stop.stdout);
  assert.equal(alive(f.pid), true);
});

test("a supervisor that removed runtime.json is treated as gone without waiting out the grace", async (t) => {
  const f = await fixture(t, ["Rs   [MainThread]"], { removeRuntimeOnCall: 1 });
  const stop = await f.run("stop");
  assert.equal(stop.status, 0, stop.stderr + stop.stdout);
  assert.ok(stop.ms < 1500, `stop took ${stop.ms} ms`);
  assert.equal(alive(f.pid), true);
});

test("a recorded PID that keeps showing a foreign command is still refused", async (t) => {
  const f = await fixture(t, ["S    sleep 30"]);
  const stop = await f.run("stop");
  assert.notEqual(stop.status, 0);
  assert.match(
    stop.stderr,
    /Recorded PID belongs to another process; refusing to signal it\./,
  );
  assert.equal(alive(f.pid), true);
});

test("a recorded PID that shows the owner is signalled", async (t) => {
  // Control: proves the stop path in the tests above would signal a match.
  const f = await fixture(t, ["Rs   [MainThread]", "{owner}"]);
  const stop = await f.run("stop");
  assert.equal(stop.status, 0, stop.stderr + stop.stdout);
  assert.equal(await exited(f.pid), true);
});

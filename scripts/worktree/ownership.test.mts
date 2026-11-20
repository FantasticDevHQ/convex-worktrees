// Ownership checks on the recorded supervisor PID. A fake `ps` first on PATH
// replays what Linux reports while a supervisor exits, so the window that made
// "readiness timeout and nonzero readiness fail with names" flaky is exercised
// on every run instead of by chance.
import type { TestContext } from "node:test";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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

async function fixture(t: TestContext, psOutputs: string[]) {
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
  // Each call prints the next canned line; the last one repeats.
  const lines = psOutputs.map((line, n) => `${n + 1}) echo '${line}' ;;`);
  await fs.writeFile(
    path.join(bin, "ps"),
    `#!/bin/sh
n=$(cat "${bin}/calls" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${bin}/calls"
case $n in
${lines.join("\n")}
*) echo '${psOutputs.at(-1)}' ;;
esac
`,
    { mode: 0o755 },
  );
  // A real process we own stands in for the supervisor, so liveness checks pass.
  const stand = spawn("sleep", ["30"], { stdio: "ignore" });
  t.after(async () => {
    stand.kill("SIGKILL");
    await fs.rm(base, { recursive: true, force: true });
  });
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: {
        ...process.env,
        WORKTREE_REGISTRY_DIR: path.join(base, "registry"),
      },
    });
  const setup = run("setup");
  assert.equal(setup.status, 0, setup.stderr + setup.stdout);
  const { id } = JSON.parse(
    await fs.readFile(path.join(root, ".worktree/local.json"), "utf8"),
  );
  await fs.writeFile(
    path.join(root, ".worktree/runtime.json"),
    JSON.stringify({ id, pid: stand.pid, ready: false }),
  );
  const status = () =>
    spawnSync(process.execPath, [cli, "status"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        WORKTREE_REGISTRY_DIR: path.join(base, "registry"),
      },
    });
  return { pid: stand.pid!, status };
}

test("an exiting supervisor with an emptied command line is not running and is never signalled", async (t) => {
  // Linux ps output for a supervisor between releasing its memory and becoming a zombie.
  const f = await fixture(t, [
    "Rs   [MainThread]",
    "Rs   [MainThread]",
    "Zs   [MainThread] <defunct>",
  ]);
  const r = f.status();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(JSON.parse(r.stdout).running, false);
  assert.equal(alive(f.pid), true);
});

test("a recorded PID that keeps showing a foreign command is still refused", async (t) => {
  const f = await fixture(t, ["S    sleep 30"]);
  const r = f.status();
  assert.notEqual(r.status, 0);
  assert.match(
    r.stderr,
    /Recorded PID belongs to another process; refusing to signal it\./,
  );
  assert.equal(alive(f.pid), true);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
const script = new URL("./cli.mjs", import.meta.url).pathname;
function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
  }).trim();
}
async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), "freshness-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const origin = path.join(base, "origin"),
    root = path.join(base, "checkout");
  await mkdir(origin);
  git(origin, "init", "--initial-branch=main");
  git(origin, "config", "user.email", "test@example.invalid");
  git(origin, "config", "user.name", "Test");
  await writeFile(path.join(origin, "convex.json"), "{}");
  git(origin, "add", ".");
  git(origin, "commit", "-m", "initial");
  git(base, "clone", origin, root);
  return {
    base,
    origin,
    root,
    run: () =>
      spawnSync(process.execPath, [script, "setup", "--prepare-only"], {
        cwd: root,
        env: {
          ...process.env,
          WORKTREE_REGISTRY_DIR: path.join(base, "registry"),
        },
        encoding: "utf8",
      }),
  };
}
test("setup refuses dirty tracked files without discarding changes", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, "convex.json"), "changed");
  const r = f.run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /dirty|uncommitted/i);
  assert.equal(git(f.root, "diff", "--numstat").length > 0, true);
});
test("setup fetches and fast-forwards stale checkout and local main", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.origin, "new.txt"), "fresh");
  git(f.origin, "add", ".");
  git(f.origin, "commit", "-m", "fresh");
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    git(f.root, "rev-parse", "HEAD"),
    git(f.origin, "rev-parse", "HEAD"),
  );
});
test("setup fails clearly when fetch fails", async (t) => {
  const f = await fixture(t);
  git(f.root, "remote", "set-url", "origin", path.join(f.base, "missing"));
  const r = f.run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /fetch/i);
});
test("setup preserves topic commits already based on fetched main", async (t) => {
  const f = await fixture(t);
  git(f.root, "switch", "-c", "topic");
  git(f.root, "config", "user.email", "test@example.invalid");
  git(f.root, "config", "user.name", "Test");
  await writeFile(path.join(f.root, "topic.txt"), "keep");
  git(f.root, "add", ".");
  git(f.root, "commit", "-m", "topic");
  const head = git(f.root, "rev-parse", "HEAD");
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(git(f.root, "rev-parse", "HEAD"), head);
});
test("setup refuses diverged topic commits without changing HEAD", async (t) => {
  const f = await fixture(t);
  git(f.root, "switch", "-c", "topic");
  git(f.root, "config", "user.email", "test@example.invalid");
  git(f.root, "config", "user.name", "Test");
  await writeFile(path.join(f.root, "topic.txt"), "keep");
  git(f.root, "add", ".");
  git(f.root, "commit", "-m", "topic");
  const head = git(f.root, "rev-parse", "HEAD");
  await writeFile(path.join(f.origin, "upstream.txt"), "fresh");
  git(f.origin, "add", ".");
  git(f.origin, "commit", "-m", "upstream");
  const r = f.run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /diverged/i);
  assert.equal(git(f.root, "rev-parse", "HEAD"), head);
});
test("setup can create a new worktree from freshly fetched origin/main", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.origin, "new.txt"), "fresh");
  git(f.origin, "add", ".");
  git(f.origin, "commit", "-m", "fresh");
  const target = path.join(f.base, "new-checkout");
  const r = spawnSync(
    process.execPath,
    [
      script,
      "setup",
      "--path",
      target,
      "--branch",
      "new-topic",
      "--prepare-only",
    ],
    {
      cwd: f.root,
      env: {
        ...process.env,
        WORKTREE_REGISTRY_DIR: path.join(f.base, "registry"),
      },
      encoding: "utf8",
    },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    git(target, "rev-parse", "HEAD"),
    git(f.origin, "rev-parse", "HEAD"),
  );
});

test("setup fast-forwards clean main checked out in a sibling", async (t) => {
  const f = await fixture(t);
  const sibling = path.join(f.base, "sibling");
  git(f.root, "worktree", "add", "--detach", sibling, "HEAD");
  await writeFile(path.join(f.origin, "fresh.txt"), "fresh");
  git(f.origin, "add", ".");
  git(f.origin, "commit", "-m", "fresh");
  const r = spawnSync(process.execPath, [script, "setup", "--prepare-only"], {
    cwd: sibling,
    env: {
      ...process.env,
      WORKTREE_REGISTRY_DIR: path.join(f.base, "registry"),
    },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    git(f.root, "rev-parse", "HEAD"),
    git(f.origin, "rev-parse", "HEAD"),
  );
  assert.equal(
    git(sibling, "rev-parse", "HEAD"),
    git(f.origin, "rev-parse", "HEAD"),
  );
});

test("setup preserves dirty files in a stale sibling main checkout", async (t) => {
  const f = await fixture(t),
    sibling = path.join(f.base, "sibling");
  git(f.root, "worktree", "add", "--detach", sibling, "HEAD");
  await writeFile(path.join(f.origin, "fresh.txt"), "fresh");
  git(f.origin, "add", ".");
  git(f.origin, "commit", "-m", "fresh");
  await writeFile(path.join(f.root, "convex.json"), "keep edits");
  const main = git(f.root, "rev-parse", "HEAD");
  const r = spawnSync(process.execPath, [script, "setup", "--prepare-only"], {
    cwd: sibling,
    env: {
      ...process.env,
      WORKTREE_REGISTRY_DIR: path.join(f.base, "registry"),
    },
    encoding: "utf8",
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /dirty|uncommitted/);
  assert.equal(git(f.root, "rev-parse", "HEAD"), main);
  assert.match(git(f.root, "diff"), /keep edits/);
});

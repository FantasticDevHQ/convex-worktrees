import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
const tests = fs.readdirSync(path.join(root, "scripts/worktree"))
  .filter((name) => name.endsWith(".test.mjs"))
  .map((name) => path.join(root, "scripts/worktree", name));
tests.push(path.join(root, "scripts/pr-standard.test.mjs"), path.join(root, "scripts/enforce-pr-standard.test.mjs"));
const suite = spawnSync(process.execPath, ["--test", ...tests], { cwd: root, stdio: "inherit" });
if (suite.error) throw suite.error;
if (suite.status !== 0) process.exit(suite.status || 1);

const target = fs.mkdtempSync(path.join(tmpdir(), "convex worktree export "));
try {
  // Exercise the public CLI from the target app's working directory, exactly
  // as documented. The installer must locate its own source checkout.
  const installed = spawnSync(process.execPath, [path.join(root, "install.mjs"), "."], {
    cwd: target, stdio: "inherit",
  });
  if (installed.error) throw installed.error;
  assert.equal(installed.status, 0, "Export installation failed");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  for (const item of Object.values(manifest.files)) {
    const data = fs.readFileSync(path.join(target, item.path));
    assert.equal(createHash("sha256").update(data).digest("hex"), item.sha256, item.path);
  }
  const appConfig = JSON.parse(fs.readFileSync(path.join(target, "scripts/worktree.config.json"), "utf8"));
  assert.notEqual(appConfig.convex, false, "The toolkit's backend-free self adapter must not be exported to apps");
  const copiedTests = tests.filter((file) => file.startsWith(path.join(root, "scripts/worktree") + path.sep))
    .map((file) => path.join(target, path.relative(root, file)));
  const copied = spawnSync(process.execPath, ["--test", ...copiedTests], { cwd: target, stdio: "inherit" });
  if (copied.error) throw copied.error;
  assert.equal(copied.status, 0, "Tests failed in the installed app directory");
  console.log("Export verification: installed layout, checksums and copied tests passed in a path containing spaces.");
} finally {
  fs.rmSync(target, { recursive: true, force: true });
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("installed TypeScript modules run in CommonJS apps without a loader or dependencies", () => {
  const target = mkdtempSync(path.join(tmpdir(), "worktree typescript "));
  try {
    writeFileSync(path.join(target, "package.json"), JSON.stringify({ type: "commonjs" }));
    const installer = fileURLToPath(new URL("../../install.mjs", import.meta.url));
    const installed = spawnSync(process.execPath, [installer, target], { encoding: "utf8" });
    assert.equal(installed.status, 0, installed.stderr);
    mkdirSync(path.join(target, "scripts"), { recursive: true });
    const check = path.join(target, "scripts/check.mts");
    writeFileSync(check, `import { installCommand } from './worktree/dependencies.mts';
      import { validateProfiles } from './worktree/hooks.mts';
      import assert from 'node:assert/strict';
      const command: string[] = installCommand(process.cwd());
      assert.deepEqual(command, ['npm', 'ci']);
      assert.equal(validateProfiles({}, []), null);
    `);
    writeFileSync(path.join(target, "package-lock.json"), "{}");
    const result = spawnSync(process.execPath, [check], { cwd: target, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

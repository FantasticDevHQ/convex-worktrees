# Convex worktree toolkit

Keep implementation and all worktree tests under scripts/worktree/. Layout differences belong in scripts/worktree.config.json. Do not copy application code or generated environment/state into this repository.

Run node scripts/check.mjs. Node tests use built-ins and need no dependency install. The optional real-backend test runs in a consuming Convex app with examples/probe.ts installed; do not claim it ran in this standalone toolkit.

Keep manifest.json hashes current when changing exported files. The Node installer must refuse existing files and symlinked destination paths.

Preserve anonymous backend isolation, explicit ports, ownership checks and safe Git freshness handling. Never force-reset Git, copy cloud credentials or kill processes by port/name.

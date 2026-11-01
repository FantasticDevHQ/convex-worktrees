# Convex worktree toolkit

Keep implementation and all worktree tests under scripts/worktree/. Layout differences belong in scripts/worktree.config.json. Do not copy application code or generated environment/state into this repository.

Run node scripts/check.mjs. Node tests use built-ins and need no dependency install. The optional real-backend test runs in a consuming Convex app with examples/probe.ts installed; do not claim it ran in this standalone toolkit.

Keep manifest.json hashes current when changing exported files. The Node installer must refuse existing files and symlinked destination paths.

Preserve anonymous backend isolation, explicit ports, ownership checks and safe Git freshness handling. Never force-reset Git, copy cloud credentials or kill processes by port/name.

This repository uses its own backend-free adapter. Run `node scripts/worktree/cli.mjs setup` from a clean checkout before work, and teardown/cleanup when finished. No Convex backend or frontend should be created for this repository itself. The installer must export the separate application defaults, with Convex enabled.

Follow docs/pull-request-standard.md and the PR template. Include the owning ticket, required sections, actual agent/session identity and current evidence. The metadata workflow must execute trusted base code only. CI uses UbiCloud compute; verify actual runner identity before claiming an execution passed.

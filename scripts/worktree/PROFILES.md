# Explicit profiles

Add profiles to the consuming app's `scripts/worktree.config.json`:

```json
{
  "profiles": {
    "example": {
      "hooks": {
        "afterPrepare": [{"name":"prepare", "command":["node","scripts/example/prepare.mjs"]}],
        "beforeImport": [{"name":"credentials", "command":["node","scripts/example/credentials.mjs"], "timeoutMs":30000}]
      }
    }
  }
}
```

Run `node scripts/worktree/cli.mjs setup --profile example`. Selection is per
invocation; omission runs no profile commands. `start --profile example` runs
only `beforeStart` hooks, after ownership/config checks and before service startup.
Selection is also forwarded by `setup --path ... --branch ... --profile example`.
All declarations are validated, including unselected profiles, before hooks run.

Setup phases, under the existing checkout lock:

1. `afterPrepare`: after identity, port allocation and managed environment files.
   Runs even with `--prepare-only`. Backend-free setup runs only this phase.
2. `beforeImport`: after anonymous backend bootstrap and ownership validation,
   before `convex env set --from-file .worktree/backend.env`.
3. `afterPush`: after environment import and successful final push.

Repeated setup reruns these phases; scripts must reuse external resources safely.
Hooks execute sequentially and must exit. A named failure stops subsequent hooks
and lifecycle steps. Commands are executable plus literal argv, with no shell.
Paths are relative to the worktree root. No directory scanning occurs; adding an
unlisted helper file has no effect. Existing editor `prepareCommand` integration
continues to invoke setup as before; no new editor execution policy is introduced.
Long-running services are reserved for CNW-2.

Each child receives `WORKTREE_CONTEXT`, a JSON object with `version`, `profile`,
`phase`, `id`, `root`, `backend`, `frontend`, `stateDirectory`, `environmentFile`,
and `ports` (`web`, `cloud`, `site`; empty in backend-free mode). Convex children
retain the isolated HOME and scrubbed Convex environment. Consumer scripts must
keep credentials in their own repository's ignored state and must not log them.
A credentials hook can read this context and update `environmentFile`; the next
import reads that file. The two scripts above form a minimal preparation/import
example; provider-specific provisioning belongs in the consumer repository.

The default timeout is 180 seconds; `timeoutMs` is an integer from 1 to 3600000.
Timeout or runner SIGINT/SIGTERM sends SIGTERM to the direct child, then SIGKILL
after two seconds if needed. Hooks must not detach processes or leave background
children. Interruptions fail the phase even if the child exits zero.

# Convex worktrees

Run multiple Git worktrees with independent local Convex backends, databases, ports and environment files. Includes setup, start, stop, teardown, explicit cleanup and stale-reservation pruning.

The scripts run noninteractively in editors, coding agents and CI. Local development needs no Convex account, cloud development deployment or copied cloud credentials.

## Requirements

- Node.js 22+, Git and Bun.
- An existing Convex application. The Convex CLI must resolve at `node_modules/convex/bin/main.js` from the repository root; adapt `scripts/worktree/config.mjs` for another dependency layout.
- macOS or modern Linux with a compatible glibc/C++ runtime for the Convex binary. Native Windows process checks are not supported; use WSL.
- Network access for fetching main, installing dependencies and the initial Convex binary/dashboard download.

The optional frontend commands currently target Next.js. Adapt `commands.mjs` and `processes.mjs` for another frontend. Backend-only operation does not start the frontend.

## Install in your application

```sh
git clone https://github.com/FantasticDevHQ/convex-worktrees.git
cd convex-worktrees
python3 install.py /path/to/your/app
```

The installer verifies the source checksums and copies the toolkit into the application. It refuses to overwrite existing files or follow symlinked destination paths. If you already have worktree tooling, review and merge it manually.

Implementation and all worktree tests live under `scripts/worktree/`. The installer also copies `scripts/worktree.config.json` and the compatibility wrapper `scripts/worktree.mjs`.

## Configure the layout

The sample uses a Turborepo layout:

```text
apps/web/                    # Frontend
packages/backend/            # Convex project, including convex.json and convex/
scripts/worktree/            # Tooling and tests
scripts/worktree.config.json # Layout and local defaults
```

A single-package app can set `backend` and `frontend` to `.`. Configure these fields before setup:

| Field | Purpose |
| --- | --- |
| `backend`, `frontend` | Paths relative to the repository root. |
| `env` | Synthetic local backend environment defaults required by your schema. |
| `secretEnv` | Names of values generated once per checkout and retained across repeated setup. |
| `siteUrlEnv` | Backend variables that should contain this checkout's frontend URL. |
| `bootstrapMissingEnv` | Specific missing-variable errors allowed only on the first push, before defaults are seeded and a final successful push is required. |

The environment defaults start empty. Add only what your app needs. Never put production credentials in the configuration. External integrations require separate test credentials and verification; successful schema deployment does not test them.

Merge these scripts into your application's root `package.json`:

```json
{
  "worktree:setup": "node scripts/worktree/cli.mjs setup",
  "worktree:start": "node scripts/worktree/cli.mjs start",
  "worktree:stop": "node scripts/worktree/cli.mjs stop",
  "worktree:teardown": "node scripts/worktree/cli.mjs teardown",
  "worktree:cleanup": "node scripts/worktree/cli.mjs cleanup",
  "worktree:prune": "node scripts/worktree/cli.mjs prune",
  "dev": "node scripts/worktree/cli.mjs dev",
  "dev:backend": "node scripts/worktree/cli.mjs backend",
  "dev:frontend": "node scripts/worktree/cli.mjs frontend",
  "test:worktree": "node --test scripts/worktree/*.test.mjs",
  "test:worktree:integration": "node --test scripts/worktree/worktree.integration.mjs"
}
```

Ignore `.worktree/`, backend `.convex/` local state and generated `.env.local` files, preserving your existing ignore rules. Commit and push the tooling, config, package/lockfile and ignore changes before creating worktrees: new checkouts start from `origin/main`, so the tooling must already exist there.

## Setup and start

From a clean application checkout:

```sh
bun install --frozen-lockfile
bun run worktree:setup
bun run worktree:start
# Optional Next.js frontend alongside the backend:
# bun run worktree:start --frontend
```

To create and provision a new branch and checkout:

```sh
bun run worktree:setup --path ../app-feature --branch feature/my-change
cd ../app-feature
bun run worktree:start
```

An editor can create the checkout itself, then run installation and ordinary setup there. Setup provisions and pushes the app's actual schema/components, then exits. Start runs the supervisor. Alternatively use `bun run dev` for a foreground session. Do not start a second backend in an already running checkout.

Setup fetches `origin/main` and stops on fetch failure. It fast-forwards stale checkouts and local main when safe, and preserves topic commits already based on fetched main. Dirty tracked files or divergence stop setup rather than resetting, stashing or discarding changes. Rebase or merge deliberately, then retry. If your default branch has another name, adapt `freshness.mjs`.

## Isolation and stable ports

Each checkout owns its database, `.worktree/home`, `.worktree/cache` and environment selection. Bootstrap uses the noninteractive anonymous flow; later runs use verified project-local anonymous agent mode. Inherited Convex selectors are removed from the backend child's environment.

The per-user host registry `~/.local/state/convex-worktrees/leases.json` allocates distinct stable frontend, backend and site ports. Every backend start passes both `--local-cloud-port` and `--local-site-port`. Locks coordinate allocation and lifecycle operations. Starts serialize cache/dashboard provisioning while running backends remain concurrent.

With the sample layout, the database is in `packages/backend/.convex/local/default/`. Managed state and generated secrets live in `.worktree/`. Do not copy these between checkouts, commit them or upload their environment/log files. Secret/configuration files use restricted permissions.

## Stop, teardown and cleanup

| Command | Processes | Port reservations | Local database |
| --- | --- | --- | --- |
| `worktree:stop` | Stops owned processes | Retained | Retained |
| `worktree:teardown` | Stops owned processes | Released | Retained |
| `worktree:cleanup --yes` | Stops owned processes | Released | Deleted with owned generated configuration |
| `worktree:prune` | Does not kill processes | Removes eligible stale reservations | Preserved |

Run commands with `bun run`, for example `bun run worktree:teardown`. Cleanup requires explicit `--yes`.

Teardown does not remove Git branches or checkout directories. Run it before your editor or Git removes a checkout. Deleting that directory also deletes any database inside it, even though teardown itself preserves data.

After teardown, another checkout can claim the released ports. Restart reclaims them only if free. If reassigned, the command fails clearly. Explicit cleanup and fresh setup allocate new state and ports, but cleanup deletes the old database. Preserve anything needed first.

Before signalling, the recorded supervisor PID must match the expected script path and ownership token. Shutdown forwards SIGINT to Convex and waits for ports to close. The scripts never kill by port or broad process name. If SIGKILL leaves an orphan, inspect ownership before manually retiring it.

Prune removes a reservation only when managed checkout state is absent and every reserved port is free. Keep the same registry throughout setup/start/teardown; do not assign a different `WORKTREE_REGISTRY_DIR` to each worktree.

## Editors, agents and CI

Use the same lifecycle from any tool that runs shell commands. A setup hook should install dependencies and run setup, then exit. A teardown hook should run `bun run worktree:teardown` before removing the checkout.

For CI, provide an accessible `origin/main` and enough Git history for ancestry checks. Install Git, Node and Bun, then run setup/start, your tests and teardown in an always-run cleanup step. Abrupt machine termination cannot guarantee cleanup, so prune stale reservations on persistent hosts. CI runner selection belongs to the consuming application.

## Tests

From this toolkit repository:

```sh
npm run check:all
```

This runs the dependency-free lifecycle/freshness tests and verifies installation, hashes, overwrite refusal and symlink refusal. No npm install is required.

The optional real-backend integration test runs inside a consuming application, not this toolkit. It is skipped here because there is no application backend. To use it:

1. Merge the table in `examples/schema.ts` into your application's Convex schema.
2. Copy `examples/probe.ts` into your app's Convex function directory as `probe.ts`.
3. Keep these probe functions local to your development/test backend; they are unauthenticated and are not intended for a public deployment.
4. Commit the test setup and required lockfile to the app's main branch, then run `bun run test:worktree:integration` from a clean app checkout.

The integration test deploys the app schema in two temporary worktrees, writes different probe records, verifies database isolation and restart persistence, tests busy-port refusal and checks sibling-safe teardown/cleanup. It exercises backends only; test your frontend separately if using the optional frontend adapter. Adapt the probe operations if your app's schema or auth needs another test strategy.

## Modules

- `cli.mjs` and `commands.mjs`: command entry points and dispatch.
- `context.mjs`: repository and layout paths.
- `freshness.mjs`: fetched-main checks and safe fast-forward behavior.
- `registry.mjs`: locking, reservations and port probes.
- `config.mjs` and `files.mjs`: state validation, environment selection and safe file operations.
- `processes.mjs`: owned process supervision and graceful shutdown.
- `lifecycle.mjs`: setup, teardown, cleanup and prune.

`manifest.json` records checksums for the exported implementation, configuration and tests. Update the hashes when adapting files before reusing the installer.

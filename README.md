# Convex worktrees

Run multiple Git worktrees with independent local Convex backends, databases, ports and environment files. Includes setup, start, stop, teardown, explicit cleanup and stale-reservation pruning.

The scripts run noninteractively in editors, coding agents and CI. Local development needs no Convex account, cloud development deployment or copied cloud credentials.

## Quick start

### Have my agent set this up

Copy this prompt into your coding agent while it is working in your application:

```text
Set up this application's local Convex worktree workflow end to end using:
https://github.com/FantasticDevHQ/convex-worktrees

1. Read the target application's root and applicable nested AGENTS.md files
   before editing, wherever present. Read AGENT.md too if this project uses it.
   Inspect Git status, existing worktree scripts, Convex/frontend paths, schema,
   components, required local environment variables, packageManager, committed
   lockfiles and dependency-build settings. Discover origin's live advertised
   default branch and inspect any baseBranch override in the worktree config.
   Work on a clean adoption branch or worktree. Preserve user changes; do not
   commit unrelated work.

2. Clone the toolkit outside this application and inspect its README and source.
   Run node scripts/check.mjs from the toolkit checkout. Install with
   node "<toolkit-path>/install.mjs" "<application-root>", or merge existing tooling
   carefully when the installer refuses an overwrite. Keep implementation and
   all worktree tests under scripts/worktree/.

3. Configure scripts/worktree.config.json for this application's existing paths
   and synthetic local defaults required by its schema/components. Resolve the
   base branch from origin's advertised default, or set baseBranch explicitly
   when this app uses another integration branch. Do not assume main. Add the
   lifecycle/test package scripts and generated-state ignore rules while
   preserving existing settings. Keep the
   current package manager, lockfile, build policy and production/deployment
   configuration. Resolve ambiguous manager selection before installing. Do not
   upgrade dependencies or migrate the app's layout/framework as part of this
   task. For an existing Convex Turborepo, use its packages/backend convention.
   Adapt the optional frontend command only if needed for the current framework.
   Install application dependencies with its detected manager's frozen/locked
   command. Do not create another manager's lockfile. Prepare local-only probe
   fixtures and generated code needed for testing before committing test changes.

4. Follow the application's review workflow and commit only adoption changes so
   setup can run from a clean checkout. From the application root, run:
   node --test scripts/worktree/*.test.mjs
   node scripts/worktree/cli.mjs setup
   node scripts/worktree/cli.mjs start
   node scripts/worktree/cli.mjs stop
   node scripts/worktree/cli.mjs setup
   node scripts/worktree/cli.mjs start
   Verify repeated setup/restart preserves ports, generated configuration and
   local data. Use disposable test state to verify two real backends have
   isolated rows and teardown/cleanup leaves the sibling running. Adapt the
   supplied local probe examples and run:
   node --test scripts/worktree/worktree.integration.mjs
   node scripts/worktree/cli.mjs teardown
   Use cleanup --yes only for disposable state whose ownership you verified.

5. Prepare the adoption PR and follow this application's review/merge policy.
   Test setup --path for a new worktree only after the adoption
   changes land on the selected origin base branch. If merging, network access,
   authentication or platform support blocks a check, report it and leave that
   check incomplete.
   Do not bypass safeguards or claim verification that did not happen.

Use project-local anonymous backends and stable allocated ports. Do not create
cloud development deployments, copy production secrets or kill by port/name.

Finish with actual changed paths, the detected package manager, exact commands
for this app, checks passed/not run, and remaining PR/merge steps or blockers.
```

### Manual setup

You need Node.js 22+, Git, your application's package manager and an existing Convex application. Use a clean adoption branch and follow your application's change workflow.

1. From your application root, copy the toolkit into it:

   ```sh
   git clone https://github.com/FantasticDevHQ/convex-worktrees.git ../convex-worktrees-kit
   node ../convex-worktrees-kit/install.mjs .
   ```

   Choose another clone path if that directory already exists. The installer verifies checksums and refuses existing destination files or symlinked paths. Merge existing worktree tooling manually rather than overwriting it.

2. Set `backend` and `frontend` in `scripts/worktree.config.json`. The defaults are `packages/backend` and `apps/web`; a single-package app can use `.`. Setup discovers the default branch advertised by `origin`; set optional `baseBranch` if you want another branch. Add the [package scripts](#package-scripts), ignore generated state and configure any required local environment defaults. See [configuration](#configure-the-layout) for the full fields.

3. Install your application's dependencies with its existing manager:

   | Manager | Install dependencies |
   | --- | --- |
   | Bun | `bun install --frozen-lockfile` |
   | pnpm | `pnpm install --frozen-lockfile` |
   | npm | `npm ci` |

   Keep the matching lockfile committed. [Package-manager selection](#package-manager-selection) explains detection and workspace settings.

4. Commit the adoption changes so the checkout is clean, then provision and start the local backend:

   ```sh
   node --test scripts/worktree/*.test.mjs
   node scripts/worktree/cli.mjs setup
   node scripts/worktree/cli.mjs start
   # Optional Next.js frontend alongside the backend:
   # node scripts/worktree/cli.mjs start --frontend
   ```

   Setup resolves and fetches the selected base branch from `origin`; it stops for resolution/fetch failures, dirty files or divergence instead of discarding changes. Merge and push the adoption changes onto that remote branch before [creating a new worktree](#daily-use), since new checkouts start from the fetched base.

To stop and release this checkout's ports while keeping its database:

```sh
node scripts/worktree/cli.mjs teardown
```

## Requirements

- Node.js 22+, Git and your application's package manager: Bun, pnpm or npm. The selected manager must be available on PATH.
- An existing Convex application. Install Convex in the backend workspace or repository root. The toolkit resolves its installed CLI, including pnpm's isolated workspace layout. The optional Next.js CLI resolves from the frontend workspace, then the root.
- macOS or modern Linux with a compatible glibc/C++ runtime for the Convex binary. Native Windows process checks are not supported; use WSL.
- Network access for resolving/fetching the remote base branch, installing dependencies and the initial Convex binary/dashboard download.

The optional frontend commands currently target Next.js. Adapt `commands.mjs` and `processes.mjs` for another frontend. Backend-only operation does not start the frontend.

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
| `convex` | Omit or use `true` for Convex applications. Set `false` only for backend-free repositories such as the toolkit itself. |
| `baseBranch` | Optional branch name on `origin`, such as `master`, `masters` or `develop`. Without it, setup uses the remote's live advertised default branch. |
| `env` | Synthetic local backend environment defaults required by your schema. |
| `secretEnv` | Names of values generated once per checkout and retained across repeated setup. |
| `siteUrlEnv` | Backend variables that should contain this checkout's frontend URL. |
| `bootstrapMissingEnv` | Specific missing-variable errors allowed only on the first push, before defaults are seeded and a final successful push is required. |

The remote is `origin`. Setup resolves its live symbolic default branch unless `baseBranch` is set; it does not assume a branch named `main`. For a non-default integration branch, add a branch name to the adapter, for example:

```json
{
  "backend": "packages/backend",
  "frontend": "apps/web",
  "baseBranch": "develop"
}
```

If the default cannot be resolved or the selected branch cannot be fetched, setup stops clearly. Use an explicit `baseBranch` when the remote does not advertise a default. Both existing-checkout refresh and new-worktree creation use the same resolved remote base.

An existing local base branch is fast-forwarded only when safe, including when it is checked out in a sibling worktree. New-worktree creation uses the fetched commit without merging it into a different caller branch.

The environment defaults start empty. Add only what your app needs. Never put production credentials in the configuration. External integrations require separate test credentials and verification; successful schema deployment does not test them.

### Package scripts

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

Ignore `.worktree/`, backend `.convex/` local state and generated `.env.local` files, preserving your existing ignore rules. Commit the adoption changes before setup so the application checkout is clean. Merge and push them to the selected base branch on `origin` before creating new worktrees; those checkouts need the tooling and configuration too.

## Package-manager selection

New-worktree creation and the optional backend integration harness use the same install selection:

1. Use the root `package.json` `packageManager` field when present. Provision the desired package-manager version yourself; the toolkit invokes the selected executable on PATH.
2. Otherwise detect `bun.lock` or `bun.lockb`, `pnpm-lock.yaml`, or `package-lock.json` or `npm-shrinkwrap.json`.
3. Without metadata or a recognized lockfile, the manager defaults to npm, but automatic installation still requires a committed npm lockfile.

Multiple lockfile families without explicit metadata are ambiguous and fail. Unsupported `packageManager` values fail. A stale lockfile from another manager does not override explicit metadata, but the selected manager must have its own lockfile. Frozen installs never generate a replacement lockfile. A failed install stops setup; it does not silently try another manager.

pnpm workspaces must include a `pnpm-workspace.yaml` covering the backend/frontend packages. Dependency binaries resolve from their owning workspace first, so root-level hoisting is not required. If pnpm requires dependency-build approval, review the required packages in your application and commit its build-policy settings before noninteractive setup. The toolkit preserves those settings and reports install failures. See [pnpm build approvals](https://pnpm.io/cli/approve-builds). The toolkit never uses `npx`, `pnpm dlx` or `bunx` to download a missing CLI.

Install command references: [Bun](https://bun.sh/docs/pm/cli/install), [pnpm](https://pnpm.io/cli/install), [npm](https://docs.npmjs.com/cli/commands/npm-ci).

## Daily use

Once the tooling is on the selected base branch on `origin`, create and provision a new branch and checkout from its freshly fetched remote ref:

```sh
node scripts/worktree/cli.mjs setup --path ../app-feature --branch feature/my-change
cd ../app-feature
node scripts/worktree/cli.mjs start
```

New-worktree setup installs dependencies with the detected manager. An editor can also create the checkout itself; install dependencies and run ordinary setup there. Setup provisions and pushes the app's actual schema/components, then exits. Start runs the supervisor. Use the `dev` package script for a foreground session. Do not start a second backend in an already running checkout.

After adding the package scripts, use your manager's runner:

| Manager | Setup | Start |
| --- | --- | --- |
| Bun | `bun run worktree:setup` | `bun run worktree:start` |
| pnpm | `pnpm run worktree:setup` | `pnpm run worktree:start` |
| npm | `npm run worktree:setup` | `npm run worktree:start` |

For npm, put `--` before lifecycle arguments, for example `npm run worktree:setup -- --path ../app-feature --branch feature/my-change`. Direct Node commands work with all three managers.

Setup resolves the remote default or explicit `baseBranch`, fetches it from `origin` and stops on resolution or fetch failure. It fast-forwards stale checkouts and the corresponding local base branch when safe, and preserves topic commits already based on the fetched base. Dirty files or divergence stop setup rather than resetting, stashing or discarding changes. Rebase or merge deliberately, then retry.

## Stop, teardown and cleanup

| Command | Processes | Port reservations | Local database |
| --- | --- | --- | --- |
| `worktree:stop` | Stops owned processes | Retained | Retained |
| `worktree:teardown` | Stops owned processes | Released | Retained |
| `worktree:cleanup --yes` | Stops owned processes | Released | Deleted with owned generated configuration |
| `worktree:prune` | Does not kill processes | Removes eligible stale reservations | Preserved |

Run lifecycle commands directly as `node scripts/worktree/cli.mjs <command>`, or use your package manager's `run` command. Cleanup requires explicit `--yes`:

| Manager | Cleanup through package scripts |
| --- | --- |
| Bun | `bun run worktree:cleanup --yes` |
| pnpm | `pnpm run worktree:cleanup --yes` |
| npm | `npm run worktree:cleanup -- --yes` |

Teardown does not remove Git branches or checkout directories. Run it before your editor or Git removes a checkout. Deleting that directory also deletes any database inside it, even though teardown itself preserves data.

After teardown, another checkout can claim the released ports. Restart reclaims them only if free. If reassigned, the command fails clearly. Explicit cleanup and fresh setup allocate new state and ports, but cleanup deletes the old database. Preserve anything needed first.

Before signalling, the recorded supervisor PID must match the expected script path and ownership token. Shutdown forwards SIGINT to Convex and waits for ports to close. The scripts never kill by port or broad process name. If SIGKILL leaves an orphan, inspect ownership before manually retiring it.

Prune removes a reservation only when managed checkout state is absent and every reserved port is free. Keep the same registry throughout setup/start/teardown; do not assign a different `WORKTREE_REGISTRY_DIR` to each worktree.

## Isolation and stable ports

Each checkout owns its database, `.worktree/home`, `.worktree/cache` and environment selection. Bootstrap uses the noninteractive anonymous flow; later runs use verified project-local anonymous agent mode. Inherited Convex selectors are removed from the backend child's environment.

The per-user host registry `~/.local/state/convex-worktrees/leases.json` allocates distinct stable frontend, backend and site ports. Every backend start passes both `--local-cloud-port` and `--local-site-port`. Locks coordinate allocation and lifecycle operations. Starts serialize cache/dashboard provisioning while running backends remain concurrent.

With the sample layout, the database is in `packages/backend/.convex/local/default/`. Managed state and generated secrets live in `.worktree/`. Do not copy these between checkouts, commit them or upload their environment/log files. Secret/configuration files use restricted permissions.

## Editors, agents and CI

Use the same lifecycle from any tool that runs shell commands. A setup hook should install dependencies and run setup, then exit. A teardown hook should run `node scripts/worktree/cli.mjs teardown` before removing the checkout.

For CI, provide access to `origin`, its advertised default branch or configured `baseBranch`, and enough Git history for ancestry checks. Install Git, Node and the selected package manager, then run setup/start, your tests and teardown in an always-run cleanup step. Abrupt machine termination cannot guarantee cleanup, so prune stale reservations on persistent hosts. CI runner selection belongs to the consuming application.

## Tests

From this toolkit repository:

```sh
node scripts/check.mjs
```

This runs the dependency-free lifecycle/freshness tests and verifies installation, hashes, overwrite refusal and symlink refusal. The toolkit checks and installer use Node built-ins; no separate installer runtime or dependency install is required. The check command does not invoke a package manager.

The optional real-backend integration test runs inside a consuming application, not this toolkit. It is skipped here because there is no application backend. To use it:

1. Merge the table in `examples/schema.ts` into your application's Convex schema.
2. Copy `examples/probe.ts` into your app's Convex function directory as `probe.ts`.
3. Keep these probe functions local to your development/test backend; they are unauthenticated and are not intended for a public deployment.
4. Commit the test setup and required lockfile to the app's selected remote base branch, then run `node --test scripts/worktree/worktree.integration.mjs` from a clean app checkout.

The integration test deploys the app schema in two temporary worktrees, writes different probe records, verifies database isolation and restart persistence, tests busy-port refusal and checks sibling-safe teardown/cleanup. It exercises backends only; test your frontend separately if using the optional frontend adapter. Adapt the probe operations if your app's schema or auth needs another test strategy.

## Working on this toolkit

This repository follows the same [PR standard](docs/pull-request-standard.md) and worktree lifecycle as the applications adopting it. Its own adapter sets `convex: false` and `frontend: false`, because the toolkit has no application backend or development server.

```sh
node scripts/worktree/cli.mjs setup
node scripts/check.mjs
node scripts/worktree/cli.mjs teardown
# Remove only this checkout's owned identity when finished:
node scripts/worktree/cli.mjs cleanup --yes
```

In this backend-free mode, setup still fetches the selected base and records checkout ownership. Start, stop and teardown validate that identity but launch no services or reserve ports. Explicit cleanup removes only the owned identity file and preserves unrelated files. Creating a dependency-free toolkit worktree does not require a package-manager install or an artificial lockfile.

The installer exports `scripts/worktree.config.example.json` as the adopting application's `scripts/worktree.config.json`. Those app defaults enable Convex; the toolkit's own backend-free adapter is never copied into an application.

Run `node scripts/check.mjs` before submitting a PR. It includes lifecycle, installer and PR-standard tests, then verifies the installed export and its tests in a path containing spaces. CI runs these checks on UbiCloud. The PR metadata workflow executes trusted base-branch code; activation and required-status protection are separate concerns described in the PR standard.

## Modules

- `cli.mjs` and `commands.mjs`: command entry points and dispatch.
- `context.mjs`: repository and layout paths.
- `freshness.mjs`: remote base-branch resolution, refresh checks and safe fast-forward behavior.
- `registry.mjs`: locking, reservations and port probes.
- `dependencies.mjs`: package-manager detection, frozen installs and workspace-local CLI resolution.
- `config.mjs` and `files.mjs`: state validation, environment selection and safe file operations.
- `processes.mjs`: owned process supervision and graceful shutdown.
- `lifecycle.mjs`: setup, teardown, cleanup and prune.
- `installer.mjs`: verified source copying used by the Node installation entry point.

`manifest.json` records checksums for the exported implementation, configuration and tests. Update the hashes when adapting files before reusing the installer.

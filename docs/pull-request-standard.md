# Pull request standard

Work is tracked on commits. A feature branch can carry many commits, each tied
to its own Linear ticket, so the ticket belongs on the commit and the PR title
does not have to carry one.

## Titles

Every pull request, including bot and dependency PRs, uses a Conventional Commit
title:

```text
type(scope): short description
```

Use a lowercase type: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`,
`test`, `build`, `ci`, `chore`, or `revert`. The scope is optional. For a
breaking change, put `!` before the colon. A single-ticket PR may put the
uppercase ticket ID first in the description, and must then declare it in
Summary. Examples:

```text
fix(auth): correct session expiry
fix(auth): FANT-65 correct session expiry
feat(api)!: require authenticated requests
```

## Commits

Every non-merge commit says which ticket it works on. Put a Linear magic word
and the ticket ID on its own line in the commit body:

```text
feat(billing): add invoice export

Fixes FANT-65
```

Use a closing word such as `Fixes` only when the commit completes the ticket,
and a non-closing word such as `Refs` for partial work. Outside contributors
without Linear access reference a GitHub issue the same way, as `#42`,
`owner/repo#42` or a full `https://github.com/.../issues/42` URL:

```text
fix(cli): handle missing config file

Fixes #42
```

A commit that works on no ticket or issue carries a footer with the reason:

```text
docs: fix typo in README

No-ticket: comment-only fix
```

Linear links a commit only through a magic word; a bare ID is not enough. It
moves the ticket to In Progress when the commit is pushed and to Done when the
commit reaches the default branch. When a PR is squash-merged, the squash
message is built from the PR title and body, so the Summary declarations below
end up on the merged commit too. Merge commits are exempt.

Outside contributors follow the shared
[contributing guide](https://github.com/FantasticDevHQ/.github/blob/main/CONTRIBUTING.md);
keep its Commits and Pull requests sections consistent with this standard.

Use the organization default PR template, served from
[FantasticDevHQ/.github](https://github.com/FantasticDevHQ/.github/blob/main/.github/pull_request_template.md),
and fill in these level-two headings exactly once, in order:

| Section  | Required content                                                       |
| -------- | ---------------------------------------------------------------------- |
| Summary  | Resulting behavior and a link to the ticket named in the title.        |
| What     | Concrete changes and scope.                                            |
| Why      | The problem, its impact, and the reason for this approach.             |
| Evidence | Actual verification, results, what they prove, and limitations.        |
| Agent    | Agent name, actual session/thread ID, and session link when available. |

Keep the acceptance checklist after Agent. HTML comments, empty sections, and
placeholders such as `TBD`, `N/A`, and `Pending` do not satisfy the standard.

## Linear linkage

In Summary, declare every ticket the PR works on, on standalone lines outside
comments and code. The validator requires a declaration for every ticket that
any commit references, and for the title ticket when there is one. Several IDs
may follow one word:

```text
Fixes FANT-65, FANT-66
Refs FANT-70
```

| Declaration          | Use                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `Fixes FANT-123`      | The ticket is completed. Linear applies its configured merged status.                     |
| `Refs FANT-123`       | Partial work. Other workflow automation can run, but merge does not apply merged status.  |
| `Relates to FANT-123` | An informational relation with no status automation.                                      |

A raw full Linear issue URL may replace an ID. A GitHub issue reference
(`Fixes #42`, `Refs owner/repo#42` or a full issue URL) satisfies the Summary
declaration for outside contributors; it never substitutes for a Linear ticket
that a commit or the title references. Every target on a declaration line must
be a valid ticket or issue. The validator also accepts
Linear's other documented closing, non-closing, and relation words, such as
`Closes`, `Implements`, `References`, `Part of`, and `Related to`. A PR that works
on no ticket or issue states `No ticket: <reason>` in Summary instead. A feature PR also
links its Linear project.

Linear does not re-detect tickets that were linked by earlier merges into a
feature branch when that branch merges to the default branch. The feature PR's
Summary must list them again; the validator enforces this through the commits.

An ordinary Markdown ticket link is context, not a declaration. Magic words in
PR comments do not create Linear associations. These rules follow
[Linear's GitHub integration documentation](https://linear.app/docs/github).

### One-time Linear setup per team

Native linking requires the correct Linear workspace's GitHub integration with
access to the organization and repository. In Linear, under Settings > Team >
Workflows & automations:

1. Enable **Link commits to issues with magic words**, and add the GitHub push
   webhook that Linear shows. Commit linking works with one GitHub organization.
2. Optionally add branch-specific rules for the PR target branch. For example,
   a merge into `^feat/.*` sets an "Integrated" status and a merge into `main`
   sets Done. Rules apply to target branches only.

Check these when a correctly declared PR or commit does not appear in Linear.
GitHub autolinks, Markdown links, and GitHub issue sync are separate from
Linear's native association.

Evidence must include a reviewer-accessible HTTPS link or fenced test, log, or API
output. Explain which checks passed and what the result demonstrates. A bare
"tests passed" statement, local filesystem path, or promise of future testing does
not count. Keep evidence current after material changes and remove private data.
The automated check validates structure and the presence of proof, not the truth
of a result, ticket existence, link permissions, or whether coverage is sufficient.
Reviewers assess those details.

In Evidence, explicitly declare `UI changes: Yes` or `UI changes: No`.
UI changes require screenshots and/or video of the affected flow, uploaded
through GitHub attachments or published as a GitHub Actions artifact (for
example a recording from an end-to-end job, which agents without a browser can
produce). At least one is required; both are welcome when useful.
Embed screenshots inline and label the proof fields you include:

```markdown
UI changes: Yes

- Screenshot: ![Affected flow](https://github.com/user-attachments/assets/UPLOAD_ID)
- Video: https://github.com/user-attachments/assets/RECORDING_ID
- Video: https://github.com/OWNER/REPO/actions/runs/RUN_ID/artifacts/ARTIFACT_ID
```

Upload attachments with the GitHub CLI rather than a browser: write the local
reference on the labeled line (`- Screenshot: ![Affected flow](./flow.png)`), then
run `gh pr edit <n> --body-file body.md --attach './flow.png#Affected flow'` (also
`gh pr create` and `gh pr comment`). `gh` uploads the file and rewrites the
reference to the attachment URL.

The validator inspects changed frontend files, styles, markup, and image assets,
excluding tests and fixtures. Detected UI files require visual proof even
if the declaration says No. Declare Yes for UI changes in other file types too,
such as server-rendered templates in backend code. Use GitHub upload or Actions artifact URLs.
Reviewers verify the media actually demonstrate
the affected flow; the validator checks references, not image or video contents.
Backend,
package, and CI changes can use test results, logs, or API output. Do not commit
evidence files to the repository or use them as developer documentation.

In Agent, use these fields:

```markdown
## Agent

- Agent: Codex
- Session/thread ID: actual-thread-id
- Session link: codex://threads/actual-thread-id
```

Agent and Session/thread ID are required, and placeholders fail validation.
Use the actual creating agent/session, not the session of an unrelated reviewer.
For automation, use the bot name, run ID, and workflow/run URL. For human-only
PRs, identify the author and use `human-authored` as the session/thread ID.
Include a session link when available; model/version, GitHub submitter, and a
parent/delegating thread ID are useful optional fields. Record only known values.

The `PR standard` workflow reads current PR metadata on opening, editing,
reopening, pushes, and readiness for review. Invalid PRs receive a failing
`PR standard` commit status and one bot comment listing corrections. Later runs
update that comment; correcting the metadata changes it to a passing message.
PRs remain open so authors can fix them. Status publication alone does not block
merging. Required-status protection must be configured and verified separately
through a supported branch-protection rule or ruleset. Check that it requires
`PR standard` and inspect its bypass rules before describing merges as blocked.
Repository visibility, plan support and organization policy can limit protection;
record those limitations rather than treating a passing status as enforcement.
This metadata check does not replace code review or execution checks.

The workflow grants explicit contents-read, PR-write, issue-write, and status-write
permissions to fetch metadata/files, update feedback, and publish statuses.
It runs trusted base-branch scripts only, with no PR code execution or
dependency installation. It publishes the status on the PR head SHA explicitly,
so metadata edits can clear a failure without another commit. Operators can use
the workflow's manual PR-number input to revalidate existing PRs or retry an API
failure. Test the validator and bot behavior without installing dependencies:

```sh
node --test scripts/pr-standard.test.mts scripts/enforce-pr-standard.test.mts
```

The equivalent package script is `test:pr-standard`, invoked with your package
manager's `run` command. The repository's aggregate check is
`node scripts/check.mjs`. The parser accepts LF, CRLF and lone-CR PR bodies.
After a pending status is published, unexpected enforcement errors trigger a
best-effort failure status and rethrow the original error. A second status API
failure cannot replace that original error.

## CI compute

The `Check` workflow runs the Node 22.18 and 24 suites as separate matrix jobs.
Its stable `test` job succeeds only when the entire matrix succeeds, then
`Repository quality gates` requires that result. Keep the `test` check name
stable because branch protection requires that exact context. Matrix display
names such as `test (24)` do not satisfy a requirement for `test`.

The metadata job uses `ubicloud-standard-2-ubuntu-2404`, the default Linux
UbiCloud runner. GitHub Actions schedules the workflow; repository Actions and
the UbiCloud integration's repository access must both remain enabled. A queued
job without a runner calls for checking integration access, not changing providers.

## Activation and verification

`pull_request_target` uses the workflow and trusted checkout from the PR's base
branch. Initial enforcement activates only after this workflow and its scripts
exist on that base. The PR that introduces them cannot prove automatic
base-branch execution before its initial merge. Its local unit tests and actual
PR title/body can be verified before merge, but that is a separate check.

After the workflow is present on the default branch, dispatch it from that trusted
branch with an open PR number to verify the normal path. Editing a PR or pushing
a new commit also requests automatic validation. Do not check out or execute
untrusted PR-head code with the write token. Keep manual dispatches limited to
trusted workflow/script revisions.

Verify the actual job labels, runner name/ID and terminal result through the
Actions jobs API before reporting a successful UbiCloud run. A local pass does
not establish runner execution or required-status merge protection. The workflow
keeps its explicit permissions, five-minute timeout and trusted-base checkout.

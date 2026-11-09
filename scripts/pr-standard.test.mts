import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePullRequest } from "./pr-standard.mts";

const title = "ci(github): FANT-65 enforce PR standards";
const body = `## Summary
Require consistent pull requests.
Refs FANT-65
## What
Add a metadata validator and template.
## Why
Reviewers need context and reproducible verification.
## Evidence
UI changes: No
Validator regression tests passed: https://github.com/FantasticDevHQ/convex-worktrees/actions/runs/123
## Agent
- Agent: Codex
- Session/thread ID: fixture-session-123
`;

test("accepts conventional types, optional scopes and breaking-change markers", () => {
  for (const type of [
    "feat",
    "fix",
    "docs",
    "style",
    "refactor",
    "perf",
    "test",
    "build",
    "ci",
    "chore",
    "revert",
  ]) {
    for (const suffix of ["", "(github)", "!", "(github)!"]) {
      assert.deepEqual(
        validatePullRequest({
          title: `${type}${suffix}: FANT-65 enforce PR standards`,
          body,
        }),
        [],
      );
    }
  }
});

test("rejects inconsistent titles and missing or misplaced ticket IDs", () => {
  for (const invalid of [
    "Enforce PR standards",
    "ci: enforce FANT-65 PR standards",
    "ci: FANT-0 enforce PR standards",
    "CI: FANT-65 enforce PR standards",
    "other: FANT-65 enforce PR standards",
    "ci: FANT-65",
    "ci: fant-65 enforce PR standards",
  ]) {
    assert.ok(validatePullRequest({ title: invalid, body }).length, invalid);
  }
});

test("requires each section, in order, with visible non-placeholder content", () => {
  for (const section of ["Summary", "What", "Why", "Evidence", "Agent"]) {
    const start = body.indexOf(`## ${section}`);
    const end = body.indexOf("## ", start + 3);
    const prefix = body.slice(0, start);
    const suffix = end < 0 ? "" : body.slice(end);
    for (const content of [
      "",
      "<!-- Explain this -->",
      "TBD",
      "- [ ] TODO", // FANT-65: reject unchecked placeholder evidence.
      "N/A",
      "Pending",
      "Not run",
    ]) {
      assert.ok(
        validatePullRequest({
          title,
          body: `${prefix}## ${section}\n${content}\n${suffix}`,
        }).length,
        `${section}: ${content}`,
      );
    }
    assert.ok(validatePullRequest({ title, body: prefix + suffix }).length);
  }
  assert.ok(
    validatePullRequest({
      title,
      body: body
        .replace("## What", "## Why")
        .replace("## Why\nReviewers", "## What\nReviewers"),
    }).length,
  );
  assert.ok(
    validatePullRequest({ title, body: `${body}\n## What\nDuplicate section` })
      .length,
  );
});

test("ignores headings hidden in comments or fenced examples", () => {
  assert.ok(validatePullRequest({ title, body: `<!--\n${body}\n-->` }).length);
  for (const fence of ["```", "~~~~"]) {
    assert.ok(
      validatePullRequest({ title, body: `${fence}md\n${body}\n${fence}` })
        .length,
    );
  }
});

test("requires a reviewer-accessible proof link or pasted output", () => {
  const replaceEvidence = (evidence: string) =>
    body.replace(/Validator regression tests passed:[^\n]*/, evidence);
  for (const evidence of [
    "Tests passed.",
    "See /tmp/test.log",
    "[Log](file:///tmp/log)",
    "https://localhost:3000",
    "https://example.com/proof",
    "```text\nTBD\n```",
    "<!-- https://github.com/org/repo/actions/runs/123 -->",
  ]) {
    assert.ok(
      validatePullRequest({ title, body: replaceEvidence(evidence) }).length,
      evidence,
    );
  }
  assert.deepEqual(
    validatePullRequest({
      title,
      body: replaceEvidence(
        "Local validator result:\n```text\n12 tests passed, 0 failed\n```",
      ),
    }),
    [],
  );
  assert.deepEqual(
    validatePullRequest({
      title,
      body: `${body}\n## Acceptance checklist\n- [x] Verified`,
    }),
    [],
  );
});

test("handles absent metadata without throwing", () => {
  assert.ok(validatePullRequest({}).length);
});

test("requires explicit linkage intent for the title ticket in Summary", () => {
  for (const declaration of [
    "Fixes FANT-65",
    "Refs FANT-65",
    "Relates to FANT-65",
    "Closes FANT-65",
    "Implements FANT-65",
    "References FANT-65",
    "Part of FANT-65",
    "Contributes to FANT-65",
    "Towards FANT-65",
    "Related to FANT-65",
    "Refs https://linear.app/example/issue/FANT-65/require-pr-standards",
  ]) {
    assert.deepEqual(
      validatePullRequest({
        title,
        body: body.replace("Refs FANT-65", declaration),
      }),
      [],
      declaration,
    );
  }
  for (const declaration of [
    "",
    "FANT-65",
    "[FANT-65](https://linear.app/example/issue/FANT-65)",
    "Refs FANT-650",
    "Fixes FANT-66",
    "Refs https://example.com/issue/FANT-65",
    "Refs https://linear.app/example/issue/FANT-66/wrong-ticket",
    "Refs FANT-65\nFixes FANT-65",
    "`Refs FANT-65`",
    "<!-- Refs FANT-65 -->",
    "```text\nRefs FANT-65\n```",
  ]) {
    assert.ok(
      validatePullRequest({
        title,
        body: body.replace("Refs FANT-65", declaration),
      }).some((error) => error.includes("linkage")),
      declaration,
    );
  }
  assert.ok(
    validatePullRequest({
      title,
      body: body
        .replace("Refs FANT-65", "")
        .replace("## What", "## What\nRefs FANT-65"),
    }).some((error) => error.includes("linkage")),
  );
});

test("requires the Agent section and identifies its agent and session", () => {
  assert.ok(
    validatePullRequest({ title, body: body.split("## Agent")[0] }).some(
      (error) => error.includes("Agent"),
    ),
  );
  for (const agent of [
    "Codex submitted this PR.",
    "- Agent: Codex",
    "- Session/thread ID: session-123",
    "- Agent: TBD\n- Session/thread ID: session-123",
    "- Agent: Codex\n- Session/thread ID: N/A",
    "- Agent:\n- Session/thread ID: session-123",
    "- Agent: Codex\n- Session/thread ID:\n- Session link: unavailable",
    "```text\n- Agent: Codex\n- Session/thread ID: session-123\n```",
    "<!-- - Agent: Codex\n- Session/thread ID: session-123 -->",
  ]) {
    assert.ok(
      validatePullRequest({
        title,
        body: `${body.split("## Agent")[0]}## Agent\n${agent}`,
      }).length,
      agent,
    );
  }
  assert.ok(
    validatePullRequest({
      title,
      body: body
        .replace("## Evidence", "## Agent")
        .replace("## Agent\n- Agent", "## Evidence\n- Agent"),
    }).some((error) => error.includes("Order")),
  );
});

test("requires a UI declaration and uploaded screenshot or video for UI changes", () => {
  const screenshot =
    "- Screenshot: ![Updated flow](https://github.com/user-attachments/assets/screenshot-123)";
  const video = "- Video: https://github.com/user-attachments/assets/video-456";
  const uiBody = body.replace("UI changes: No", "UI changes: Yes");
  const proof = (text: string) =>
    text.replace("## Agent", `${screenshot}\n${video}\n## Agent`);
  assert.ok(
    validatePullRequest({ title, body: body.replace("UI changes: No", "") })
      .length,
  );
  assert.ok(validatePullRequest({ title, body: uiBody }).length);
  assert.ok(
    validatePullRequest({
      title,
      body: uiBody.replace(
        "## Agent",
        `\`\`\`markdown\n${screenshot}\n${video}\n\`\`\`\n## Agent`,
      ),
    }).length,
  );
  assert.deepEqual(
    validatePullRequest({
      title,
      body: proof(uiBody).replace(`${video}\n`, ""),
    }),
    [],
  );
  assert.deepEqual(
    validatePullRequest({
      title,
      body: proof(uiBody).replace(`${screenshot}\n`, ""),
    }),
    [],
  );
  assert.deepEqual(
    validatePullRequest({
      title,
      body: proof(uiBody).replace("video-456", "screenshot-123"),
    }),
    [],
  );
  assert.ok(
    validatePullRequest({
      title,
      body: proof(uiBody).replaceAll(
        "https://github.com/user-attachments/assets/",
        "https://example.org/",
      ),
    }).length,
  );
  assert.deepEqual(validatePullRequest({ title, body: proof(uiBody) }), []);
  for (const path of [
    "apps/web/src/App.tsx",
    "apps/web/styles.css",
    "apps/web/logo.svg",
  ]) {
    assert.ok(validatePullRequest({ title, body }, [path]).length, path);
    assert.deepEqual(
      validatePullRequest({ title, body: proof(body) }, [path]),
      [],
    );
  }
  assert.deepEqual(
    validatePullRequest({ title, body }, ["apps/web/tests/ui.test.tsx"]),
    [],
  );
});

test("accepts CRLF and lone CR bodies including linkage after fenced examples", () => {
  const withFences = body
    .replace("Refs FANT-65", "```md\nRefs FANT-99\n```\nRefs FANT-65")
    .replace(
      /Validator regression tests passed:[^\n]*/,
      "```text\n15 tests passed, 0 failed\n```",
    );
  for (const ending of ["\r\n", "\r"]) {
    assert.deepEqual(
      validatePullRequest({ title, body: withFences.replace(/\n/g, ending) }),
      [],
    );
  }
});

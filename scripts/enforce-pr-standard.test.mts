import type { GitHubApi } from "./enforce-pr-standard.mts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { enforcePullRequestStandard } from "./enforce-pr-standard.mts";

test("metadata workflow grants the API permissions its enforcer requires", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/pr-standard.yml", import.meta.url),
    "utf8",
  );
  const permissions = workflow.match(
    /^permissions:\n((?: {2}\S[^\n]*\n)+)/m,
  )?.[1];
  assert.ok(permissions, "workflow must declare explicit token permissions");
  for (const permission of [
    "contents: read",
    "pull-requests: write",
    "issues: write",
    "statuses: write",
  ]) {
    assert.ok(permissions.split("\n").includes(`  ${permission}`), permission);
  }
  assert.doesNotMatch(
    workflow,
    /^\s+permissions:/m,
    "job permissions must not override the workflow contract",
  );
});

const valid = {
  title: "ci: FANT-65 enforce PR standards",
  body: "## Summary\nRequire PR context.\nRefs FANT-65\n## What\nValidate metadata.\n## Why\nReduce incomplete reviews.\n## Evidence\nUI changes: No\n```text\n6 tests passed\n```\n## Agent\n- Agent: Codex\n- Session/thread ID: session-123",
  state: "open",
  head: { sha: "abc123" },
};

function fixture(pr: typeof valid, comments: { id: number; user: { login: string; type: string }; body: string }[] = []) {
  const calls: { method: string; path: string; data?: Record<string, any> }[] = [];
  const api: GitHubApi = async (method, path, data) => {
    calls.push({ method, path, data });
    if (path === "/pulls/65") return pr;
    if (path.startsWith("/pulls/65/files?")) return [];
    if (path.startsWith("/issues/65/comments?")) return comments;
    return {};
  };
  return {
    calls,
    run: () =>
      enforcePullRequestStandard({
        api,
        number: 65,
        runUrl: "https://github.com/FantasticDevHQ/convex-worktrees/actions/runs/123",
      }),
  };
}

test("invalid PR fails its own head status and receives actionable feedback", async () => {
  const { calls, run } = fixture({
    ...valid,
    title: "Missing ticket",
    body: "",
  });
  assert.equal(await run(), false);
  assert.equal(calls.at(-1)!.path, "/statuses/abc123");
  assert.equal(calls.at(-1)!.data!.state, "failure");
  const comment = calls.find((call) => call.path === "/issues/65/comments");
  assert.match(comment!.data!.body, /Summary/);
  assert.match(comment!.data!.body, /TICKET-123/);
});

test("corrected PR updates the bot comment and passes without comment spam", async () => {
  const { calls, run } = fixture(valid, [
    {
      id: 42,
      user: { login: "github-actions[bot]", type: "Bot" },
      body: "<!-- pr-standard -->\nOld failure",
    },
  ]);
  assert.equal(await run(), true);
  assert.match(
    calls.find((call) => call.method === "PATCH")!.data!.body,
    /PR standard passed/,
  );
  assert.equal(calls.at(-1)!.data!.state, "success");
  assert.equal(
    calls.filter((call) => call.path === "/issues/65/comments").length,
    0,
  );
});

test("does not trust a user-authored copy of the bot marker", async () => {
  const { calls, run } = fixture({ ...valid, body: "" }, [
    {
      id: 1,
      user: { login: "contributor", type: "User" },
      body: "<!-- pr-standard -->",
    },
  ]);
  await run();
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 0);
  assert.ok(calls.some((call) => call.path === "/issues/65/comments"));
});

test("valid PR needs no new comment; closed PRs receive no writes", async () => {
  const good = fixture(valid);
  assert.equal(await good.run(), true);
  assert.equal(good.calls.filter((call) => call.method === "POST").length, 2);
  const closed = fixture({ ...valid, state: "closed" });
  assert.equal(await closed.run(), true);
  assert.equal(closed.calls.length, 1);
});

test("API failure publishes a terminal failure status and rethrows the original error", async () => {
  const states: unknown[] = [];
  const api: GitHubApi = async (method, path, data) => {
    if (path === "/pulls/65") return valid;
    if (path.startsWith("/pulls/65/files?")) return [];
    if (path.startsWith("/statuses/")) states.push(data!.state);
    if (path.includes("comments")) throw new Error("GitHub unavailable");
  };
  await assert.rejects(
    enforcePullRequestStandard({
      api,
      number: 65,
      runUrl: "https://github.com/run",
    }),
    /GitHub unavailable/,
  );
  assert.deepEqual(states, ["pending", "failure"]);
});

test("a failed failure-status update does not mask the original API error", async () => {
  const original = new Error("Comment listing failed");
  const states: unknown[] = [];
  const api: GitHubApi = async (method, path, data) => {
    if (path === "/pulls/65") return valid;
    if (path.startsWith("/pulls/65/files?")) return [];
    if (path.startsWith("/statuses/")) {
      states.push(data!.state);
      if (data!.state === "failure")
        throw new Error("Status publication failed");
    }
    if (path.includes("comments")) throw original;
  };
  await assert.rejects(
    enforcePullRequestStandard({
      api,
      number: 65,
      runUrl: "https://github.com/run",
    }),
    (error) => error === original,
  );
  assert.deepEqual(states, ["pending", "failure"]);
});

import path from "node:path";
import { projectLock } from "./registry.mjs";
import { execFileSync } from "node:child_process";
// Only fast-forward: user commits, edits and conflicts always remain intact.
export async function refreshCheckout(root) {
  let common;
  try {
    common = execFileSync(
      "git",
      ["-C", root, "rev-parse", "--git-common-dir"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch {
    return;
  }
  return projectLock(
    () => refreshUnlocked(root),
    `git:${path.resolve(root, common)}`,
  );
}
async function refreshUnlocked(root) {
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    git("rev-parse", "--git-dir");
  } catch {
    return;
  } // Non-Git layout fixtures.
  try {
    git("fetch", "origin", "main");
  } catch {
    throw new Error(
      "Could not fetch origin/main. Check remote access and rerun setup; no checkout changes were made.",
    );
  }
  if (git("status", "--porcelain"))
    throw new Error(
      "Checkout has uncommitted/dirty files. Commit or move your changes before setup; no files were discarded.",
    );
  const base = git("rev-parse", "origin/main"),
    head = git("rev-parse", "HEAD");
  const ancestor = (a, b) => {
    try {
      git("merge-base", "--is-ancestor", a, b);
      return true;
    } catch {
      return false;
    }
  };
  if (head !== base && !ancestor(base, head)) {
    if (!ancestor(head, base))
      throw new Error(
        "Checkout diverged from origin/main. Rebase or merge explicitly before setup; local commits were preserved.",
      );
    git("merge", "--ff-only", base);
  }
  let main;
  try {
    main = git("rev-parse", "refs/heads/main");
  } catch {
    return;
  }
  if (main === base) return;
  if (!ancestor(main, base))
    throw new Error(
      "Local main has commits divergent from origin/main. Resolve explicitly; main was preserved.",
    );
  const worktrees = git("worktree", "list", "--porcelain");
  const checked = worktrees
    .split("\n\n")
    .find((block) => block.includes("branch refs/heads/main"));
  if (checked && !checked.startsWith(`worktree ${root}\n`)) {
    const checkout = checked.split("\n")[0].slice("worktree ".length);
    const inMain = (...args) =>
      execFileSync("git", ["-C", checkout, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    if (inMain("status", "--porcelain"))
      throw new Error(
        "Local main checkout has dirty/uncommitted files. Preserve and resolve those changes there before setup.",
      );
    if (inMain("symbolic-ref", "--short", "HEAD") !== "main")
      throw new Error(
        "Main checkout changed branches during setup. Retry after other Git operations finish.",
      );
    try {
      inMain("merge", "--ff-only", base);
    } catch {
      throw new Error(
        "Could not safely fast-forward the main checkout. Resolve its state explicitly and rerun setup; no reset or stash was attempted.",
      );
    }
  }
  if (!checked) git("update-ref", "refs/heads/main", base, main);
}

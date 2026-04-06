/**
 * Utilities for creating and tearing down temporary git repos for e2e tests.
 *
 * All repos are created under `$TMPDIR/git-switchboard-e2e/<testId>/`.
 */

import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface FixtureRepo {
  /** Absolute path to the repo */
  path: string;
  /** The test-scoped root directory (parent of the repo) */
  root: string;
  /** Unique test id */
  testId: string;
}

function git(cwd: string, cmd: string) {
  execSync(`git ${cmd}`, { cwd, stdio: "pipe", encoding: "utf-8" });
}

/**
 * Create a fixture git repo with a few branches.
 *
 * Layout:
 *   - `main` branch with one commit
 *   - `feature/alpha` branch (1 commit ahead of main)
 *   - `feature/beta` branch (1 commit ahead of main)
 */
export function createFixtureRepo(): FixtureRepo {
  const testId = randomBytes(6).toString("hex");
  const root = join(tmpdir(), "git-switchboard-e2e", testId);
  const repoPath = join(root, "repo");

  mkdirSync(repoPath, { recursive: true });

  git(repoPath, "init -b main");
  git(repoPath, 'config user.name "E2E Test"');
  git(repoPath, 'config user.email "e2e@test.local"');
  git(repoPath, "config commit.gpgsign false");

  // Initial commit on main
  writeFileSync(join(repoPath, "README.md"), "init\n");
  git(repoPath, "add .");
  git(repoPath, 'commit -m "initial commit"');

  // feature/alpha
  git(repoPath, "checkout -b feature/alpha");
  writeFileSync(join(repoPath, "alpha.txt"), "alpha\n");
  git(repoPath, "add .");
  git(repoPath, 'commit -m "add alpha"');

  // feature/beta (branch off main)
  git(repoPath, "checkout main");
  git(repoPath, "checkout -b feature/beta");
  writeFileSync(join(repoPath, "beta.txt"), "beta\n");
  git(repoPath, "add .");
  git(repoPath, 'commit -m "add beta"');

  // Go back to main so the starting state is predictable
  git(repoPath, "checkout main");

  return { path: repoPath, root, testId };
}

/** Remove the entire test directory. */
export function teardownFixture(fixture: FixtureRepo) {
  rmSync(fixture.root, { recursive: true, force: true });
}

/** Get the current branch of a repo. */
export function currentBranch(repoPath: string): string {
  return execSync("git symbolic-ref --short HEAD", {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();
}

/** List local branch names for a repo. */
export function listBranches(repoPath: string): string[] {
  return execSync(
    'git for-each-ref --format="%(refname:short)" refs/heads/',
    { cwd: repoPath, encoding: "utf-8" }
  )
    .trim()
    .split("\n")
    .filter(Boolean);
}

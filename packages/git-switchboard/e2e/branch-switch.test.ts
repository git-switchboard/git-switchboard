/**
 * E2E test: verify that `npx git-switchboard` can switch branches.
 *
 * Asserts on the git state of the fixture repo, NOT on the TUI's visual output.
 */

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import {
  createFixtureRepo,
  currentBranch,
  listBranches,
  teardownFixture,
  type FixtureRepo,
} from "./fixture.js";
import {
  ARROW_DOWN,
  ENTER,
  CTRL_C,
  spawnCLI,
} from "./harness.js";

const REGISTRY = process.env.VERDACCIO_URL ?? "http://localhost:4873";

function resetToMain(cwd: string) {
  execSync("git checkout main", { cwd, stdio: "pipe" });
  assert.equal(currentBranch(cwd), "main");
}

describe("branch switch", () => {
  let fixture: FixtureRepo;

  before(() => {
    fixture = createFixtureRepo();
    assert.equal(currentBranch(fixture.path), "main");
  });

  after(() => {
    teardownFixture(fixture);
  });

  it("fixture repo has expected branches", () => {
    const branches = listBranches(fixture.path);
    assert.ok(branches.includes("main"), "missing main branch");
    assert.ok(branches.includes("feature/alpha"), "missing feature/alpha branch");
    assert.ok(branches.includes("feature/beta"), "missing feature/beta branch");
  });

  it("switches branch when enter is pressed on the first item", async () => {
    const cli = spawnCLI(fixture.path, ["--no-pr"], REGISTRY);

    // Give the TUI time to render, then press Enter on the first item
    await cli.sendKey(ENTER, 1500);
    const result = await cli.waitForExit();

    assert.equal(result.exitCode, 0, `CLI exited with code ${result.exitCode}: ${result.output}`);

    const branch = currentBranch(fixture.path);
    // The first item in the list should be a feature branch (sorted by most recent commit).
    // We don't assert the exact branch — just that it switched away from main.
    assert.notEqual(branch, "main", `Expected to switch away from main but stayed on main`);
  });

  it("switches to a different branch by navigating down", async () => {
    resetToMain(fixture.path);

    const cli = spawnCLI(fixture.path, ["--no-pr"], REGISTRY);

    // Navigate down once then press Enter — should select a different branch
    // than the first item
    await cli.sendKey(ARROW_DOWN, 1500);
    await cli.sendKey(ENTER, 200);
    const result = await cli.waitForExit();

    assert.equal(result.exitCode, 0, `CLI exited with code ${result.exitCode}: ${result.output}`);

    const branch = currentBranch(fixture.path);
    assert.notEqual(branch, "main", `Expected to switch away from main but stayed on main`);
  });

  it("exits cleanly without switching when ctrl-c is pressed", async () => {
    resetToMain(fixture.path);

    const cli = spawnCLI(fixture.path, ["--no-pr"], REGISTRY);

    await cli.sendKey(CTRL_C, 1500);
    const result = await cli.waitForExit();

    // Should still be on main — no branch switch happened
    assert.equal(
      currentBranch(fixture.path),
      "main",
      "Branch should not have changed after ctrl-c"
    );
  });
});

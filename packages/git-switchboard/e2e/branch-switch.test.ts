/**
 * E2E test: verify that git-switchboard can switch branches.
 *
 * Asserts on the git state of the fixture repo, NOT on the TUI's visual output.
 */

import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

function resetToMain(cwd: string) {
  execSync("git checkout main", { cwd, stdio: "pipe" });
  expect(currentBranch(cwd)).toBe("main");
}

describe("branch switch", () => {
  let fixture: FixtureRepo;

  beforeAll(() => {
    fixture = createFixtureRepo();
    expect(currentBranch(fixture.path)).toBe("main");
  });

  afterAll(() => {
    teardownFixture(fixture);
  });

  it("fixture repo has expected branches", () => {
    const branches = listBranches(fixture.path);
    expect(branches).toContain("main");
    expect(branches).toContain("feature/alpha");
    expect(branches).toContain("feature/beta");
  });

  it("switches branch when enter is pressed on the first item", async () => {
    const cli = spawnCLI(fixture.path, ["--no-pr"]);

    // Give the TUI time to render, then press Enter on the first item
    await cli.sendKey(ENTER, 1500);
    const result = await cli.waitForExit();

    expect(result.exitCode).toBe(0);

    const branch = currentBranch(fixture.path);
    // The first item should be a feature branch (sorted by most recent commit).
    // We don't assert the exact branch — just that it switched away from main.
    expect(branch).not.toBe("main");
  });

  it("switches to a different branch by navigating down", async () => {
    resetToMain(fixture.path);

    const cli = spawnCLI(fixture.path, ["--no-pr"]);

    // Navigate down once then press Enter
    await cli.sendKey(ARROW_DOWN, 1500);
    await cli.sendKey(ENTER, 200);
    const result = await cli.waitForExit();

    expect(result.exitCode).toBe(0);

    const branch = currentBranch(fixture.path);
    expect(branch).not.toBe("main");
  });

  it("exits cleanly without switching when ctrl-c is pressed", async () => {
    resetToMain(fixture.path);

    const cli = spawnCLI(fixture.path, ["--no-pr"]);

    await cli.sendKey(CTRL_C, 1500);
    const result = await cli.waitForExit();

    // Should still be on main — no branch switch happened
    expect(currentBranch(fixture.path)).toBe("main");
  });
});

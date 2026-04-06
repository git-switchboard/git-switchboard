/**
 * Test harness for driving the git-switchboard interactive TUI.
 *
 * Uses node-pty to allocate a real pseudo-TTY cross-platform so that
 * @opentui/core renders properly and accepts keyboard input.
 *
 * Spawns the CLI via `bunx git-switchboard` pointed at the local
 * verdaccio registry — the same flow a real user would follow.
 *
 * We intentionally avoid asserting on the visual output — instead, tests
 * observe side-effects (e.g. the current git branch) after the process exits.
 */

import { spawn as ptySpawn, type IPty } from "node-pty";

const ENTER = "\r";
const ARROW_DOWN = "\x1b[B";
const ARROW_UP = "\x1b[A";
const CTRL_C = "\x03";

export { ENTER, ARROW_DOWN, ARROW_UP, CTRL_C };

export interface HarnessResult {
  /** Combined output captured from the PTY */
  output: string;
  /** Exit code (undefined if killed by signal) */
  exitCode: number | undefined;
}

export interface CLIHarness {
  /** Send raw bytes to the PTY. */
  write(data: string): void;
  /** Send a keystroke after a short delay (ms). Returns a promise. */
  sendKey(key: string, delayMs?: number): Promise<void>;
  /** Send a sequence of keystrokes with delays between them. */
  sendKeys(keys: string[], delayMs?: number): Promise<void>;
  /** Wait for the process to exit. Rejects if timeout (ms) is exceeded. */
  waitForExit(timeoutMs?: number): Promise<HarnessResult>;
  /** Kill the process. */
  kill(): void;
  /** The underlying node-pty instance. */
  pty: IPty;
}

/**
 * Spawn `bunx git-switchboard` inside a real PTY via node-pty,
 * pulling the package from the local verdaccio registry.
 *
 * @param cwd - The git repo to run in.
 * @param args - Extra CLI args (e.g. `["--no-pr"]`).
 */
export function spawnCLI(
  cwd: string,
  args: string[] = [],
): CLIHarness {
  const registryUrl = process.env.E2E_REGISTRY_URL;
  const version = process.env.E2E_PACKAGE_VERSION;
  if (!registryUrl || !version) {
    throw new Error(
      "E2E_REGISTRY_URL / E2E_PACKAGE_VERSION not set — is the globalSetup running?"
    );
  }

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    GIT_PAGER: "",
    // Point bunx at the local verdaccio registry
    npm_config_registry: registryUrl,
  };

  const term = ptySpawn(
    "bunx",
    [`git-switchboard@${version}`, ...args],
    {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd,
      env,
    }
  );

  let output = "";
  term.onData((data: string) => {
    output += data;
  });

  const write = (data: string) => term.write(data);

  const sendKey = (key: string, delayMs = 200): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(() => {
        write(key);
        resolve();
      }, delayMs);
    });

  const sendKeys = async (keys: string[], delayMs = 200) => {
    for (const key of keys) {
      await sendKey(key, delayMs);
    }
  };

  const waitForExit = (timeoutMs = 15_000): Promise<HarnessResult> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        term.kill();
        reject(
          new Error(
            `CLI did not exit within ${timeoutMs}ms.\nOutput: ${output}`
          )
        );
      }, timeoutMs);

      term.onExit(({ exitCode }) => {
        clearTimeout(timer);
        resolve({ output, exitCode });
      });
    });

  const kill = () => term.kill();

  return { write, sendKey, sendKeys, waitForExit, kill, pty: term };
}

/**
 * Test harness for driving the git-switchboard interactive TUI.
 *
 * Uses node-pty to allocate a real pseudo-TTY cross-platform so that
 * @opentui/core renders properly and accepts keyboard input.
 *
 * We intentionally avoid asserting on the visual output — instead, tests
 * observe side-effects (e.g. the current git branch) after the process exits.
 */

import { realpathSync } from "node:fs";
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
 * Spawn git-switchboard inside a real PTY via node-pty.
 *
 * @param cwd - The git repo to run in.
 * @param args - Extra CLI args (e.g. `["--no-pr"]`).
 */
export function spawnCLI(
  cwd: string,
  args: string[] = [],
): CLIHarness {
  const binPath = process.env.E2E_BIN_PATH;
  if (!binPath) {
    throw new Error("E2E_BIN_PATH not set — is the globalSetup running?");
  }

  // Resolve through symlinks to the actual JS file in the published package.
  // We invoke it via `bun <script>` rather than the bin wrapper because
  // `bun add` prepends its own shebang to bin scripts, which combined with
  // the banner shebang in the built file causes a duplicate-shebang error.
  // Running the resolved script directly via bun still exercises the full
  // published artifact.
  const scriptPath = realpathSync(binPath);

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    GIT_PAGER: "",
  };

  const term = ptySpawn("bun", [scriptPath, ...args], {
    name: "xterm-256color",
    cols: 120,
    rows: 40,
    cwd,
    env,
  });

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

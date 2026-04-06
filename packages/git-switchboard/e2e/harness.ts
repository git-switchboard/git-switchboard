/**
 * Test harness for driving the git-switchboard interactive TUI.
 *
 * Uses the `script` command to allocate a real pseudo-TTY so that
 * @opentui/core renders properly and accepts keyboard input.
 *
 * We intentionally avoid asserting on the visual output — instead, tests
 * observe side-effects (e.g. the current git branch) after the process exits.
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTER = "\r";
const ARROW_DOWN = "\x1b[B";
const ARROW_UP = "\x1b[A";
const CTRL_C = "\x03";

export { ENTER, ARROW_DOWN, ARROW_UP, CTRL_C };

export interface HarnessResult {
  /** Combined output captured from the process */
  output: string;
  /** Exit code (null if killed by signal) */
  exitCode: number | null;
}

export interface CLIHarness {
  /** Send raw bytes to the process stdin. */
  write(data: string): void;
  /** Send a keystroke after a short delay (ms). Returns a promise. */
  sendKey(key: string, delayMs?: number): Promise<void>;
  /** Send a sequence of keystrokes with delays between them. */
  sendKeys(keys: string[], delayMs?: number): Promise<void>;
  /** Wait for the process to exit. Rejects if timeout (ms) is exceeded. */
  waitForExit(timeoutMs?: number): Promise<HarnessResult>;
  /** Kill the process. */
  kill(): void;
  /** The underlying child process. */
  proc: ChildProcess;
}

let _installDir: string | undefined;

/**
 * Install git-switchboard from the local verdaccio registry into a temp dir.
 * Caches across calls so we only install once per test run.
 */
export function ensureInstalled(registry: string): string {
  if (_installDir) return _installDir;

  const dir = join(tmpdir(), "git-switchboard-e2e-install");
  mkdirSync(dir, { recursive: true });

  // Write a bunfig.toml so bun resolves packages from verdaccio
  writeFileSync(
    join(dir, "bunfig.toml"),
    `[install]\nregistry = "${registry}"\n`
  );
  // Seed package.json so bun add works
  if (!existsSync(join(dir, "package.json"))) {
    writeFileSync(join(dir, "package.json"), '{"name":"e2e-runner","private":true}\n');
  }

  // Install the package along with @opentui/core which provides native
  // platform-specific bindings that the bun bundler can't inline.
  execSync("bun add git-switchboard@e2e @opentui/core", {
    cwd: dir,
    stdio: "pipe",
    env: { ...process.env, BUN_INSTALL_CACHE_DIR: join(dir, ".cache") },
  });

  _installDir = dir;
  return dir;
}

/**
 * Spawn git-switchboard inside a pseudo-TTY.
 *
 * Uses `script -qfc` (Linux) to wrap the command in a real PTY so that
 * the TUI renders and responds to keyboard input.
 *
 * @param cwd - The git repo to run in.
 * @param args - Extra CLI args (e.g. `["--no-pr"]`).
 * @param registry - npm registry URL to use (for verdaccio).
 */
export function spawnCLI(
  cwd: string,
  args: string[] = [],
  registry?: string
): CLIHarness {
  const installDir = registry ? ensureInstalled(registry) : undefined;

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    // Force color off so escape codes don't pollute output matching
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    // Prevent git pager from hanging
    GIT_PAGER: "",
    // Set a reasonable terminal size
    COLUMNS: "120",
    LINES: "40",
  };

  // Resolve the installed bin path
  const binPath = installDir
    ? join(installDir, "node_modules", ".bin", "git-switchboard")
    : "git-switchboard";

  // Build the inner command string for `script -qfc`
  const innerCmd = [binPath, ...args]
    .map((a) => `'${a.replace(/'/g, "'\\''")}'`)
    .join(" ");

  // `script -qfc <cmd> /dev/null` allocates a PTY, runs the command,
  // and streams output to stdout. The -q flag suppresses the "Script
  // started" banner, -f flushes after each write.
  const proc = spawn("script", ["-qfc", innerCmd, "/dev/null"], {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let output = "";
  proc.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  const write = (data: string) => {
    proc.stdin?.write(data);
  };

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
        proc.kill("SIGKILL");
        reject(new Error(`CLI did not exit within ${timeoutMs}ms.\nOutput: ${output}`));
      }, timeoutMs);

      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve({ output, exitCode: code });
      });
    });

  const kill = () => proc.kill();

  return { write, sendKey, sendKeys, waitForExit, kill, proc };
}

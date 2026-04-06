/**
 * Vitest globalSetup for e2e tests.
 *
 * - Builds git-switchboard
 * - Starts an ephemeral verdaccio registry
 * - Publishes the built package to it
 * - Exposes the registry URL so tests can `bunx git-switchboard`
 * - Tears everything down on shutdown
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(__dirname, "..");

let verdaccioProc: ChildProcess | undefined;
let verdaccioDir: string | undefined;

function pickPort(): number {
  return 10000 + Math.floor(Math.random() * 50000);
}

async function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export async function setup() {
  const port = pickPort();
  const registryUrl = `http://localhost:${port}`;

  // 1. Build
  console.log("[e2e] Building git-switchboard...");
  execSync("bun run build", { cwd: PKG_DIR, stdio: "inherit" });

  // 2. Start verdaccio with ephemeral storage
  verdaccioDir = join(tmpdir(), `git-switchboard-verdaccio-${port}`);
  mkdirSync(verdaccioDir, { recursive: true });
  copyFileSync(
    join(__dirname, "verdaccio.yml"),
    join(verdaccioDir, "verdaccio.yml")
  );

  console.log(`[e2e] Starting verdaccio on port ${port}...`);
  verdaccioProc = spawn(
    "npx",
    [
      "verdaccio",
      "--config",
      join(verdaccioDir, "verdaccio.yml"),
      "--listen",
      String(port),
    ],
    { stdio: "pipe", detached: true }
  );
  verdaccioProc.unref();

  await waitForHttp(`${registryUrl}/-/ping`);
  console.log(`[e2e] Verdaccio ready at ${registryUrl}`);

  // 3. Create user + get auth token
  const resp = await fetch(
    `${registryUrl}/-/user/org.couchdb.user:e2e`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "e2e", password: "e2e12345" }),
    }
  );
  const body = (await resp.json()) as { token?: string; error?: string };
  if (!body.token) {
    throw new Error(
      `Failed to create verdaccio user: ${JSON.stringify(body)}`
    );
  }

  // 4. Publish to verdaccio
  console.log("[e2e] Publishing to local registry...");
  const npmrc = join(verdaccioDir, ".npmrc");
  writeFileSync(
    npmrc,
    `registry=${registryUrl}/\n//localhost:${port}/:_authToken=${body.token}\n`
  );
  execSync(
    `npm publish --registry ${registryUrl} --tag e2e --no-git-checks --userconfig ${npmrc}`,
    { cwd: PKG_DIR, stdio: "inherit" }
  );

  // Read the published version so tests can reference it
  const pkgJson = JSON.parse(
    readFileSync(join(PKG_DIR, "package.json"), "utf-8")
  );

  // Expose to tests via env vars
  process.env.E2E_REGISTRY_URL = registryUrl;
  process.env.E2E_PACKAGE_VERSION = pkgJson.version;

  console.log("[e2e] Setup complete.");
}

export async function teardown() {
  console.log("[e2e] Tearing down...");
  if (verdaccioProc?.pid) {
    try {
      process.kill(-verdaccioProc.pid, "SIGTERM");
    } catch {
      try {
        verdaccioProc.kill("SIGTERM");
      } catch {
        // already dead
      }
    }
  }
  if (verdaccioDir) rmSync(verdaccioDir, { recursive: true, force: true });
}

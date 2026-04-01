import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

/** Directories to never recurse into */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "vendor",
  "target", // Rust
  "build",
  "dist",
  ".cache",
  ".pnpm",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".gradle",
  ".maven",
  "Pods", // iOS
  ".dart_tool",
  ".pub-cache",
  "bower_components",
  ".terraform",
]);

export interface LocalRepo {
  /** Absolute path to the repo root */
  path: string;
  /** Parsed origin remote URL */
  remoteUrl: string | undefined;
  /** owner/repo identifier (e.g. "AgentEnder/craigory-dev") */
  repoId: string | undefined;
  /** Whether this is a worktree (has .git file instead of .git directory) */
  isWorktree: boolean;
  /** Whether git status is clean */
  isClean: boolean;
}

export function scanForRepos(roots: string[], maxDepth: number): LocalRepo[] {
  const repos: LocalRepo[] = [];
  const visited = new Set<string>();

  for (const root of roots) {
    const absRoot = resolve(root);
    scanDir(absRoot, 0, maxDepth, repos, visited);
  }

  return repos;
}

function scanDir(
  dir: string,
  depth: number,
  maxDepth: number,
  repos: LocalRepo[],
  visited: Set<string>
): void {
  if (depth > maxDepth) return;

  const realDir = resolve(dir);
  if (visited.has(realDir)) return;
  visited.add(realDir);

  const gitPath = join(dir, ".git");
  if (existsSync(gitPath)) {
    // Found a git repo or worktree
    const isWorktree = statSync(gitPath).isFile();
    repos.push(buildLocalRepo(dir, isWorktree));

    // Don't recurse into the repo itself (branches/worktrees are separate)
    // But DO continue scanning siblings
    return;
  }

  // Not a git repo — recurse into subdirectories
  if (depth >= maxDepth) return;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // Permission denied, etc.
  }

  for (const entry of entries) {
    if (entry.startsWith(".") && entry !== ".git") continue;
    if (IGNORED_DIRS.has(entry)) continue;

    const fullPath = join(dir, entry);
    try {
      if (statSync(fullPath).isDirectory()) {
        scanDir(fullPath, depth + 1, maxDepth, repos, visited);
      }
    } catch {
      // Permission denied, broken symlink, etc.
    }
  }
}

function buildLocalRepo(dir: string, isWorktree: boolean): LocalRepo {
  let remoteUrl: string | undefined;
  let repoId: string | undefined;
  let isClean = false;

  try {
    remoteUrl = execSync("git remote get-url origin", {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    // No remote configured
  }

  if (remoteUrl) {
    repoId = parseRepoId(remoteUrl);
  }

  try {
    const status = execSync("git status --porcelain", {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    isClean = status.length === 0;
  } catch {
    // Not a valid git repo
  }

  return { path: dir, remoteUrl, repoId, isWorktree, isClean };
}

function parseRepoId(remoteUrl: string): string | undefined {
  // SSH: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/git@[^:]+:(.+?)\/(.+?)(?:\.git)?$/);
  if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`.toLowerCase();

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(
    /https?:\/\/[^/]+\/(.+?)\/(.+?)(?:\.git)?$/
  );
  if (httpsMatch) return `${httpsMatch[1]}/${httpsMatch[2]}`.toLowerCase();

  return undefined;
}

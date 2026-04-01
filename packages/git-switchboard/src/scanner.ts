import { readdir, stat, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

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
  /** Currently checked out branch name */
  currentBranch: string | undefined;
}

export interface ScanProgress {
  currentDir: string;
  reposFound: number;
  dirsScanned: number;
  /** Top-level entries to process (best-effort denominator for gauge) */
  totalTopLevel: number;
  /** Top-level entries completed so far */
  completedTopLevel: number;
}

/** Yield to the event loop so the TUI can repaint */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export async function scanForRepos(
  roots: string[],
  maxDepth: number,
  onProgress?: (progress: ScanProgress) => void
): Promise<LocalRepo[]> {
  const repos: LocalRepo[] = [];
  const visited = new Set<string>();

  // Pre-count top-level entries for a progress denominator
  const topLevelEntries: string[] = [];
  for (const root of roots) {
    const absRoot = resolve(root);
    if (existsSync(join(absRoot, ".git"))) {
      topLevelEntries.push(absRoot);
      continue;
    }
    try {
      const entries = await readdir(absRoot);
      for (const entry of entries) {
        if (entry.startsWith(".") && entry !== ".git") continue;
        if (IGNORED_DIRS.has(entry)) continue;
        const fullPath = join(absRoot, entry);
        try {
          if ((await stat(fullPath)).isDirectory()) {
            topLevelEntries.push(fullPath);
          }
        } catch {
          // skip
        }
      }
    } catch {
      // root doesn't exist or not readable
    }
  }

  const progress: ScanProgress = {
    currentDir: "",
    reposFound: 0,
    dirsScanned: 0,
    totalTopLevel: topLevelEntries.length,
    completedTopLevel: 0,
  };

  onProgress?.(progress);
  await tick();

  for (const entry of topLevelEntries) {
    progress.currentDir = entry;
    onProgress?.(progress);

    await scanDir(entry, 1, maxDepth, repos, visited, progress, onProgress);

    progress.completedTopLevel++;
    progress.reposFound = repos.length;
    progress.dirsScanned = visited.size;
    onProgress?.(progress);
    await tick();
  }

  return repos;
}

async function scanDir(
  dir: string,
  depth: number,
  maxDepth: number,
  repos: LocalRepo[],
  visited: Set<string>,
  progress: ScanProgress,
  onProgress?: (progress: ScanProgress) => void
): Promise<void> {
  if (depth > maxDepth) return;

  const realDir = resolve(dir);
  if (visited.has(realDir)) return;
  visited.add(realDir);

  progress.currentDir = dir;
  progress.dirsScanned = visited.size;
  onProgress?.(progress);

  const gitPath = join(dir, ".git");
  try {
    await access(gitPath);
    // Found a git repo or worktree
    const isWorktree = (await stat(gitPath)).isFile();
    repos.push(buildLocalRepo(dir, isWorktree));
    progress.reposFound = repos.length;
    onProgress?.(progress);
    await tick();
    return;
  } catch {
    // No .git here, continue scanning
  }

  if (depth >= maxDepth) return;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.startsWith(".") && entry !== ".git") continue;
    if (IGNORED_DIRS.has(entry)) continue;

    const fullPath = join(dir, entry);
    try {
      if ((await stat(fullPath)).isDirectory()) {
        await scanDir(fullPath, depth + 1, maxDepth, repos, visited, progress, onProgress);
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
  let currentBranch: string | undefined;

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

  try {
    currentBranch = execSync("git symbolic-ref --short HEAD", {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim() || undefined;
  } catch {
    // Detached HEAD or not a git repo
  }

  return { path: dir, remoteUrl, repoId, isWorktree, isClean, currentBranch };
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

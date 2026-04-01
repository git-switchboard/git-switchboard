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

export function scanForRepos(
  roots: string[],
  maxDepth: number,
  onProgress?: (progress: ScanProgress) => void
): LocalRepo[] {
  const repos: LocalRepo[] = [];
  const visited = new Set<string>();

  // Pre-count top-level entries for a progress denominator
  const topLevelEntries: { root: string; entry: string }[] = [];
  for (const root of roots) {
    const absRoot = resolve(root);
    // If root itself is a git repo, just add it directly
    if (existsSync(join(absRoot, ".git"))) {
      topLevelEntries.push({ root: absRoot, entry: absRoot });
      continue;
    }
    try {
      for (const entry of readdirSync(absRoot)) {
        if (entry.startsWith(".") && entry !== ".git") continue;
        if (IGNORED_DIRS.has(entry)) continue;
        const fullPath = join(absRoot, entry);
        try {
          if (statSync(fullPath).isDirectory()) {
            topLevelEntries.push({ root: absRoot, entry: fullPath });
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

  for (const { entry } of topLevelEntries) {
    progress.currentDir = entry;
    onProgress?.(progress);

    scanDir(entry, 1, maxDepth, repos, visited, (p) => {
      progress.currentDir = p.currentDir;
      progress.reposFound = p.reposFound;
      progress.dirsScanned = p.dirsScanned;
      onProgress?.(progress);
    });

    progress.completedTopLevel++;
    progress.reposFound = repos.length;
    progress.dirsScanned = visited.size;
    onProgress?.(progress);
  }

  return repos;
}

function scanDir(
  dir: string,
  depth: number,
  maxDepth: number,
  repos: LocalRepo[],
  visited: Set<string>,
  onProgress?: (progress: ScanProgress) => void
): void {
  if (depth > maxDepth) return;

  const realDir = resolve(dir);
  if (visited.has(realDir)) return;
  visited.add(realDir);

  onProgress?.({ currentDir: dir, reposFound: repos.length, dirsScanned: visited.size, totalTopLevel: 0, completedTopLevel: 0 });

  const gitPath = join(dir, ".git");
  if (existsSync(gitPath)) {
    // Found a git repo or worktree
    const isWorktree = statSync(gitPath).isFile();
    repos.push(buildLocalRepo(dir, isWorktree));
    onProgress?.({ currentDir: dir, reposFound: repos.length, dirsScanned: visited.size, totalTopLevel: 0, completedTopLevel: 0 });

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
        scanDir(fullPath, depth + 1, maxDepth, repos, visited, onProgress);
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

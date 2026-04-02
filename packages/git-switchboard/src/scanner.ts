import { readdir, stat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Directories to never recurse into */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'vendor',
  'target',
  'build',
  'dist',
  '.cache',
  '.pnpm',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.gradle',
  '.maven',
  'Pods',
  '.dart_tool',
  '.pub-cache',
  'bower_components',
  '.terraform',
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
  /** Whether git status is clean (null = not yet checked) */
  isClean: boolean;
  /** Currently checked out branch name */
  currentBranch: string | undefined;
}

export interface ScanProgress {
  currentDir: string;
  reposFound: number;
  dirsScanned: number;
  totalTopLevel: number;
  completedTopLevel: number;
}

/** Yield to event loop so TUI can repaint */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// ─── Single git call to get remote + branch ─────────────────────
// Replaces 3 execSync calls with 1 async execFile that reads
// remote URL and HEAD from git config files directly, with a
// fallback to a single `git` invocation.

async function getGitInfo(
  dir: string,
  isWorktree: boolean
): Promise<{ remoteUrl?: string; currentBranch?: string }> {
  // Fast path: read .git/config and .git/HEAD directly (no process spawn)
  try {
    let gitDir: string;
    if (isWorktree) {
      // .git is a file containing "gitdir: /path/to/actual/.git/worktrees/name"
      const content = await readFile(join(dir, '.git'), 'utf-8');
      const match = content.match(/^gitdir:\s*(.+)/);
      if (match) {
        // The worktree's gitdir points to .git/worktrees/<name>
        // The common dir (with config) is two levels up
        const worktreeGitDir = resolve(dir, match[1].trim());
        gitDir = resolve(worktreeGitDir, '../..');
      } else {
        gitDir = join(dir, '.git');
      }
    } else {
      gitDir = join(dir, '.git');
    }

    const [configContent, headContent] = await Promise.all([
      readFile(join(gitDir, 'config'), 'utf-8').catch(() => ''),
      readFile(
        isWorktree ? join(dir, '.git') : join(gitDir, 'HEAD'),
        'utf-8'
      ).catch(() => ''),
    ]);

    // Parse remote URL from config
    let remoteUrl: string | undefined;
    const remoteMatch = configContent.match(
      /\[remote "origin"\][^\[]*url\s*=\s*(.+)/
    );
    if (remoteMatch) {
      remoteUrl = remoteMatch[1].trim();
    }

    // Parse current branch from HEAD
    let currentBranch: string | undefined;
    // For worktrees, read the worktree HEAD file
    let headPath: string;
    if (isWorktree) {
      const gitFileContent = await readFile(join(dir, '.git'), 'utf-8');
      const dirMatch = gitFileContent.match(/^gitdir:\s*(.+)/);
      if (dirMatch) {
        headPath = join(resolve(dir, dirMatch[1].trim()), 'HEAD');
      } else {
        headPath = join(gitDir, 'HEAD');
      }
    } else {
      headPath = join(gitDir, 'HEAD');
    }

    const actualHead = await readFile(headPath, 'utf-8').catch(() => headContent);
    const branchMatch = actualHead.match(/^ref: refs\/heads\/(.+)/);
    if (branchMatch) {
      currentBranch = branchMatch[1].trim();
    }

    return { remoteUrl, currentBranch };
  } catch {
    // Fallback: use git commands (slower but reliable)
    return getGitInfoFallback(dir);
  }
}

async function getGitInfoFallback(
  dir: string
): Promise<{ remoteUrl?: string; currentBranch?: string }> {
  const [remoteResult, branchResult] = await Promise.allSettled([
    execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: dir }),
    execFileAsync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: dir }),
  ]);

  return {
    remoteUrl:
      remoteResult.status === 'fulfilled'
        ? remoteResult.value.stdout.trim() || undefined
        : undefined,
    currentBranch:
      branchResult.status === 'fulfilled'
        ? branchResult.value.stdout.trim() || undefined
        : undefined,
  };
}

// ─── git status (deferred — only called when needed) ────────────

export async function checkIsClean(dir: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['status', '--porcelain'],
      { cwd: dir }
    );
    return stdout.trim().length === 0;
  } catch {
    return false;
  }
}

// ─── Scanning ───────────────────────────────────────────────────

export async function scanForRepos(
  roots: string[],
  maxDepth: number,
  onProgress?: (progress: ScanProgress) => void
): Promise<LocalRepo[]> {
  const repos: LocalRepo[] = [];
  const visited = new Set<string>();

  // Pre-count top-level entries with withFileTypes (single readdir, no stat)
  const topLevelEntries: string[] = [];
  for (const root of roots) {
    const absRoot = resolve(root);
    try {
      const entries = await readdir(absRoot, { withFileTypes: true });
      // Check if root itself is a git repo
      if (entries.some((e) => e.name === '.git')) {
        topLevelEntries.push(absRoot);
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;
        if (IGNORED_DIRS.has(entry.name)) continue;
        topLevelEntries.push(join(absRoot, entry.name));
      }
    } catch {
      // root doesn't exist or not readable
    }
  }

  const progress: ScanProgress = {
    currentDir: '',
    reposFound: 0,
    dirsScanned: 0,
    totalTopLevel: topLevelEntries.length,
    completedTopLevel: 0,
  };

  onProgress?.(progress);
  await tick();

  // Process top-level entries with controlled concurrency
  const CONCURRENCY = 8;
  let i = 0;

  const processNext = async (): Promise<void> => {
    while (i < topLevelEntries.length) {
      const idx = i++;
      const entry = topLevelEntries[idx];
      progress.currentDir = entry;
      onProgress?.(progress);

      await scanDir(entry, 1, maxDepth, repos, visited);

      progress.completedTopLevel = idx + 1;
      progress.reposFound = repos.length;
      progress.dirsScanned = visited.size;
      onProgress?.(progress);
    }
  };

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, topLevelEntries.length) },
    () => processNext()
  );
  await Promise.all(workers);

  // Yield once at the end for final render
  await tick();

  return repos;
}

async function scanDir(
  dir: string,
  depth: number,
  maxDepth: number,
  repos: LocalRepo[],
  visited: Set<string>
): Promise<void> {
  if (depth > maxDepth) return;

  const realDir = resolve(dir);
  if (visited.has(realDir)) return;
  visited.add(realDir);

  // Single readdir with file types — no separate stat calls
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  // Check if this directory is a git repo
  const gitEntry = entries.find((e: import('node:fs').Dirent) => e.name === '.git');
  if (gitEntry) {
    const isWorktree = gitEntry.isFile();
    const info = await getGitInfo(dir, isWorktree);
    repos.push({
      path: dir,
      remoteUrl: info.remoteUrl,
      repoId: info.remoteUrl ? parseRepoId(info.remoteUrl) : undefined,
      isWorktree,
      isClean: true, // Deferred — checked lazily during clone selection
      currentBranch: info.currentBranch,
    });
    return;
  }

  if (depth >= maxDepth) return;

  // Recurse into subdirectories
  const subdirs = entries.filter(
    (e: import('node:fs').Dirent) =>
      e.isDirectory() &&
      !e.name.startsWith('.') &&
      !IGNORED_DIRS.has(e.name)
  );

  // Parallel recursion for sibling directories
  await Promise.all(
    subdirs.map((e: import('node:fs').Dirent) =>
      scanDir(join(dir, e.name), depth + 1, maxDepth, repos, visited)
    )
  );
}

function parseRepoId(remoteUrl: string): string | undefined {
  const sshMatch = remoteUrl.match(/git@[^:]+:(.+?)\/(.+?)(?:\.git)?$/);
  if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`.toLowerCase();

  const httpsMatch = remoteUrl.match(
    /https?:\/\/[^/]+\/(.+?)\/(.+?)(?:\.git)?$/
  );
  if (httpsMatch)
    return `${httpsMatch[1]}/${httpsMatch[2]}`.toLowerCase();

  return undefined;
}

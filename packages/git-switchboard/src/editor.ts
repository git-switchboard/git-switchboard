import { execSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface EditorInfo {
  name: string;
  command: string;
  /** How to open a directory */
  dirArg: (dir: string) => string[];
  /** Custom availability check — when omitted, falls back to `which command` */
  detectAvailable?: () => boolean;
  /**
   * When set, the editor is shown in the picker but cannot be selected.
   * Pass a string to display a reason, or `true` for no reason text.
   */
  disabled?: string | true;
}

const KNOWN_EDITORS: EditorInfo[] = [
  { name: 'VS Code', command: 'code', dirArg: (d) => [d] },
  { name: 'VS Code Insiders', command: 'code-insiders', dirArg: (d) => [d] },
  { name: 'Cursor', command: 'cursor', dirArg: (d) => [d] },
  { name: 'Zed', command: 'zed', dirArg: (d) => [d] },
  { name: 'Neovim', command: 'nvim', dirArg: (d) => [d] },
  { name: 'Vim', command: 'vim', dirArg: (d) => [d] },
  { name: 'IntelliJ IDEA', command: 'idea', dirArg: (d) => [d] },
  { name: 'WebStorm', command: 'webstorm', dirArg: (d) => [d] },
  { name: 'GoLand', command: 'goland', dirArg: (d) => [d] },
  { name: 'RustRover', command: 'rustrover', dirArg: (d) => [d] },
  { name: 'Sublime Text', command: 'subl', dirArg: (d) => [d] },
  { name: 'Emacs', command: 'emacs', dirArg: (d) => [d] },
  {
    name: 'Superset',
    command: 'open',
    dirArg: (d) => ['-a', 'Superset', d],
    disabled: 'No CLI support yet (superset-sh/superset#1929)',
    detectAvailable: () => {
      try {
        const result = execSync(
          'mdfind "kMDItemCFBundleIdentifier == com.superset.desktop" | head -1',
          { stdio: ['pipe', 'pipe', 'pipe'] }
        ).toString().trim();
        return result.length > 0;
      } catch {
        return false;
      }
    },
  },
] as const;

type KNOWN_EDITOR_COMMAND = (typeof KNOWN_EDITORS)[number]['command'];

/** Detect if we're running inside an editor's integrated terminal */
export function detectTerminalEditor(): KNOWN_EDITOR_COMMAND | undefined {
  // VS Code / Cursor
  if (process.env.TERM_PROGRAM === 'vscode') {
    // Could be VS Code or Cursor — check further
    if (process.env.CURSOR_TRACE_ID || process.env.__CURSOR_ENV)
      return 'cursor';
    return 'code';
  }

  // Zed
  if (process.env.TERM_PROGRAM === 'zed') return 'zed';

  // Superset (macOS app — opened via `open -a Superset`)
  if (process.env.TERM_PROGRAM === 'Superset') return 'open';

  // JetBrains terminals
  if (process.env.TERMINAL_EMULATOR?.startsWith('JetBrains')) {
    // Try to figure out which JetBrains IDE
    const emulator = process.env.TERMINAL_EMULATOR ?? '';
    if (emulator.includes('WebStorm')) return 'webstorm';
    if (emulator.includes('GoLand')) return 'goland';
    if (emulator.includes('RustRover')) return 'rustrover';
    return 'idea'; // Default to IntelliJ
  }

  return undefined;
}

// ─── Editor availability cache ──────────────────────────────────
//
// Stores per-editor availability with individual timestamps. On each
// invocation we re-verify at most ONE stale editor so startup stays fast.
// The cache is trusted indefinitely; if an open command fails the caller
// should call `invalidateEditorCache(name)` to force a fresh check.

const CACHE_DIR = join(
  process.env.XDG_CACHE_HOME ?? join(process.env.HOME ?? '~', '.cache'),
  'git-switchboard'
);
const EDITOR_CACHE_FILE = join(CACHE_DIR, 'installed-editors.json');
/** Re-verify one stale editor per invocation after this age. */
const REVERIFY_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

interface EditorCacheRecord {
  available: boolean;
  verifiedAt: number;
}

type EditorCache = Record<string, EditorCacheRecord>;

function readEditorCache(): EditorCache | null {
  try {
    const raw = readFileSync(EDITOR_CACHE_FILE, 'utf-8');
    return JSON.parse(raw) as EditorCache;
  } catch {
    return null;
  }
}

function writeEditorCache(cache: EditorCache): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(EDITOR_CACHE_FILE, JSON.stringify(cache));
  } catch {
    // Best-effort — never block the user
  }
}

function checkEditorAvailable(editor: EditorInfo): boolean {
  try {
    if (editor.detectAvailable) {
      return editor.detectAvailable();
    }
    execSync(`which ${editor.command}`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove an editor from the cache so the next call to
 * `findInstalledEditors` re-checks it. Call this when an open command fails.
 */
export function invalidateEditorCache(editorName: string): void {
  const cache = readEditorCache();
  if (!cache || !(editorName in cache)) return;
  delete cache[editorName];
  writeEditorCache(cache);
}

/**
 * Check which editors are installed.
 *
 * Results are persisted to disk and trusted until invalidated. On each call
 * the single stalest entry (older than 1 week) is re-verified so the cache
 * stays fresh without running every detection command at once.
 */
export function findInstalledEditors(): EditorInfo[] {
  const cache = readEditorCache();

  // Cold start — no cache at all, verify everything once
  if (!cache) {
    const now = Date.now();
    const fresh: EditorCache = {};
    for (const editor of KNOWN_EDITORS) {
      fresh[editor.name] = {
        available: checkEditorAvailable(editor),
        verifiedAt: now,
      };
    }
    writeEditorCache(fresh);
    return KNOWN_EDITORS.filter((e) => fresh[e.name].available);
  }

  // Find the single stalest entry to re-verify (if any)
  const now = Date.now();
  let stalestName: string | null = null;
  let stalestAge = 0;

  for (const editor of KNOWN_EDITORS) {
    const record = cache[editor.name];
    if (!record) {
      // New editor added to KNOWN_EDITORS since last cache write — verify it now
      stalestName = editor.name;
      break;
    }
    const age = now - record.verifiedAt;
    if (age > REVERIFY_AGE_MS && age > stalestAge) {
      stalestAge = age;
      stalestName = editor.name;
    }
  }

  if (stalestName) {
    const editor = KNOWN_EDITORS.find((e) => e.name === stalestName)!;
    cache[stalestName] = {
      available: checkEditorAvailable(editor),
      verifiedAt: now,
    };
    writeEditorCache(cache);
  }

  return KNOWN_EDITORS.filter((e) => cache[e.name]?.available);
}

export interface ResolvedEditor {
  command: string;
  dirArg: (dir: string) => string[];
  source: 'flag' | 'env' | 'terminal' | 'prompt';
}

/**
 * Resolve which editor to use.
 * Returns undefined if detection fails and the caller should prompt.
 */
export function resolveEditor(flagValue?: string): ResolvedEditor | null {
  // 1. Explicit flag
  if (flagValue) {
    const known = KNOWN_EDITORS.find((e) => e.command === flagValue);
    return {
      command: flagValue,
      dirArg: known?.dirArg ?? ((d) => [d]),
      source: 'flag',
    };
  }

  // 2. $EDITOR env var
  const envEditor = process.env.EDITOR;
  if (envEditor && (envEditor !== 'vi' || !process.env.npm_lifecycle_event)) {
    const known = KNOWN_EDITORS.find((e) => e.command === envEditor);
    return {
      command: envEditor,
      dirArg: known?.dirArg ?? ((d) => [d]),
      source: 'env',
    };
  }

  // 3. Detect from terminal
  const termEditor = detectTerminalEditor();
  if (termEditor) {
    const known = KNOWN_EDITORS.find((e) => e.command === termEditor);
    if (!known?.disabled) {
      return {
        command: termEditor,
        dirArg: known?.dirArg ?? ((d) => [d]),
        source: 'terminal',
      };
    }
  }

  // 4. Caller should prompt
  return null;
}

export function openInEditor(editor: ResolvedEditor, dir: string): void {
  const args = editor.dirArg(dir);
  try {
    execSync(`${editor.command} ${args.map((a) => `"${a}"`).join(' ')}`, {
      stdio: 'inherit',
    });
  } catch (err) {
    // Editor command failed — invalidate cache so next run re-checks
    const known = KNOWN_EDITORS.find((e) => e.command === editor.command);
    if (known) invalidateEditorCache(known.name);
    throw err;
  }
}

/** Non-blocking variant that spawns the editor detached — suitable for use while a TUI is running. */
export function openInEditorDetached(editor: ResolvedEditor, dir: string): void {
  const args = editor.dirArg(dir);
  const child = spawn(editor.command, args, {
    detached: true,
    stdio: 'ignore',
  });
  // If the command doesn't exist, the 'error' event fires before the process detaches
  child.on('error', () => {
    const known = KNOWN_EDITORS.find((e) => e.command === editor.command);
    if (known) invalidateEditorCache(known.name);
  });
  child.unref();
}

export { KNOWN_EDITORS, type EditorInfo };

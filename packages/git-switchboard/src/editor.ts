import { execSync, spawn } from 'node:child_process';

interface EditorInfo {
  name: string;
  command: string;
  /** How to open a directory */
  dirArg: (dir: string) => string[];
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

/** Check which editors are installed */
export function findInstalledEditors(): EditorInfo[] {
  return KNOWN_EDITORS.filter((editor) => {
    try {
      execSync(`which ${editor.command}`, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  });
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
    return {
      command: termEditor,
      dirArg: known?.dirArg ?? ((d) => [d]),
      source: 'terminal',
    };
  }

  // 4. Caller should prompt
  return null;
}

export function openInEditor(editor: ResolvedEditor, dir: string): void {
  const args = editor.dirArg(dir);
  execSync(`${editor.command} ${args.map((a) => `"${a}"`).join(' ')}`, {
    stdio: 'inherit',
  });
}

/** Non-blocking variant that spawns the editor detached — suitable for use while a TUI is running. */
export function openInEditorDetached(editor: ResolvedEditor, dir: string): void {
  const args = editor.dirArg(dir);
  const child = spawn(editor.command, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

export { KNOWN_EDITORS, type EditorInfo };

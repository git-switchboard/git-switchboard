/**
 * Electrobun window integration.
 *
 * Opens a native desktop window (via Electrobun's BrowserWindow) instead of the
 * terminal TUI.  Communication from the webview back to the bun process uses a
 * custom `gsb://` URL scheme intercepted through the `will-navigate` event.
 */

import type { BranchWithPR, UserPullRequest } from './types.js';

// ─── Signal parsing ──────────────────────────────────────────

interface Signal {
  action: string;
  data: unknown;
}

function parseSignalURL(url: string): Signal | null {
  if (!url.startsWith('gsb://')) return null;
  try {
    const withoutScheme = url.slice('gsb://'.length);
    const qIndex = withoutScheme.indexOf('?d=');
    const action = qIndex === -1 ? withoutScheme : withoutScheme.slice(0, qIndex);
    const data =
      qIndex === -1
        ? {}
        : JSON.parse(decodeURIComponent(withoutScheme.slice(qIndex + 3)));
    return { action, data };
  } catch {
    return null;
  }
}

// ─── Branch picker window ────────────────────────────────────

export interface BranchPickerWindowResult {
  selectedBranch: string | null;
}

export async function openBranchPickerWindow(
  html: string,
  fetchBranches: (includeRemote: boolean) => BranchWithPR[]
): Promise<BranchPickerWindowResult> {
  const { BrowserWindow } = await import('electrobun/bun');

  const { promise, resolve } =
    Promise.withResolvers<BranchPickerWindowResult>();

  const win = new BrowserWindow({
    title: 'git-switchboard',
    frame: { width: 960, height: 640, x: -1, y: -1 },
    titleBarStyle: 'hiddenInset',
    html,
  });

  win.webview.on('will-navigate', (event: unknown) => {
    const { url } = event as { url: string };
    const sig = parseSignalURL(url);
    if (!sig) return;

    switch (sig.action) {
      case 'select-branch': {
        const branch = sig.data as BranchWithPR;
        const name = branch.isRemote
          ? branch.name.replace(/^origin\//, '')
          : branch.name;
        win.close();
        resolve({ selectedBranch: name });
        break;
      }
      case 'toggle-remote': {
        const { showRemote } = sig.data as { showRemote: boolean };
        const updated = fetchBranches(showRemote);
        const json = JSON.stringify(updated);
        win.webview.executeJavascript(`window.__updateBranches(${json})`);
        break;
      }
      case 'exit':
        win.close();
        resolve({ selectedBranch: null });
        break;
    }
  });

  win.on('close', () => {
    // Resolve if the user closes the window via the OS chrome
    resolve({ selectedBranch: null });
  });

  return promise;
}

// ─── PR dashboard window ─────────────────────────────────────

export interface PRDashboardWindowResult {
  selectedPR: UserPullRequest | null;
}

export async function openPRDashboardWindow(
  html: string
): Promise<PRDashboardWindowResult> {
  const { BrowserWindow } = await import('electrobun/bun');

  const { promise, resolve } =
    Promise.withResolvers<PRDashboardWindowResult>();

  const win = new BrowserWindow({
    title: 'git-switchboard pr',
    frame: { width: 1100, height: 700, x: -1, y: -1 },
    titleBarStyle: 'hiddenInset',
    html,
  });

  win.webview.on('will-navigate', (event: unknown) => {
    const { url } = event as { url: string };
    const sig = parseSignalURL(url);
    if (!sig) return;

    switch (sig.action) {
      case 'select-pr': {
        const pr = sig.data as UserPullRequest;
        win.close();
        resolve({ selectedPR: pr });
        break;
      }
      case 'exit':
        win.close();
        resolve({ selectedPR: null });
        break;
    }
  });

  win.on('close', () => {
    resolve({ selectedPR: null });
  });

  return promise;
}

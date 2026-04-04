/**
 * Electrobun window integration.
 *
 * Loads the built @git-switchboard/ui app and communicates via the
 * bridge abstraction (gsb:// URL interception for outgoing messages,
 * executeJavascript for incoming messages).
 */

import { resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import type { BranchWithPR, UserPullRequest, CIInfo, ReviewInfo, MergeableStatus, CIStatus, ReviewStatus } from './types.js';

// ─── Load the built UI HTML ──────────────────────────────────

function loadUIHTML(): string {
  // Resolve relative to this file's location in the source tree
  const uiDistDir = resolve(dirname(import.meta.dir), '..', 'ui', 'dist');
  return readFileSync(resolve(uiDistDir, 'index.html'), 'utf-8');
}

// ─── Signal parsing ──────────────────────────────────────────

interface OutgoingMessage {
  type: string;
  data?: unknown;
}

function parseSignalURL(url: string): OutgoingMessage | null {
  if (!url.startsWith('gsb://')) return null;
  try {
    const withoutScheme = url.slice('gsb://'.length);
    const qIndex = withoutScheme.indexOf('?d=');
    if (qIndex === -1) return null;
    const payload = JSON.parse(decodeURIComponent(withoutScheme.slice(qIndex + 3)));
    return payload as OutgoingMessage;
  } catch {
    return null;
  }
}

// ─── Pre-compute display data (matches ui package types) ─────

const THEME_COLORS = {
  textMuted: '#565f89',
  green: '#9ece6a',
  red: '#f7768e',
  orange: '#ff9e64',
  yellow: '#e0af68',
};

function ciStatusColor(status: CIStatus): string {
  switch (status) {
    case 'passing': return THEME_COLORS.green;
    case 'failing': return THEME_COLORS.red;
    case 'mixed': return THEME_COLORS.orange;
    case 'pending': return THEME_COLORS.yellow;
    default: return THEME_COLORS.textMuted;
  }
}

function reviewStatusColor(status: ReviewStatus): string {
  switch (status) {
    case 'approved': return THEME_COLORS.green;
    case 'changes-requested': return THEME_COLORS.red;
    case 're-review-needed': return THEME_COLORS.yellow;
    default: return THEME_COLORS.textMuted;
  }
}

function reviewStatusLabel(status: ReviewStatus | undefined): string {
  if (!status) return '\u2026';
  switch (status) {
    case 'approved': return '\u2713 Approved';
    case 'changes-requested': return '\u2717 Changes req';
    case 're-review-needed': return '~ Re-review';
    default: return 'Needs review';
  }
}

function ciStatusLabel(ci: CIInfo | undefined): string {
  if (!ci || ci.checks.length === 0) return '?';
  const pass = ci.checks.filter(c => c.status === 'completed' && ['success', 'skipped', 'neutral'].includes(c.conclusion ?? '')).length;
  const fail = ci.checks.filter(c => c.status === 'completed' && c.conclusion === 'failure').length;
  const pending = ci.checks.filter(c => c.status !== 'completed').length;
  const parts: string[] = [];
  if (pass > 0) parts.push(pass + '\u2713');
  if (fail > 0) parts.push(fail + '\u2717');
  if (pending > 0) parts.push(pending + '\u231B');
  return parts.join(' ');
}

// ─── Branch picker window ────────────────────────────────────

export interface BranchPickerWindowResult {
  selectedBranch: string | null;
}

export async function openBranchPickerWindow(
  branches: BranchWithPR[],
  currentUser: string,
  showRemote: boolean,
  fetchBranches: (includeRemote: boolean) => BranchWithPR[]
): Promise<BranchPickerWindowResult> {
  const { BrowserWindow } = await import('electrobun/bun');
  const html = loadUIHTML();

  const { promise, resolve: done } =
    Promise.withResolvers<BranchPickerWindowResult>();

  const win = new BrowserWindow({
    title: 'git-switchboard',
    frame: { width: 960, height: 640, x: -1, y: -1 },
    titleBarStyle: 'hiddenInset',
    html,
  });

  // Once the DOM is ready, push init data
  win.webview.on('dom-ready', () => {
    const initData = JSON.stringify({
      view: 'branch-picker',
      branches,
      currentUser,
      showRemote,
    });
    win.webview.executeJavascript(`window.__gsb_receive({ type: 'init', data: ${initData} })`);
  });

  // Mark the window as electrobun mode before scripts run
  win.webview.executeJavascript(`window.__electrobun_mode = true`);

  win.webview.on('will-navigate', (event: unknown) => {
    const { url } = event as { url: string };
    const msg = parseSignalURL(url);
    if (!msg) return;

    switch (msg.type) {
      case 'select-branch': {
        const branch = msg.data as BranchWithPR;
        const name = branch.isRemote
          ? branch.name.replace(/^origin\//, '')
          : branch.name;
        win.close();
        done({ selectedBranch: name });
        break;
      }
      case 'toggle-remote': {
        const { showRemote: newRemote } = msg.data as { showRemote: boolean };
        const updated = fetchBranches(newRemote);
        const json = JSON.stringify(updated);
        win.webview.executeJavascript(
          `window.__gsb_receive({ type: 'update-branches', data: ${json} })`
        );
        break;
      }
      case 'exit':
        win.close();
        done({ selectedBranch: null });
        break;
    }
  });

  win.on('close', () => {
    done({ selectedBranch: null });
  });

  return promise;
}

// ─── PR dashboard window ─────────────────────────────────────

export interface PRDashboardWindowResult {
  selectedPR: UserPullRequest | null;
}

export async function openPRDashboardWindow(
  prs: UserPullRequest[],
  ciCache: Map<string, CIInfo>,
  reviewCache: Map<string, ReviewInfo>,
  mergeableCache: Map<string, MergeableStatus>,
  repoMode: string | null
): Promise<PRDashboardWindowResult> {
  const { BrowserWindow } = await import('electrobun/bun');
  const html = loadUIHTML();

  const { promise, resolve: done } =
    Promise.withResolvers<PRDashboardWindowResult>();

  // Pre-compute display data for the UI
  const prDisplayData = prs.map(pr => {
    const key = `${pr.repoId}#${pr.number}`;
    const ci = ciCache.get(key);
    const review = reviewCache.get(key);
    const merge = mergeableCache.get(key);
    return {
      ...pr,
      ciLabel: ciStatusLabel(ci),
      ciColor: ci ? ciStatusColor(ci.status) : THEME_COLORS.textMuted,
      reviewLabel: reviewStatusLabel(review?.status),
      reviewColor: review ? reviewStatusColor(review.status) : THEME_COLORS.textMuted,
      mergeLabel: merge === 'CONFLICTING' ? '\u2717 Conflict' : '',
      mergeColor: merge === 'CONFLICTING' ? THEME_COLORS.red : THEME_COLORS.textMuted,
    };
  });

  const win = new BrowserWindow({
    title: 'git-switchboard pr',
    frame: { width: 1100, height: 700, x: -1, y: -1 },
    titleBarStyle: 'hiddenInset',
    html,
  });

  win.webview.on('dom-ready', () => {
    const initData = JSON.stringify({
      view: 'pr-dashboard',
      prs: prDisplayData,
      repoMode,
    });
    win.webview.executeJavascript(`window.__gsb_receive({ type: 'init', data: ${initData} })`);
  });

  win.webview.executeJavascript(`window.__electrobun_mode = true`);

  win.webview.on('will-navigate', (event: unknown) => {
    const { url } = event as { url: string };
    const msg = parseSignalURL(url);
    if (!msg) return;

    switch (msg.type) {
      case 'select-pr': {
        const pr = msg.data as UserPullRequest;
        win.close();
        done({ selectedPR: pr });
        break;
      }
      case 'exit':
        win.close();
        done({ selectedPR: null });
        break;
    }
  });

  win.on('close', () => {
    done({ selectedPR: null });
  });

  return promise;
}

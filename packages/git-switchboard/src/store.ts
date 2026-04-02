import { create } from 'zustand';
import {
  fetchPRDetails,
  fetchCheckLogs,
  fetchUserPRs,
  retryFailedJobs,
} from './github.js';
import { openUrl } from './notify.js';
import type {
  UserPullRequest,
  CIInfo,
  ReviewInfo,
  CheckRun,
} from './types.js';
import type { LocalRepo } from './scanner.js';

type Screen =
  | { type: 'pr-list' }
  | { type: 'pr-detail'; pr: UserPullRequest; matches: LocalRepo[] }
  | { type: 'clone-prompt'; pr: UserPullRequest; matches: LocalRepo[] };

export interface PrRouterResult {
  selectedPR: UserPullRequest;
  selectedRepo?: LocalRepo;
  skipCheckout: boolean;
  newWorktreePath?: string;
}

export interface PrStore {
  // ─── Data ─────────────────────────────────────────────────────
  prs: UserPullRequest[];
  localRepos: LocalRepo[];
  ciCache: Record<string, CIInfo>;
  reviewCache: Record<string, ReviewInfo>;
  watchedPRs: Set<string>;

  // ─── Navigation ───────────────────────────────────────────────
  screen: Screen;
  navigate: (screen: Screen) => void;

  // ─── UI state ─────────────────────────────────────────────────
  ciLoading: boolean;
  refreshing: boolean;
  statusText: string;

  // ─── Config (set once) ────────────────────────────────────────
  token: string;
  copyToClipboard: (text: string) => Promise<boolean>;
  onDone: (result: PrRouterResult | null) => void;
  /** Open a PR in the editor without exiting the TUI. Returns a status message. */
  openEditorForPR: (pr: UserPullRequest, repo: LocalRepo, skipCheckout: boolean) => Promise<string>;

  // ─── Actions ──────────────────────────────────────────────────
  fetchDetailsForPR: (pr: UserPullRequest) => Promise<void>;
  refreshCI: (pr: UserPullRequest) => Promise<void>;
  retryChecks: (pr: UserPullRequest) => Promise<string>;
  copyLogs: (pr: UserPullRequest, check: CheckRun) => Promise<string>;
  toggleWatch: (pr: UserPullRequest) => void;
  refreshAllPRs: () => Promise<void>;
  openInBrowser: (url: string) => void;
  showStatus: (text: string) => void;
  clearStatus: () => void;
}

function prKey(pr: UserPullRequest): string {
  return `${pr.repoId}#${pr.number}`;
}

export const createPrStore = (initial: {
  prs: UserPullRequest[];
  localRepos: LocalRepo[];
  ciCache: Map<string, CIInfo>;
  reviewCache: Map<string, ReviewInfo>;
  token: string;
  copyToClipboard: (text: string) => Promise<boolean>;
  onDone: (result: PrRouterResult | null) => void;
  openEditorForPR: (pr: UserPullRequest, repo: LocalRepo, skipCheckout: boolean) => Promise<string>;
}) =>
  create<PrStore>((set, get) => ({
    // ─── Data ───────────────────────────────────────────────────
    prs: initial.prs,
    localRepos: initial.localRepos,
    ciCache: Object.fromEntries(initial.ciCache),
    reviewCache: Object.fromEntries(initial.reviewCache),
    watchedPRs: new Set(),

    // ─── Navigation ─────────────────────────────────────────────
    screen: { type: 'pr-list' } as Screen,
    navigate: (screen) => set({ screen }),

    // ─── UI state ───────────────────────────────────────────────
    ciLoading: false,
    refreshing: false,
    statusText: '',

    // ─── Config ─────────────────────────────────────────────────
    token: initial.token,
    copyToClipboard: initial.copyToClipboard,
    onDone: initial.onDone,
    openEditorForPR: initial.openEditorForPR,

    // ─── Actions ────────────────────────────────────────────────

    fetchDetailsForPR: async (pr) => {
      const { token } = get();
      const { ci, review } = await fetchPRDetails(
        token,
        pr.repoOwner,
        pr.repoName,
        pr.number
      );
      const key = prKey(pr);
      set((s) => ({
        ciCache: { ...s.ciCache, [key]: ci },
        reviewCache: { ...s.reviewCache, [key]: review },
      }));
    },

    refreshCI: async (pr) => {
      set({ ciLoading: true });
      await get().fetchDetailsForPR(pr);
      set({ ciLoading: false });
    },

    retryChecks: async (pr) => {
      const { token } = get();
      const key = prKey(pr);
      const ci = get().ciCache[key];
      if (!ci) return 'No CI data available';

      const failedChecks = ci.checks.filter(
        (c) => c.status === 'completed' && c.conclusion === 'failure'
      );
      if (failedChecks.length === 0) return 'No failed checks to retry';

      try {
        await retryFailedJobs(token, pr.repoOwner, pr.repoName, failedChecks);
        // Refresh after a brief delay to let GitHub register the retry
        setTimeout(() => get().refreshCI(pr), 2000);
        return `Retrying ${failedChecks.length} failed check(s)...`;
      } catch {
        return 'Failed to retry checks';
      }
    },

    copyLogs: async (pr, check) => {
      const { token, copyToClipboard } = get();
      const logs = await fetchCheckLogs(token, pr.repoOwner, pr.repoName, check.id);
      if (!logs) return 'No logs available (may not be a GitHub Action)';
      const ok = await copyToClipboard(logs);
      return ok
        ? `Copied ${logs.length} chars of logs to clipboard`
        : 'Failed to copy to clipboard';
    },

    toggleWatch: (pr) => {
      const key = prKey(pr);
      set((s) => {
        const next = new Set(s.watchedPRs);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return { watchedPRs: next };
      });
    },

    refreshAllPRs: async () => {
      const { token } = get();
      set({ refreshing: true });
      try {
        const result = await fetchUserPRs(token);
        set({
          prs: result.prs,
          ciCache: Object.fromEntries(result.ciCache),
          reviewCache: Object.fromEntries(result.reviewCache),
          refreshing: false,
        });
      } catch {
        set({ refreshing: false });
      }
    },

    openInBrowser: (url) => openUrl(url),

    showStatus: (text) => set({ statusText: text }),
    clearStatus: () => set({ statusText: '' }),
  }));

export type PrStoreApi = ReturnType<typeof createPrStore>;

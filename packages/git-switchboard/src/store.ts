import { create } from 'zustand';
import {
  fetchPRDetails,
  fetchPRDetailsBatch,
  fetchCheckLogs,
  fetchUserPRs,
  fetchRepoPRs,
  persistPRCache,
  retryFailedJobs,
} from './github.js';
import { openUrl } from './notify.js';
import type {
  UserPullRequest,
  CIInfo,
  MergeableStatus,
  ReviewInfo,
  CheckRun,
} from './types.js';
import type { LocalRepo } from './scanner.js';
import type { ResolvedEditor, EditorInfo } from './editor.js';

export type PrScreen =
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
  repoScanDone: boolean;
  ciCache: Record<string, CIInfo>;
  reviewCache: Record<string, ReviewInfo>;
  mergeableCache: Record<string, MergeableStatus>;
  watchedPRs: Set<string>;

  // ─── UI state ─────────────────────────────────────────────────
  ciLoading: boolean;
  refreshing: boolean;
  statusText: string;

  // ─── Config (set once) ────────────────────────────────────────
  /** When set, we're showing all PRs for a specific repo instead of user PRs */
  repoMode: string | null;
  token: string;
  copyToClipboard: (text: string) => Promise<boolean>;
  onDone: (result: PrRouterResult | null) => void;
  /** Open a PR in the editor without exiting the TUI. Returns a status message. */
  openEditorForPR: (pr: UserPullRequest, repo: LocalRepo, skipCheckout: boolean) => Promise<string>;
  waitForLocalRepos: () => Promise<LocalRepo[]>;

  // ─── Editor ───────────────────────────────────────────────────
  editor: ResolvedEditor | null;
  installedEditors: EditorInfo[];
  setEditor: (editor: ResolvedEditor) => void;
  setLocalRepos: (localRepos: LocalRepo[], repoScanDone?: boolean) => void;

  // ─── Actions ──────────────────────────────────────────────────
  fetchDetailsForPR: (pr: UserPullRequest) => Promise<void>;
  prefetchDetailsForPRs: (prs: UserPullRequest[]) => void;
  refreshCI: (pr: UserPullRequest) => Promise<void>;
  retryChecks: (pr: UserPullRequest) => Promise<string>;
  retryCheck: (pr: UserPullRequest, check: CheckRun) => Promise<string>;
  copyLogs: (pr: UserPullRequest, check: CheckRun) => Promise<string>;
  toggleWatch: (pr: UserPullRequest) => void;
  refreshPRs: (prs: UserPullRequest[]) => Promise<void>;
  refreshAllPRs: () => Promise<void>;
  openInBrowser: (url: string) => void;
  showStatus: (text: string) => void;
  clearStatus: () => void;
}

interface PrStoreDeps {
  fetchPRDetails: typeof fetchPRDetails;
  fetchPRDetailsBatch: typeof fetchPRDetailsBatch;
  fetchCheckLogs: typeof fetchCheckLogs;
  fetchUserPRs: typeof fetchUserPRs;
  fetchRepoPRs: typeof fetchRepoPRs;
  persistPRCache: typeof persistPRCache;
  retryFailedJobs: typeof retryFailedJobs;
  openUrl: typeof openUrl;
}

const DEFAULT_DEPS: PrStoreDeps = {
  fetchPRDetails,
  fetchPRDetailsBatch,
  fetchCheckLogs,
  fetchUserPRs,
  fetchRepoPRs,
  persistPRCache,
  retryFailedJobs,
  openUrl,
};

function prKey(pr: UserPullRequest): string {
  return `${pr.repoId}#${pr.number}`;
}

function hasCacheEntry<T>(cache: Record<string, T>, key: string): boolean {
  return Object.hasOwn(cache, key);
}

function retainCacheEntries<T>(
  cache: Record<string, T>,
  keys: ReadonlySet<string>
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(cache).filter(([key]) => keys.has(key))
  );
}

export const createPrStore = (initial: {
  prs: UserPullRequest[];
  localRepos: LocalRepo[];
  repoScanDone: boolean;
  ciCache: Map<string, CIInfo>;
  reviewCache: Map<string, ReviewInfo>;
  mergeableCache: Map<string, MergeableStatus>;
  repoMode: string | null;
  token: string;
  copyToClipboard: (text: string) => Promise<boolean>;
  onDone: (result: PrRouterResult | null) => void;
  openEditorForPR: (pr: UserPullRequest, repo: LocalRepo, skipCheckout: boolean) => Promise<string>;
  waitForLocalRepos: () => Promise<LocalRepo[]>;
  editor: ResolvedEditor | null;
  installedEditors: EditorInfo[];
}, deps: Partial<PrStoreDeps> = {}) => {
  const {
    fetchPRDetails: fetchPRDetailsImpl,
    fetchPRDetailsBatch: fetchPRDetailsBatchImpl,
    fetchCheckLogs: fetchCheckLogsImpl,
    fetchUserPRs: fetchUserPRsImpl,
    fetchRepoPRs: fetchRepoPRsImpl,
    persistPRCache: persistPRCacheImpl,
    retryFailedJobs: retryFailedJobsImpl,
    openUrl: openUrlImpl,
  } = { ...DEFAULT_DEPS, ...deps };

  return create<PrStore>((set, get) => ({
    // Internal queue state for deferred enrichment. These closures are shared by all actions.
    ...(() => {
      const DETAIL_CACHE_MAX_AGE_MS = 30_000;
      const DETAIL_PREFETCH_BATCH_SIZE = 25;
      const DETAIL_PREFETCH_BATCH_CONCURRENCY = 2;
      const inFlightDetailRequests = new Map<string, Promise<void>>();
      const queuedDetailKeys = new Set<string>();
      const detailQueue: UserPullRequest[] = [];
      let activePrefetchBatches = 0;
      let persistQueued = false;

      const schedulePersistPRCache = () => {
        if (persistQueued) return;
        persistQueued = true;
        queueMicrotask(() => {
          persistQueued = false;
          const state = get();
          persistPRCacheImpl(
            state.token,
            {
              prs: state.prs,
              ciCache: new Map(Object.entries(state.ciCache)),
              reviewCache: new Map(Object.entries(state.reviewCache)),
              mergeableCache: new Map(Object.entries(state.mergeableCache)),
            },
            state.repoMode ?? undefined
          );
        });
      };

      const hasFreshDetails = (pr: UserPullRequest): boolean => {
        const key = prKey(pr);
        const state = get();
        const ci = state.ciCache[key];
        const review = state.reviewCache[key];
        const hasMergeable = hasCacheEntry(state.mergeableCache, key);
        return (
          ci != null &&
          review != null &&
          hasMergeable &&
          Date.now() - ci.fetchedAt < DETAIL_CACHE_MAX_AGE_MS &&
          Date.now() - review.fetchedAt < DETAIL_CACHE_MAX_AGE_MS
        );
      };

      const loadDetailsForPR = async (
        pr: UserPullRequest,
        force = false
      ): Promise<void> => {
        const key = prKey(pr);
        if (!force && hasFreshDetails(pr)) return;

        const existingRequest = inFlightDetailRequests.get(key);
        if (existingRequest) {
          await existingRequest;
          return;
        }

        const request = (async () => {
          const { token } = get();
          const { ci, review, mergeable } = await fetchPRDetailsImpl(
            token,
            pr.repoOwner,
            pr.repoName,
            pr.number
          );
          set((s) => ({
            ciCache: { ...s.ciCache, [key]: ci },
            reviewCache: { ...s.reviewCache, [key]: review },
            mergeableCache: { ...s.mergeableCache, [key]: mergeable },
          }));
          schedulePersistPRCache();
        })().finally(() => {
          inFlightDetailRequests.delete(key);
        });

        inFlightDetailRequests.set(key, request);
        await request;
      };

      const loadDetailBatch = async (
        prs: UserPullRequest[]
      ): Promise<void> => {
        const batch = prs.filter((pr) => {
          const key = prKey(pr);
          return !inFlightDetailRequests.has(key) && !hasFreshDetails(pr);
        });
        if (batch.length === 0) return;

        const batchPromise = (async () => {
          const { token } = get();
          const detailsByKey = await fetchPRDetailsBatchImpl(token, batch);
          set((state) => ({
            ciCache: {
              ...state.ciCache,
              ...Object.fromEntries(
                [...detailsByKey.entries()].map(([key, detail]) => [key, detail.ci])
              ),
            },
            reviewCache: {
              ...state.reviewCache,
              ...Object.fromEntries(
                [...detailsByKey.entries()].map(([key, detail]) => [key, detail.review])
              ),
            },
            mergeableCache: {
              ...state.mergeableCache,
              ...Object.fromEntries(
                [...detailsByKey.entries()].map(([key, detail]) => [key, detail.mergeable])
              ),
            },
          }));
          schedulePersistPRCache();
        })().finally(() => {
          for (const pr of batch) {
            inFlightDetailRequests.delete(prKey(pr));
          }
        });

        for (const pr of batch) {
          inFlightDetailRequests.set(prKey(pr), batchPromise);
        }
        await batchPromise;
      };

      const pumpDetailQueue = () => {
        while (
          activePrefetchBatches < DETAIL_PREFETCH_BATCH_CONCURRENCY &&
          detailQueue.length > 0
        ) {
          const batch: UserPullRequest[] = [];

          while (
            batch.length < DETAIL_PREFETCH_BATCH_SIZE &&
            detailQueue.length > 0
          ) {
            const pr = detailQueue.shift();
            if (!pr) break;

            const key = prKey(pr);
            queuedDetailKeys.delete(key);
            if (inFlightDetailRequests.has(key) || hasFreshDetails(pr)) {
              continue;
            }
            batch.push(pr);
          }

          if (batch.length === 0) break;

          activePrefetchBatches += 1;
          void loadDetailBatch(batch)
            .catch(() => {
              // Deferred enrichment is best-effort. The detail view can retry explicitly.
            })
            .finally(() => {
              activePrefetchBatches -= 1;
              pumpDetailQueue();
            });
        }
      };

      const enqueuePrefetch = (prs: UserPullRequest[]) => {
        for (let index = prs.length - 1; index >= 0; index -= 1) {
          const pr = prs[index];
          const key = prKey(pr);
          if (
            queuedDetailKeys.has(key) ||
            inFlightDetailRequests.has(key) ||
            hasFreshDetails(pr)
          ) {
            continue;
          }
          queuedDetailKeys.add(key);
          detailQueue.unshift(pr);
        }
        pumpDetailQueue();
      };

      return {
    // ─── Data ───────────────────────────────────────────────────
    prs: initial.prs,
    localRepos: initial.localRepos,
    repoScanDone: initial.repoScanDone,
    ciCache: Object.fromEntries(initial.ciCache),
    reviewCache: Object.fromEntries(initial.reviewCache),
    mergeableCache: Object.fromEntries(initial.mergeableCache),
    watchedPRs: new Set(),

    // ─── UI state ───────────────────────────────────────────────
    ciLoading: false,
    refreshing: false,
    statusText: '',

    // ─── Config ─────────────────────────────────────────────────
    repoMode: initial.repoMode,
    token: initial.token,
    copyToClipboard: initial.copyToClipboard,
    onDone: initial.onDone,
    openEditorForPR: initial.openEditorForPR,
    waitForLocalRepos: initial.waitForLocalRepos,

    // ─── Editor ─────────────────────────────────────────────────
    editor: initial.editor,
    installedEditors: initial.installedEditors,
    setEditor: (editor) => set({ editor }),
    setLocalRepos: (localRepos, repoScanDone = true) =>
      set({ localRepos, repoScanDone }),

    // ─── Actions ────────────────────────────────────────────────

    fetchDetailsForPR: async (pr) => {
      await loadDetailsForPR(pr);
    },

    prefetchDetailsForPRs: (prs) => {
      enqueuePrefetch(prs);
    },

    refreshCI: async (pr) => {
      set({ ciLoading: true });
      try {
        await loadDetailsForPR(pr, true);
      } finally {
        set({ ciLoading: false });
      }
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
        await retryFailedJobsImpl(
          token,
          pr.repoOwner,
          pr.repoName,
          failedChecks
        );
        // Refresh after a brief delay to let GitHub register the retry
        setTimeout(() => get().refreshCI(pr), 2000);
        return `Retrying ${failedChecks.length} failed check(s)...`;
      } catch {
        return 'Failed to retry checks';
      }
    },

    retryCheck: async (pr, check) => {
      const { token } = get();
      if (check.id <= 0) return 'Cannot retry this check';
      try {
        await retryFailedJobsImpl(token, pr.repoOwner, pr.repoName, [check]);
        setTimeout(() => get().refreshCI(pr), 2000);
        return `Retrying ${check.name}...`;
      } catch {
        return 'Failed to retry check';
      }
    },

    copyLogs: async (pr, check) => {
      const { token, copyToClipboard } = get();
      const logs = await fetchCheckLogsImpl(
        token,
        pr.repoOwner,
        pr.repoName,
        check.id
      );
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

    refreshPRs: async (prs) => {
      const uniquePRs = [...new Map(prs.map((pr) => [prKey(pr), pr])).values()];
      if (uniquePRs.length === 0) return;

      const { token } = get();
      set({ refreshing: true });
      try {
        const detailsByKey = await fetchPRDetailsBatchImpl(token, uniquePRs);
        set((state) => ({
          ciCache: {
            ...state.ciCache,
            ...Object.fromEntries(
              [...detailsByKey.entries()].map(([key, detail]) => [key, detail.ci])
            ),
          },
          reviewCache: {
            ...state.reviewCache,
            ...Object.fromEntries(
              [...detailsByKey.entries()].map(([key, detail]) => [key, detail.review])
            ),
          },
          mergeableCache: {
            ...state.mergeableCache,
            ...Object.fromEntries(
              [...detailsByKey.entries()].map(([key, detail]) => [key, detail.mergeable])
            ),
          },
          refreshing: false,
        }));
        schedulePersistPRCache();
      } catch {
        set({ refreshing: false });
      }
    },

    refreshAllPRs: async () => {
      const { token, repoMode } = get();
      set({ refreshing: true });
      try {
        const result = repoMode
          ? await fetchRepoPRsImpl(token, repoMode)
          : await fetchUserPRsImpl(token);
        set((s) => {
          const nextKeys = new Set(result.prs.map((pr) => prKey(pr)));
          return {
            prs: result.prs,
            ciCache: {
              ...retainCacheEntries(s.ciCache, nextKeys),
              ...Object.fromEntries(result.ciCache),
            },
            reviewCache: {
              ...retainCacheEntries(s.reviewCache, nextKeys),
              ...Object.fromEntries(result.reviewCache),
            },
            mergeableCache: {
              ...retainCacheEntries(s.mergeableCache, nextKeys),
              ...Object.fromEntries(result.mergeableCache),
            },
            refreshing: false,
          };
        });
        schedulePersistPRCache();
      } catch {
        set({ refreshing: false });
      }
    },

    openInBrowser: (url) => openUrlImpl(url),

    showStatus: (text) => set({ statusText: text }),
    clearStatus: () => set({ statusText: '' }),
  };
    })(),
  }));
};

export type PrStoreApi = ReturnType<typeof createPrStore>;

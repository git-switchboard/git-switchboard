import { create } from 'zustand';
import {
  fetchCheckLogs,
  retryFailedJobs,
} from './github.js';
import { openUrl } from './notify.js';
import type {
  UserPullRequest,
  CheckRun,
} from './types.js';
import type { LocalRepo } from './scanner.js';
import type { ResolvedEditor, EditorInfo } from './editor.js';
import type { SortLayer } from './types.js';
import { DEFAULT_SORT } from './types.js';
import type { DataLayer, PR } from './data/index.js';

export type PrScreen =
  | { type: 'pr-list' }
  | { type: 'pr-detail'; pr: UserPullRequest; matches: LocalRepo[] }
  | { type: 'clone-prompt'; pr: UserPullRequest; matches: LocalRepo[] }
  | { type: 'debug' };

export interface PrRouterResult {
  selectedPR: UserPullRequest;
  selectedRepo?: LocalRepo;
  skipCheckout: boolean;
  newWorktreePath?: string;
}

export interface PrStore {
  // ─── Data (snapshots from DataLayer) ──────────────────────────
  prs: PR[];
  localRepos: LocalRepo[];
  repoScanDone: boolean;
  watchedPRs: Set<string>;

  // ─── UI state ─────────────────────────────────────────────────
  refreshing: boolean;
  statusText: string;

  // ─── PR list filter state (persists across navigation) ───────
  listSearchQuery: string;
  listSortLayers: SortLayer[];
  listSelectedIndex: number;
  listScrollOffset: number;
  setListSearchQuery: (query: string) => void;
  setListSortLayers: (layers: SortLayer[] | ((prev: SortLayer[]) => SortLayer[])) => void;
  setListSelectedIndex: (index: number) => void;
  setListScrollOffset: (offset: number) => void;

  // ─── Config (set once) ────────────────────────────────────────
  dataLayer: DataLayer;
  repoMode: string | null;
  token: string;
  copyToClipboard: (text: string) => Promise<boolean>;
  onDone: (result: PrRouterResult | null) => void;
  openEditorForPR: (pr: UserPullRequest, repo: LocalRepo, skipCheckout: boolean) => Promise<string>;
  waitForLocalRepos: () => Promise<LocalRepo[]>;

  // ─── Editor ───────────────────────────────────────────────────
  editor: ResolvedEditor | null;
  installedEditors: EditorInfo[];
  setEditor: (editor: ResolvedEditor) => void;
  setLocalRepos: (localRepos: LocalRepo[], repoScanDone?: boolean) => void;

  // ─── Actions ──────────────────────────────────────────────────
  prefetchDetails: (prs: UserPullRequest[]) => void;
  refreshCI: (pr: UserPullRequest) => void;
  retryChecks: (pr: UserPullRequest) => Promise<string>;
  retryCheck: (pr: UserPullRequest, check: CheckRun) => Promise<string>;
  copyLogs: (pr: UserPullRequest, check: CheckRun) => Promise<string>;
  toggleWatch: (pr: UserPullRequest) => void;
  refreshAllPRs: () => void;
  openInBrowser: (url: string) => void;
  showStatus: (text: string) => void;
  clearStatus: () => void;
  destroy: () => void;
}

interface PrStoreDeps {
  fetchCheckLogs: typeof fetchCheckLogs;
  retryFailedJobs: typeof retryFailedJobs;
  openUrl: typeof openUrl;
}

const DEFAULT_DEPS: PrStoreDeps = {
  fetchCheckLogs,
  retryFailedJobs,
  openUrl,
};

function prKey(pr: UserPullRequest): string {
  return `${pr.repoId}#${pr.number}`;
}

export const createPrStore = (initial: {
  dataLayer: DataLayer;
  localRepos: LocalRepo[];
  repoScanDone: boolean;
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
    fetchCheckLogs: fetchCheckLogsImpl,
    retryFailedJobs: retryFailedJobsImpl,
    openUrl: openUrlImpl,
  } = { ...DEFAULT_DEPS, ...deps };

  const { dataLayer } = initial;

  // Event subscriptions for reactivity
  const unsubs: (() => void)[] = [];

  const store = create<PrStore>((set, get) => {
    // Re-snapshot PRs from DataLayer when data changes
    const refreshPrSnapshot = () => {
      set({ prs: dataLayer.stores.prs.getAll() });
    };

    unsubs.push(dataLayer.bus.on('pr:discovered', refreshPrSnapshot));
    unsubs.push(dataLayer.bus.on('pr:enriched', refreshPrSnapshot));
    // Re-render when loading state changes (fetch started/completed)
    unsubs.push(dataLayer.bus.on('pr:fetchDetail', refreshPrSnapshot));
    unsubs.push(dataLayer.bus.on('linear:issue:fetch', refreshPrSnapshot));
    // Re-render when relations change (e.g., Linear ticket linked to PR)
    // or new Linear issues arrive — PrApp reads these via query API during render
    unsubs.push(dataLayer.bus.on('relation:created', refreshPrSnapshot));
    unsubs.push(dataLayer.bus.on('linear:issue:discovered', refreshPrSnapshot));
    let statusClearTimer: ReturnType<typeof setTimeout> | null = null;
    unsubs.push(dataLayer.bus.on('error', ({ source, message }) => {
      if (statusClearTimer) clearTimeout(statusClearTimer);
      set({ statusText: `[${source}] ${message}` });
      statusClearTimer = setTimeout(() => set({ statusText: '' }), 8000);
    }));

    return {
      // ─── Data ───────────────────────────────────────────────────
      prs: dataLayer.stores.prs.getAll(),
      localRepos: initial.localRepos,
      repoScanDone: initial.repoScanDone,
      watchedPRs: new Set(),

      // ─── UI state ───────────────────────────────────────────────
      refreshing: false,
      statusText: '',

      // ─── PR list filter state ─────────────────────────────────
      listSearchQuery: '',
      listSortLayers: DEFAULT_SORT,
      listSelectedIndex: 0,
      listScrollOffset: 0,
      setListSearchQuery: (query) => set({ listSearchQuery: query }),
      setListSortLayers: (layers) =>
        set((s) => ({
          listSortLayers: typeof layers === 'function' ? layers(s.listSortLayers) : layers,
        })),
      setListSelectedIndex: (index) => set({ listSelectedIndex: index }),
      setListScrollOffset: (offset) => set({ listScrollOffset: offset }),

      // ─── Config ─────────────────────────────────────────────────
      dataLayer,
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

      prefetchDetails: (prs) => {
        for (const pr of prs) {
          const key = `${pr.repoId}#${pr.number}`;
          const entity = dataLayer.stores.prs.get(key);
          // Skip if has fresh enrichment — check that CI was fetched after PR was last updated
          if (entity?.ci && entity?.review) {
            const updatedAt = new Date(entity.updatedAt).getTime();
            if (entity.ci.fetchedAt >= updatedAt) continue;
          }

          dataLayer.bus.emit('pr:fetchDetail', {
            repoId: pr.repoId,
            number: pr.number,
          });
        }
      },

      refreshCI: (pr) => {
        dataLayer.bus.emit('pr:fetchDetail', {
          repoId: pr.repoId,
          number: pr.number,
          force: true,
        });
      },

      retryChecks: async (pr) => {
        const { token } = get();
        const key = prKey(pr);
        const prEntity = dataLayer.stores.prs.get(key);
        const ci = prEntity?.ci;
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

      refreshAllPRs: () => {
        const { repoMode } = get();
        set({ refreshing: true });

        // Listen for completion — pr:discovered fires when fresh PRs are ingested
        const cleanup = () => { offDiscovered(); offError(); clearTimeout(timer); };
        const done = () => { cleanup(); set({ refreshing: false }); };
        const offDiscovered = dataLayer.bus.on('pr:discovered', done);
        const offError = dataLayer.bus.on('error', (err) => {
          if (err.source === 'pr:fetchAll') done();
        });
        const timer = setTimeout(done, 30_000);

        dataLayer.bus.emit('pr:fetchAll', { repoMode });
      },

      openInBrowser: (url) => openUrlImpl(url),

      showStatus: (text) => set({ statusText: text }),
      clearStatus: () => set({ statusText: '' }),

      destroy: () => {
        for (const unsub of unsubs) unsub();
      },
    };
  });

  return store;
};

export type PrStoreApi = ReturnType<typeof createPrStore>;

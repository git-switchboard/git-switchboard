import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useFocusedKeyboard, useFocusOwner, useFocusStackValue } from './focus-stack.js';
import { useStore } from 'zustand';
import { PrApp } from './pr-app.js';
import { PrDetail } from './pr-detail.js';
import { ClonePrompt } from './clone-prompt.js';
import { ProviderStatusModal } from './provider-status.js';
import { useExitOnCtrlC } from './use-exit-on-ctrl-c.js';
import { sendNotification } from './notify.js';
import { checkIsClean } from './scanner.js';
import type { PrStoreApi } from './store.js';
import type { PrScreen } from './store.js';
import type { LocalRepo } from './scanner.js';
import type { UserPullRequest } from './types.js';
import type { EditorInfo, ResolvedEditor } from './editor.js';
import type { DataLayer } from './data/index.js';
import { defineCommand, defineView } from './view.js';
import type { Keybind } from './view.js';
import { UP_ARROW, DOWN_ARROW, RETURN_SYMBOL, LEFT_ARROW, ESC_SYMBOL } from './unicode.js';
import { Modal, ModalRow } from './modal.js';
import { TuiRouter, useNavigate } from './tui-router.js';
import { DebugView } from './debug-view.js';

export type { PrRouterResult } from './store.js';

// ─── Store context ─────────────────────────────────────────────────────────────

const PrStoreCtx = createContext<PrStoreApi | null>(null);

function usePrStoreApi(): PrStoreApi {
  const ctx = useContext(PrStoreCtx);
  if (!ctx) throw new Error('usePrStoreApi must be used inside PrRouter');
  return ctx;
}

// ─── DataLayer context ────────────────────────────────────────────────────────

const DataLayerCtx = createContext<DataLayer | null>(null);

export function useDataLayer(): DataLayer {
  const ctx = useContext(DataLayerCtx);
  if (!ctx) throw new Error('useDataLayer must be used inside PrRouter');
  return ctx;
}

// ─── Infrastructure context ────────────────────────────────────────────────────

interface EditorModalState {
  pr: UserPullRequest;
  matches: LocalRepo[];
  selectedIndex: number;
}

interface PrInfraCtxValue {
  prepareEditorOpen: (pr: UserPullRequest, matches: LocalRepo[]) => Promise<LocalRepo[] | null>;
  getMatchesForPR: (pr: UserPullRequest, repos?: readonly LocalRepo[]) => LocalRepo[];
  setEditorModal: (state: EditorModalState | null) => void;
}

const PrInfraCtx = createContext<PrInfraCtxValue | null>(null);

function usePrInfra(): PrInfraCtxValue {
  const ctx = useContext(PrInfraCtx);
  if (!ctx) throw new Error('usePrInfra must be used inside PrRouter');
  return ctx;
}

// ─── View screen components ────────────────────────────────────────────────────

function PrListScreen({ keybinds }: { keybinds: Record<string, Keybind> }) {
  const store = usePrStoreApi();
  const dataLayer = useDataLayer();
  const prs = useStore(store, (s) => s.prs);
  const localRepos = useStore(store, (s) => s.localRepos);
  const repoMode = useStore(store, (s) => s.repoMode);
  const refreshing = useStore(store, (s) => s.refreshing);
  const searchQuery = useStore(store, (s) => s.listSearchQuery);
  const sortLayers = useStore(store, (s) => s.listSortLayers);
  const columns = useStore(store, (s) => s.listColumns);
  const filters = useStore(store, (s) => s.listFilters);
  const selectedIndex = useStore(store, (s) => s.listSelectedIndex);
  const scrollOffset = useStore(store, (s) => s.listScrollOffset);
  const storeStatusText = useStore(store, (s) => s.statusText);

  return (
    <PrApp
      keybinds={keybinds}
      prs={prs}
      localRepos={localRepos}
      dataLayer={dataLayer}
      repoMode={repoMode}
      refreshing={refreshing}
      searchQuery={searchQuery}
      setSearchQuery={store.getState().setListSearchQuery}
      sortLayers={sortLayers}
      setSortLayers={store.getState().setListSortLayers}
      columns={columns}
      setColumns={store.getState().setListColumns}
      filters={filters}
      setFilters={store.getState().setListFilters}
      selectedIndex={selectedIndex}
      setSelectedIndex={store.getState().setListSelectedIndex}
      scrollOffset={scrollOffset}
      setScrollOffset={store.getState().setListScrollOffset}
      storeStatusText={storeStatusText}
      onFetchCI={(pr) => store.getState().refreshCI(pr)}
      onPrefetchDetails={store.getState().prefetchDetails}
      onRetryChecks={async (pr) => store.getState().retryChecks(pr)}
      onRefreshAll={async (visiblePRs) => {
        store.getState().refreshAllPRs();
        // Also force-refresh detail data (including body) for visible PRs
        for (const pr of visiblePRs) {
          dataLayer.bus.emit('pr:fetchDetail', {
            repoId: pr.repoId,
            number: pr.number,
            force: true,
          });
        }
      }}
      onExit={() => store.getState().onDone(null)}
    />
  );
}

function PrDetailScreen({
  screen,
  keybinds,
}: {
  screen: Extract<PrScreen, { type: 'pr-detail' }>;
  keybinds: Record<string, Keybind>;
}) {
  const store = usePrStoreApi();
  const dataLayer = useDataLayer();
  const { prepareEditorOpen, getMatchesForPR } = usePrInfra();
  const repoScanDone = useStore(store, (s) => s.repoScanDone);
  const watchedPRs = useStore(store, (s) => s.watchedPRs);
  // Subscribe to prs snapshot so we re-render when DataLayer entities update
  const prs = useStore(store, (s) => s.prs);

  const { pr, matches } = screen;
  const prEntityKey = `${pr.repoId}#${pr.number}`;
  const currentMatches = repoScanDone || matches.length === 0 ? getMatchesForPR(pr) : matches;
  // Read fresh entity from the store snapshot (triggers re-render on pr:enriched)
  const prEntity = prs.find((p) => `${p.repoId}#${p.number}` === prEntityKey);
  const linearIssues = dataLayer.query.linearIssuesForPr(prEntityKey);
  const ciLoading = dataLayer.loading.isPrLoading(prEntityKey);

  return (
    <PrDetail
      keybinds={keybinds}
      pr={pr}
      ci={prEntity?.ci ?? null}
      review={prEntity?.review ?? null}
      linearIssues={linearIssues}
      ciLoading={ciLoading}
      matches={currentMatches}
      watched={watchedPRs.has(prEntityKey)}
      onPrepareEditorOpen={prepareEditorOpen}
      onRefreshCI={() => store.getState().refreshCI(pr)}
      onRetryChecks={async () => store.getState().retryChecks(pr)}
      onRetryCheck={async (check) => store.getState().retryCheck(pr, check)}
      onWatch={() => store.getState().toggleWatch(pr)}
      onOpenUrl={(url) => store.getState().openInBrowser(url)}
      onCopyLogs={async (check) => store.getState().copyLogs(pr, check)}
      onExit={() => store.getState().onDone(null)}
    />
  );
}

function ClonePromptScreen({
  screen,
  keybinds,
}: {
  screen: Extract<PrScreen, { type: 'clone-prompt' }>;
  keybinds: Record<string, Keybind>;
}) {
  const store = usePrStoreApi();
  const { pr, matches } = screen;

  return (
    <ClonePrompt
      keybinds={keybinds}
      repoId={pr.repoId}
      branchName={pr.headRef}
      matches={matches}
      onSelect={async (repo, alreadyCheckedOut) => {
        const msg = await store.getState().openEditorForPR(pr, repo, alreadyCheckedOut);
        store.getState().showStatus(msg);
      }}
      onCreateWorktree={(path) =>
        store.getState().onDone({ selectedPR: pr, skipCheckout: false, newWorktreePath: path })
      }
    />
  );
}

function DebugScreen() {
  const store = usePrStoreApi();
  const dataLayer = useDataLayer();
  const navigate = useNavigate<PrScreen>();

  return (
    <DebugView
      history={dataLayer.bus.history}
      onExit={() => navigate({ type: 'pr-list' })}
      copyToClipboard={store.getState().copyToClipboard}
    />
  );
}

// ─── Module-level PR_COMMAND ───────────────────────────────────────────────────

export const PR_COMMAND = defineCommand<PrScreen>()({
  name: 'pr',
  description: 'PR dashboard TUI.',
  views: {
    'pr-list': defineView<PrScreen>()({
      keybinds: {
        navigate: {
          keys: ['up', 'k', 'down', 'j'],
          label: 'j/k or Up/Down',
          description: 'Navigate',
          terminal: `[${UP_ARROW}${DOWN_ARROW}] Navigate`,
        },
        select: {
          keys: ['return'],
          label: 'Enter',
          description: 'Select PR (clone, checkout, open in editor)',
          terminal: `[${RETURN_SYMBOL}] Select`,
        },
        fetchCI: {
          keys: [{ raw: 'c' }],
          label: 'c',
          description: 'Fetch/refresh CI status',
          terminal: '[c] Fetch CI',
        },
        retryChecks: {
          keys: ['r'],
          label: 'r',
          description: 'Retry failed checks',
          terminal: '[r]etry checks',
          conditional: true,
        },
        refreshAll: {
          keys: [{ ctrl: true, name: 'r' }, { raw: 'R' }],
          label: 'Ctrl+R',
          description: 'Refresh all PRs',
          terminal: '[^R]efresh all',
        },
        sort: { keys: ['s'], label: 's', description: 'Open sort modal', terminal: '[s]ort' },
        columns: { keys: [{ raw: 'C' }], label: 'C', description: 'Configure columns', terminal: '[C]olumns' },
        filter: { keys: ['f'], label: 'f', description: 'Open filter modal', terminal: '[f]ilter' },
        providerStatus: { keys: ['p'], label: 'p', description: 'Provider status', terminal: '[p]roviders' },
        search: { keys: [{ raw: '/' }], label: '/', description: 'Search', terminal: '[/] Search' },
        debug: { keys: [{ raw: '~' }], label: '~', description: 'Debug event bus', terminal: '[~] Debug' },
        quit: { keys: ['q', 'escape'], label: 'q or Esc', description: 'Quit', terminal: '[q]uit' },
      },
      render: (_, keybinds) => <PrListScreen keybinds={keybinds} />,
    }),

    'pr-detail': defineView<PrScreen>()({
      keybinds: {
        navigate: {
          keys: ['up', 'k', 'down', 'j'],
          label: 'j/k or Up/Down',
          description: 'Navigate',
          terminal: `[${UP_ARROW}${DOWN_ARROW}] Navigate`,
        },
        select: {
          keys: ['return'],
          label: 'Enter',
          description: 'Open in editor',
          terminal: `[${RETURN_SYMBOL}] Select`,
        },
        copyLogs: {
          keys: ['c'],
          label: 'c',
          description: 'Copy check logs',
          terminal: '[c]opy logs',
        },
        refresh: {
          keys: [{ ctrl: true, name: 'r' }, { raw: 'R' }],
          label: 'Ctrl+R',
          description: 'Refresh CI',
          terminal: '[^R]efresh',
        },
        retry: {
          keys: ['r'],
          label: 'r',
          description: 'Retry failed checks',
          terminal: '[r]etry',
        },
        watch: {
          keys: ['w'],
          label: 'w',
          description: 'Toggle watch mode',
          terminal: '[w]atch',
        },
        providerStatus: { keys: ['p'], label: 'p', description: 'Provider status', terminal: '[p]roviders' },
        debug: { keys: [{ raw: '~' }], label: '~', description: 'Debug event bus', terminal: '[~] Debug' },
        back: {
          keys: ['escape', 'backspace', 'left'],
          label: 'Left, Backspace or Esc',
          description: 'Back to list',
          terminal: `[${LEFT_ARROW}] Back`,
        },
        quit: { keys: ['q'], label: 'q', description: 'Quit', terminal: '[q]uit' },
      },
      render: (s, keybinds) => (
        <PrDetailScreen
          screen={s as Extract<PrScreen, { type: 'pr-detail' }>}
          keybinds={keybinds}
        />
      ),
    }),

    'clone-prompt': defineView<PrScreen>()({
      keybinds: {
        navigate: {
          keys: ['up', 'k', 'down', 'j'],
          label: 'j/k or Up/Down',
          description: 'Navigate',
          terminal: `[${UP_ARROW}\\${DOWN_ARROW}] Navigate`,
        },
        select: {
          keys: ['return'],
          label: 'Enter',
          description: 'Select clone or create worktree',
          terminal: `[${RETURN_SYMBOL}] Select`,
        },
        back: {
          keys: ['backspace', 'escape', 'q', 'left'],
          label: 'Left, Backspace or Esc',
          description: 'Go back',
          terminal: `[${LEFT_ARROW}] Back`,
        },
        confirmInput: {
          keys: ['return'],
          label: 'Enter',
          description: 'Confirm worktree path',
          terminal: `[${RETURN_SYMBOL}] confirm`,
          conditional: true,
        },
        cancelInput: {
          keys: ['escape'],
          label: 'Esc',
          description: 'Cancel input',
          terminal: `[${ESC_SYMBOL}] cancel`,
          conditional: true,
        },
      },
      render: (s, keybinds) => (
        <ClonePromptScreen
          screen={s as Extract<PrScreen, { type: 'clone-prompt' }>}
          keybinds={keybinds}
        />
      ),
    }),

    'debug': defineView<PrScreen>()({
      keybinds: {},
      render: () => <DebugScreen />,
    }),
  },
});

// ─── Editor modal overlay (inside NavigationCtx.Provider) ─────────────────────

interface EditorModalOverlayProps extends EditorModalState {
  installedEditors: EditorInfo[];
  setEditor: (editor: ResolvedEditor) => void;
  setEditorModal: (state: EditorModalState | null) => void;
  prepareEditorOpen: (pr: UserPullRequest, matches: LocalRepo[]) => Promise<LocalRepo[] | null>;
  width: number;
  height: number;
}

function EditorModalOverlay({
  pr,
  matches,
  selectedIndex,
  installedEditors,
  setEditor,
  setEditorModal,
  prepareEditorOpen,
  width,
  height,
}: EditorModalOverlayProps) {
  const navigate = useNavigate<PrScreen>();
  useFocusOwner('editor-modal', true);

  const confirm = useCallback(async () => {
    const chosen = installedEditors[selectedIndex];
    if (!chosen || chosen.disabled) return;
    const resolved: ResolvedEditor = { command: chosen.command, dirArg: chosen.dirArg, source: 'prompt' };
    setEditor(resolved);
    setEditorModal(null);
    const cloneMatches = await prepareEditorOpen(pr, matches);
    if (cloneMatches) navigate({ type: 'clone-prompt', pr, matches: cloneMatches });
  }, [selectedIndex, installedEditors, pr, matches, setEditor, setEditorModal, prepareEditorOpen, navigate]);

  useFocusedKeyboard((key) => {
    switch (key.name) {
      case 'up':
      case 'k':
        setEditorModal({ pr, matches, selectedIndex: Math.max(0, selectedIndex - 1) });
        key.stopPropagation();
        return true;
      case 'down':
      case 'j':
        setEditorModal({
          pr,
          matches,
          selectedIndex: Math.min(installedEditors.length - 1, selectedIndex + 1),
        });
        key.stopPropagation();
        return true;
      case 'return':
        void confirm();
        key.stopPropagation();
        return true;
      case 'escape':
      case 'backspace':
      case 'q':
        setEditorModal(null);
        key.stopPropagation();
        return true;
    }
    return false;
  }, { focusId: 'editor-modal' });

  return (
    <Modal
      title="Select editor"
      onClose={() => setEditorModal(null)}
      hint={`[${UP_ARROW}${DOWN_ARROW}] Navigate | [${RETURN_SYMBOL}] Select | [Esc] Cancel`}
      width={Math.min(56, width - 8)}
      height={installedEditors.length}
      termWidth={width}
      termHeight={height}
    >
      {installedEditors.map((ed, i) => {
        const isActive = i === selectedIndex;
        const isDisabled = !!ed.disabled;
        const reason = isActive && typeof ed.disabled === 'string' ? ` — ${ed.disabled}` : '';
        return (
          <ModalRow
            key={ed.command}
            label={` ${isActive && !isDisabled ? '>' : ' '} ${ed.name}${reason}`}
            fg={isDisabled ? '#565f89' : isActive ? '#c0caf5' : '#a9b1d6'}
            active={isActive}
            onMouseDown={() => {
              if (isActive && !isDisabled) {
                void confirm();
              } else {
                setEditorModal({ pr, matches, selectedIndex: i });
              }
            }}
          />
        );
      })}
    </Modal>
  );
}

// ─── PrRouter ─────────────────────────────────────────────────────────────────

export interface PrRouterProps {
  store: PrStoreApi;
  dataLayer: DataLayer;
}

export function PrRouter({ store, dataLayer }: PrRouterProps) {
  useExitOnCtrlC();

  const localRepos = useStore(store, (s) => s.localRepos);
  const repoScanDone = useStore(store, (s) => s.repoScanDone);
  const installedEditors = useStore(store, (s) => s.installedEditors);

  const { width, height } = useTerminalDimensions();
  const [editorModal, setEditorModal] = useState<EditorModalState | null>(null);
  const [showProviderStatus, setShowProviderStatus] = useState(false);
  const focusStack = useFocusStackValue();

  // ─── Provider status shortcut ─────────────────────────────────────
  // Gate on focus stack so text inputs (search, filter name) aren't intercepted.
  useKeyboard((key) => {
    if (!editorModal && !showProviderStatus && focusStack.stack.length === 0 && key.raw === 'p') {
      setShowProviderStatus(true);
      key.stopPropagation();
      return true;
    }
  });

  // ─── Watch polling ──────────────────────────────────────────────
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    const interval = setInterval(async () => {
      const s = storeRef.current.getState();
      if (s.watchedPRs.size === 0) return;
      for (const key of s.watchedPRs) {
        const match = key.match(/^(.+)#(\d+)$/);
        if (!match) continue;
        const pr = s.prs.find((p) => p.repoId === match[1] && p.number === Number(match[2]));
        if (!pr) continue;
        const oldCI = s.dataLayer.stores.prs.get(key)?.ci;
        s.refreshCI(pr);
        // Check for status transitions after enrichment arrives
        const offEnriched = s.dataLayer.bus.on('pr:enriched', (enriched) => {
          if (`${enriched.repoId}#${enriched.number}` !== key) return;
          offEnriched();
          const newCI = enriched.ci;
          if (oldCI?.status === 'pending' && newCI && newCI.status !== 'pending' && newCI.status !== 'unknown') {
            const icon = newCI.status === 'passing' ? '\u2713' : '\u2717';
            sendNotification(
              `git-switchboard: CI ${newCI.status}`,
              `${icon} ${pr.repoOwner}/${pr.repoName}#${pr.number}: ${pr.title}`
            );
          }
        });
        // Clean up listener after timeout
        setTimeout(offEnriched, 15_000);
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  // ─── Match helpers ──────────────────────────────────────────────
  const getMatchesForPR = useCallback(
    (pr: UserPullRequest, repos: readonly LocalRepo[] = localRepos) =>
      repos.filter((r) => r.repoId === pr.repoId || r.repoId === pr.forkRepoId),
    [localRepos]
  );

  // ─── Editor open coordination ───────────────────────────────────
  const prepareEditorOpen = useCallback(
    async (pr: UserPullRequest, matches: LocalRepo[]): Promise<LocalRepo[] | null> => {
      const { setLocalRepos, waitForLocalRepos, openEditorForPR, showStatus } = store.getState();
      let currentMatches = matches;
      if (!repoScanDone) {
        const repos = await waitForLocalRepos();
        setLocalRepos(repos, true);
        currentMatches = getMatchesForPR(pr, repos);
      }

      const selectableCount = installedEditors.filter((e) => !e.disabled).length;
      if (!store.getState().editor && selectableCount > 1) {
        setEditorModal({ pr, matches: currentMatches, selectedIndex: 0 });
        return null;
      }

      const onBranch = currentMatches.filter((r) => r.currentBranch === pr.headRef);
      if (onBranch.length === 1) {
        const msg = await openEditorForPR(pr, onBranch[0], true);
        showStatus(msg);
        return null;
      }

      const cleanResults = await Promise.all(currentMatches.map((r) => checkIsClean(r.path)));
      const cleanMatches = currentMatches.filter((_, i) => cleanResults[i]);
      if (cleanMatches.length === 1) {
        const msg = await openEditorForPR(pr, cleanMatches[0], false);
        showStatus(msg);
        return null;
      }

      return currentMatches.map((r, i) => ({ ...r, isClean: cleanResults[i] }));
    },
    [repoScanDone, localRepos, installedEditors, getMatchesForPR, store]
  );

  // ─── Infra context value ────────────────────────────────────────
  const infra = useMemo<PrInfraCtxValue>(
    () => ({ prepareEditorOpen, getMatchesForPR, setEditorModal }),
    [prepareEditorOpen, getMatchesForPR]
  );

  // ─── Editor modal overlay ───────────────────────────────────────
  const editorModalOverlay = editorModal && (
    <EditorModalOverlay
      {...editorModal}
      installedEditors={installedEditors}
      setEditor={store.getState().setEditor}
      setEditorModal={setEditorModal}
      prepareEditorOpen={prepareEditorOpen}
      width={width}
      height={height}
    />
  );

  const combinedOverlay = (
    <>
      {editorModalOverlay}
      {showProviderStatus && (
        <ProviderStatusModal
          width={width}
          height={height}
          onClose={() => setShowProviderStatus(false)}
        />
      )}
    </>
  );

  return (
    <DataLayerCtx.Provider value={dataLayer}>
      <PrStoreCtx.Provider value={store}>
        <PrInfraCtx.Provider value={infra}>
          <TuiRouter<PrScreen>
            views={PR_COMMAND.views}
            initialScreen={{ type: 'pr-list' }}
            overlay={combinedOverlay}
            focusStack={focusStack}
          />
        </PrInfraCtx.Provider>
      </PrStoreCtx.Provider>
    </DataLayerCtx.Provider>
  );
}

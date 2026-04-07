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
import { useStore } from 'zustand';
import { PrApp } from './pr-app.js';
import { PrDetail } from './pr-detail.js';
import { ClonePrompt } from './clone-prompt.js';
import { useExitOnCtrlC } from './use-exit-on-ctrl-c.js';
import { sendNotification } from './notify.js';
import { checkIsClean } from './scanner.js';
import type { PrStoreApi } from './store.js';
import type { PrScreen } from './store.js';
import type { LocalRepo } from './scanner.js';
import type { UserPullRequest } from './types.js';
import type { EditorInfo, ResolvedEditor } from './editor.js';
import { defineCommand, defineView } from './view.js';
import type { Keybind } from './view.js';
import { UP_ARROW, DOWN_ARROW, RETURN_SYMBOL, LEFT_ARROW, ESC_SYMBOL } from './unicode.js';
import { TuiRouter, useNavigate } from './tui-router.js';

export type { PrRouterResult } from './store.js';

// ─── Store context ─────────────────────────────────────────────────────────────

const PrStoreCtx = createContext<PrStoreApi | null>(null);

function usePrStoreApi(): PrStoreApi {
  const ctx = useContext(PrStoreCtx);
  if (!ctx) throw new Error('usePrStoreApi must be used inside PrRouter');
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
  const prs = useStore(store, (s) => s.prs);
  const localRepos = useStore(store, (s) => s.localRepos);
  const ciCache = useStore(store, (s) => s.ciCache);
  const reviewCache = useStore(store, (s) => s.reviewCache);
  const mergeableCache = useStore(store, (s) => s.mergeableCache);
  const repoMode = useStore(store, (s) => s.repoMode);
  const refreshing = useStore(store, (s) => s.refreshing);

  const ciMap = useMemo(() => new Map(Object.entries(ciCache)), [ciCache]);
  const reviewMap = useMemo(() => new Map(Object.entries(reviewCache)), [reviewCache]);

  return (
    <PrApp
      keybinds={keybinds}
      prs={prs}
      localRepos={localRepos}
      ciCache={ciMap}
      reviewCache={reviewMap}
      mergeableCache={mergeableCache}
      repoMode={repoMode}
      refreshing={refreshing}
      onFetchCI={async (pr) => store.getState().fetchDetailsForPR(pr)}
      onPrefetchDetails={store.getState().prefetchDetailsForPRs}
      onRetryChecks={async (pr) => store.getState().retryChecks(pr)}
      onRefreshAll={async (allPrs) => store.getState().refreshPRs(allPrs)}
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
  const { prepareEditorOpen, getMatchesForPR } = usePrInfra();
  const ciCache = useStore(store, (s) => s.ciCache);
  const reviewCache = useStore(store, (s) => s.reviewCache);
  const ciLoading = useStore(store, (s) => s.ciLoading);
  const repoScanDone = useStore(store, (s) => s.repoScanDone);
  const watchedPRs = useStore(store, (s) => s.watchedPRs);

  const { pr, matches } = screen;
  const prKey = `${pr.repoId}#${pr.number}`;
  const currentMatches = repoScanDone || matches.length === 0 ? getMatchesForPR(pr) : matches;

  return (
    <PrDetail
      keybinds={keybinds}
      pr={pr}
      ci={ciCache[prKey] ?? null}
      review={reviewCache[prKey] ?? null}
      ciLoading={ciLoading}
      matches={currentMatches}
      watched={watchedPRs.has(prKey)}
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
          keys: ['c'],
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
        search: { keys: [{ raw: '/' }], label: '/', description: 'Search', terminal: '[/] Search' },
        quit: { keys: ['q', 'escape'], label: 'q or Esc', description: 'Quit', terminal: '[q]uit' },
      },
      render: (_, keybinds) => <PrListScreen keybinds={keybinds} />,
    }),

    'pr-detail': defineView<PrScreen>()({
      keybinds: {
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

  const confirm = useCallback(async () => {
    const chosen = installedEditors[selectedIndex];
    if (!chosen || chosen.disabled) return;
    const resolved: ResolvedEditor = { command: chosen.command, dirArg: chosen.dirArg, source: 'prompt' };
    setEditor(resolved);
    setEditorModal(null);
    const cloneMatches = await prepareEditorOpen(pr, matches);
    if (cloneMatches) navigate({ type: 'clone-prompt', pr, matches: cloneMatches });
  }, [selectedIndex, installedEditors, pr, matches, setEditor, setEditorModal, prepareEditorOpen, navigate]);

  useKeyboard((key) => {
    switch (key.name) {
      case 'up':
      case 'k':
        setEditorModal({ pr, matches, selectedIndex: Math.max(0, selectedIndex - 1) });
        return true;
      case 'down':
      case 'j':
        setEditorModal({
          pr,
          matches,
          selectedIndex: Math.min(installedEditors.length - 1, selectedIndex + 1),
        });
        return true;
      case 'return':
        void confirm();
        return true;
      case 'escape':
      case 'q':
        setEditorModal(null);
        return true;
    }
    return false;
  });

  const modalWidth = Math.min(60, width - 4);
  return (
    <box
      style={{
        position: 'absolute',
        top: Math.floor(height / 2) - Math.floor(installedEditors.length / 2) - 2,
        left: Math.floor(width / 2) - Math.floor(modalWidth / 2),
        width: modalWidth,
        height: installedEditors.length + 4,
      }}
    >
      <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
        <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
          <text content=" Select editor" fg="#7aa2f7" />
        </box>
        <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
          <text content={'─'.repeat(modalWidth)} fg="#292e42" />
        </box>
        {installedEditors.map((ed, i) => {
          const isActive = i === selectedIndex;
          const isDisabled = !!ed.disabled;
          const reason = isActive && typeof ed.disabled === 'string' ? ` — ${ed.disabled}` : '';
          const label = ` ${isActive && !isDisabled ? '>' : ' '} ${ed.name}${reason}`;
          const fg = isDisabled ? '#565f89' : isActive ? '#c0caf5' : '#a9b1d6';
          return (
            <box
              key={ed.command}
              style={{ height: 1, width: '100%', backgroundColor: isActive ? '#292e42' : '#1a1b26' }}
              onMouseDown={() => {
                if (isActive && !isDisabled) {
                  void confirm();
                } else {
                  setEditorModal({ pr, matches, selectedIndex: i });
                }
              }}
            >
              <text content={label} fg={fg} />
            </box>
          );
        })}
        <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
          <text
            content={` [${UP_ARROW}${DOWN_ARROW}] Navigate | [${RETURN_SYMBOL}] Select | [Esc] Cancel`}
            fg="#565f89"
          />
        </box>
      </box>
    </box>
  );
}

// ─── PrRouter ─────────────────────────────────────────────────────────────────

export interface PrRouterProps {
  store: PrStoreApi;
}

export function PrRouter({ store }: PrRouterProps) {
  useExitOnCtrlC();

  const localRepos = useStore(store, (s) => s.localRepos);
  const repoScanDone = useStore(store, (s) => s.repoScanDone);
  const installedEditors = useStore(store, (s) => s.installedEditors);

  const { width, height } = useTerminalDimensions();
  const [editorModal, setEditorModal] = useState<EditorModalState | null>(null);

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
        const oldCI = s.ciCache[key];
        await s.fetchDetailsForPR(pr);
        const newCI = storeRef.current.getState().ciCache[key];
        if (oldCI?.status === 'pending' && newCI && newCI.status !== 'pending' && newCI.status !== 'unknown') {
          const icon = newCI.status === 'passing' ? '\u2713' : '\u2717';
          sendNotification(
            `git-switchboard: CI ${newCI.status}`,
            `${icon} ${pr.repoOwner}/${pr.repoName}#${pr.number}: ${pr.title}`
          );
        }
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

  return (
    <PrStoreCtx.Provider value={store}>
      <PrInfraCtx.Provider value={infra}>
        <TuiRouter<PrScreen>
          views={PR_COMMAND.views}
          initialScreen={{ type: 'pr-list' }}
          overlay={editorModalOverlay}
        />
      </PrInfraCtx.Provider>
    </PrStoreCtx.Provider>
  );
}

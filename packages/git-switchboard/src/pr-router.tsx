import { useEffect, useRef, useState, useCallback } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useStore } from 'zustand';
import { PrApp } from './pr-app.js';
import { PrDetail } from './pr-detail.js';
import { ClonePrompt } from './clone-prompt.js';
import { useExitOnCtrlC } from './use-exit-on-ctrl-c.js';
import { sendNotification } from './notify.js';
import { checkIsClean } from './scanner.js';
import type { PrStoreApi } from './store.js';
import type { LocalRepo } from './scanner.js';
import type { UserPullRequest } from './types.js';
import { UP_ARROW, DOWN_ARROW, RETURN_SYMBOL } from './unicode.js';

export type { PrRouterResult } from './store.js';

export interface PrRouterProps {
  store: PrStoreApi;
}

export function PrRouter({ store }: PrRouterProps) {
  useExitOnCtrlC();

  const screen = useStore(store, (s) => s.screen);
  const prs = useStore(store, (s) => s.prs);
  const localRepos = useStore(store, (s) => s.localRepos);
  const ciCache = useStore(store, (s) => s.ciCache);
  const reviewCache = useStore(store, (s) => s.reviewCache);
  const mergeableCache = useStore(store, (s) => s.mergeableCache);
  const repoMode = useStore(store, (s) => s.repoMode);
  const ciLoading = useStore(store, (s) => s.ciLoading);
  const refreshing = useStore(store, (s) => s.refreshing);
  const watchedPRs = useStore(store, (s) => s.watchedPRs);
  const onDone = useStore(store, (s) => s.onDone);
  const installedEditors = useStore(store, (s) => s.installedEditors);

  const {
    navigate,
    fetchDetailsForPR,
    prefetchDetailsForPRs,
    refreshCI,
    retryChecks,
    copyLogs,
    toggleWatch,
    openInBrowser,
    openEditorForPR,
    refreshAllPRs,
    setEditor,
  } = store.getState();

  // ─── Editor picker modal state ────────────────────────────────
  const { width, height } = useTerminalDimensions();
  const [editorModal, setEditorModal] = useState<{
    pr: UserPullRequest;
    matches: LocalRepo[];
    selectedIndex: number;
  } | null>(null);

  const handleEditorModalKey = useCallback(
    (key: { name: string; raw?: string }) => {
      if (!editorModal) return false;
      switch (key.name) {
        case 'up':
        case 'k':
          setEditorModal((m) =>
            m ? { ...m, selectedIndex: Math.max(0, m.selectedIndex - 1) } : m
          );
          return true;
        case 'down':
        case 'j':
          setEditorModal((m) =>
            m
              ? {
                  ...m,
                  selectedIndex: Math.min(
                    installedEditors.length - 1,
                    m.selectedIndex + 1
                  ),
                }
              : m
          );
          return true;
        case 'return': {
          const chosen = installedEditors[editorModal.selectedIndex];
          if (chosen && !chosen.disabled) {
            const resolved = {
              command: chosen.command,
              dirArg: chosen.dirArg,
              source: 'prompt' as const,
            };
            setEditor(resolved);
            const { pr, matches } = editorModal;
            setEditorModal(null);
            // Proceed with the original open-in-editor flow
            handleOpenInEditor(pr, matches);
          }
          return true;
        }
        case 'escape':
        case 'q':
          setEditorModal(null);
          return true;
      }
      return false;
    },
    [editorModal, installedEditors, setEditor]
  );

  useKeyboard((key) => {
    handleEditorModalKey(key);
  });

  // ─── Watch polling ────────────────────────────────────────────

  // Use a ref for polling so the interval closure always sees fresh state
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    const interval = setInterval(async () => {
      const s = storeRef.current.getState();
      if (s.watchedPRs.size === 0) return;

      for (const key of s.watchedPRs) {
        const match = key.match(/^(.+)#(\d+)$/);
        if (!match) continue;
        const pr = s.prs.find(
          (p) => p.repoId === match[1] && p.number === Number(match[2])
        );
        if (!pr) continue;
        const oldCI = s.ciCache[key];
        await s.fetchDetailsForPR(pr);
        const newCI = storeRef.current.getState().ciCache[key];
        if (
          oldCI &&
          oldCI.status === 'pending' &&
          newCI &&
          newCI.status !== 'pending' &&
          newCI.status !== 'unknown'
        ) {
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

  // ─── Helper: open in editor (clone selection logic) ───────────

  const handleOpenInEditor = async (pr: typeof prs[number], matches: LocalRepo[]) => {
    // If no editor resolved yet and multiple selectable editors are installed, show picker modal
    const selectableCount = installedEditors.filter((e) => !e.disabled).length;
    if (!store.getState().editor && selectableCount > 1) {
      setEditorModal({ pr, matches, selectedIndex: 0 });
      return;
    }

    // Prefer clone already on the right branch
    const onBranch = matches.filter((r) => r.currentBranch === pr.headRef);
    if (onBranch.length === 1) {
      const msg = await openEditorForPR(pr, onBranch[0], true);
      store.getState().showStatus(msg);
      return;
    }

    // Check clean status lazily (expensive — deferred from scan)
    const cleanResults = await Promise.all(
      matches.map((r) => checkIsClean(r.path))
    );
    const cleanMatches = matches.filter((_, i) => cleanResults[i]);

    if (cleanMatches.length === 1) {
      const msg = await openEditorForPR(pr, cleanMatches[0], false);
      store.getState().showStatus(msg);
      return;
    }

    // Update isClean on matches for clone prompt display
    const updatedMatches = matches.map((r, i) => ({
      ...r,
      isClean: cleanResults[i],
    }));
    navigate({ type: 'clone-prompt', pr, matches: updatedMatches });
  };

  // ─── Render active screen ─────────────────────────────────────

  // Convert Record back to Map for components that expect it
  const ciMap = new Map(Object.entries(ciCache));
  const reviewMap = new Map(Object.entries(reviewCache));

  // Editor picker modal overlay
  const modalWidth = Math.min(60, width - 4);
  const editorModalOverlay = editorModal && (
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
        {/* Title bar */}
        <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
          <text content=" Select editor" fg="#7aa2f7" />
        </box>
        {/* Border */}
        <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
          <text content={'─'.repeat(modalWidth)} fg="#292e42" />
        </box>
        {/* Editor options */}
        {installedEditors.map((ed, i) => {
          const isActive = i === editorModal.selectedIndex;
          const isDisabled = !!ed.disabled;
          const reason = isActive && typeof ed.disabled === 'string' ? ` — ${ed.disabled}` : '';
          const label = ` ${isActive && !isDisabled ? '>' : ' '} ${ed.name}${reason}`;
          const fg = isDisabled
            ? '#565f89'
            : isActive ? '#c0caf5' : '#a9b1d6';
          return (
            <box
              key={ed.command}
              style={{
                height: 1,
                width: '100%',
                backgroundColor: isActive ? '#292e42' : '#1a1b26',
              }}
              onMouseDown={() => {
                if (isActive && !isDisabled) {
                  const resolved = {
                    command: ed.command,
                    dirArg: ed.dirArg,
                    source: 'prompt' as const,
                  };
                  setEditor(resolved);
                  const { pr, matches } = editorModal;
                  setEditorModal(null);
                  handleOpenInEditor(pr, matches);
                } else {
                  setEditorModal({ ...editorModal, selectedIndex: i });
                }
              }}
            >
              <text content={label} fg={fg} />
            </box>
          );
        })}
        {/* Hint */}
        <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
          <text
            content={` [${UP_ARROW}${DOWN_ARROW}] Navigate | [${RETURN_SYMBOL}] Select | [Esc] Cancel`}
            fg="#565f89"
          />
        </box>
      </box>
    </box>
  );

  switch (screen.type) {
    case 'pr-list':
      return (
        <>
          <PrApp
            prs={prs}
            localRepos={localRepos}
            ciCache={ciMap}
            reviewCache={reviewMap}
            mergeableCache={mergeableCache}
            repoMode={repoMode}
            refreshing={refreshing}
            onSelect={(pr, matches) => {
              navigate({ type: 'pr-detail', pr, matches });
            }}
            onFetchCI={async (pr) => {
              await fetchDetailsForPR(pr);
            }}
            onPrefetchDetails={prefetchDetailsForPRs}
            onRetryChecks={async (pr) => retryChecks(pr)}
            onRefreshAll={() => refreshAllPRs()}
            onExit={() => onDone(null)}
          />
          {editorModalOverlay}
        </>
      );

    case 'pr-detail': {
      const { pr, matches } = screen;
      const prKey = `${pr.repoId}#${pr.number}`;
      return (
        <>
          <PrDetail
            pr={pr}
            ci={ciCache[prKey] ?? null}
            review={reviewCache[prKey] ?? null}
            ciLoading={ciLoading}
            matches={matches}
            watched={watchedPRs.has(prKey)}
            onOpenInEditor={() => handleOpenInEditor(pr, matches)}
            onBack={() => navigate({ type: 'pr-list' })}
            onRefreshCI={() => refreshCI(pr)}
            onRetryChecks={async () => retryChecks(pr)}
            onRetryCheck={async (check) => store.getState().retryCheck(pr, check)}
            onWatch={() => toggleWatch(pr)}
            onOpenUrl={(url) => openInBrowser(url)}
            onCopyLogs={async (check) => copyLogs(pr, check)}
            onExit={() => onDone(null)}
          />
          {editorModalOverlay}
        </>
      );
    }

    case 'clone-prompt': {
      const { pr, matches } = screen;
      return (
        <>
          <ClonePrompt
            repoId={pr.repoId}
            branchName={pr.headRef}
            matches={matches}
            onSelect={async (repo, alreadyCheckedOut) => {
              const msg = await openEditorForPR(pr, repo, alreadyCheckedOut);
              store.getState().showStatus(msg);
              navigate({ type: 'pr-detail', pr, matches });
            }}
            onCreateWorktree={(path) => {
              onDone({ selectedPR: pr, skipCheckout: false, newWorktreePath: path });
            }}
            onCancel={() => navigate({ type: 'pr-detail', pr, matches })}
          />
          {editorModalOverlay}
        </>
      );
    }
  }
}

import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { PrApp } from './pr-app.js';
import { PrDetail } from './pr-detail.js';
import { ClonePrompt } from './clone-prompt.js';
import { useExitOnCtrlC } from './use-exit-on-ctrl-c.js';
import { sendNotification } from './notify.js';
import type { PrStoreApi, PrRouterResult } from './store.js';
import type { LocalRepo } from './scanner.js';

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
  const ciLoading = useStore(store, (s) => s.ciLoading);
  const watchedPRs = useStore(store, (s) => s.watchedPRs);
  const onDone = useStore(store, (s) => s.onDone);

  const {
    navigate,
    fetchDetailsForPR,
    refreshCI,
    retryChecks,
    copyLogs,
    toggleWatch,
    openInBrowser,
  } = store.getState();

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

  const handleOpenInEditor = (pr: typeof prs[number], matches: LocalRepo[]) => {
    const onBranch = matches.filter((r) => r.currentBranch === pr.headRef);
    if (onBranch.length === 1) {
      onDone({ selectedPR: pr, selectedRepo: onBranch[0], skipCheckout: true });
      return;
    }
    const cleanMatches = matches.filter((r) => r.isClean);
    if (cleanMatches.length === 1) {
      onDone({ selectedPR: pr, selectedRepo: cleanMatches[0], skipCheckout: false });
      return;
    }
    navigate({ type: 'clone-prompt', pr, matches });
  };

  // ─── Render active screen ─────────────────────────────────────

  // Convert Record back to Map for components that expect it
  const ciMap = new Map(Object.entries(ciCache));
  const reviewMap = new Map(Object.entries(reviewCache));

  switch (screen.type) {
    case 'pr-list':
      return (
        <PrApp
          prs={prs}
          localRepos={localRepos}
          ciCache={ciMap}
          reviewCache={reviewMap}
          onSelect={(pr, matches) => {
            navigate({ type: 'pr-detail', pr, matches });
          }}
          onFetchCI={async (pr) => {
            await fetchDetailsForPR(pr);
          }}
          onExit={() => onDone(null)}
        />
      );

    case 'pr-detail': {
      const { pr, matches } = screen;
      const prKey = `${pr.repoId}#${pr.number}`;
      return (
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
          onRetryChecks={async () => {
            const msg = await retryChecks(pr);
            return msg;
          }}
          onWatch={() => toggleWatch(pr)}
          onOpenUrl={(url) => openInBrowser(url)}
          onCopyLogs={async (check) => copyLogs(pr, check)}
          onExit={() => onDone(null)}
        />
      );
    }

    case 'clone-prompt': {
      const { pr, matches } = screen;
      return (
        <ClonePrompt
          repoId={pr.repoId}
          branchName={pr.headRef}
          matches={matches}
          onSelect={(repo, alreadyCheckedOut) => {
            onDone({
              selectedPR: pr,
              selectedRepo: repo,
              skipCheckout: alreadyCheckedOut,
            });
          }}
          onCreateWorktree={(path) => {
            onDone({ selectedPR: pr, skipCheckout: false, newWorktreePath: path });
          }}
          onCancel={() => navigate({ type: 'pr-detail', pr, matches })}
        />
      );
    }
  }
}

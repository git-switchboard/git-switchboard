import { useState, useCallback, useEffect } from 'react';
import { rateLimit, fetchPRDetails, fetchCheckLogs } from './github.js';
import { openUrl } from './notify.js';
import { PrApp } from './pr-app.js';
import { PrDetail } from './pr-detail.js';
import { ClonePrompt } from './clone-prompt.js';
import { EditorPrompt } from './editor-prompt.js';
import { useExitOnCtrlC } from './use-exit-on-ctrl-c.js';
import type { UserPullRequest, CIInfo, ReviewInfo, CheckRun } from './types.js';
import type { LocalRepo } from './scanner.js';
import type { EditorInfo, ResolvedEditor } from './editor.js';

type Screen =
  | { type: 'pr-list' }
  | { type: 'pr-detail'; pr: UserPullRequest; matches: LocalRepo[] }
  | { type: 'clone-prompt'; pr: UserPullRequest; matches: LocalRepo[] }
  | { type: 'editor-prompt'; editors: EditorInfo[]; targetDir: string };

export interface PrRouterProps {
  prs: UserPullRequest[];
  localRepos: LocalRepo[];
  initialCICache: Map<string, CIInfo>;
  initialReviewCache: Map<string, ReviewInfo>;
  token: string;
  onDone: (result: PrRouterResult | null) => void;
  findInstalledEditors: () => EditorInfo[];
  resolveEditor: (flag?: string) => ResolvedEditor | null;
  editorFlag?: string;
  copyToClipboard: (text: string) => Promise<boolean>;
}

export interface PrRouterResult {
  selectedPR: UserPullRequest;
  selectedRepo?: LocalRepo;
  skipCheckout: boolean;
  newWorktreePath?: string;
  editor?: ResolvedEditor;
}

export function PrRouter({
  prs,
  localRepos,
  initialCICache,
  initialReviewCache,
  token,
  onDone,
  findInstalledEditors,
  resolveEditor,
  editorFlag,
  copyToClipboard,
}: PrRouterProps) {
  useExitOnCtrlC();

  const [screen, setScreen] = useState<Screen>({ type: 'pr-list' });
  const [ciCache] = useState(() => new Map(initialCICache));
  const [reviewCache] = useState(() => new Map(initialReviewCache));
  const [watchedPRs] = useState(() => new Set<string>());
  const [ciLoading, setCILoading] = useState(false);
  const [, forceRender] = useState(0);
  const bump = () => forceRender((n) => n + 1);

  // ─── Shared helpers ───────────────────────────────────────────

  const fetchDetails = useCallback(
    async (pr: UserPullRequest) => {
      const { ci, review } = await fetchPRDetails(
        token,
        pr.repoOwner,
        pr.repoName,
        pr.number
      );
      const key = `${pr.repoId}#${pr.number}`;
      ciCache.set(key, ci);
      reviewCache.set(key, review);
    },
    [token, ciCache, reviewCache]
  );

  const handleOpenInEditor = useCallback(
    (pr: UserPullRequest, matches: LocalRepo[]) => {
      const onBranch = matches.filter(
        (r) => r.currentBranch === pr.headRef
      );
      if (onBranch.length === 1) {
        onDone({
          selectedPR: pr,
          selectedRepo: onBranch[0],
          skipCheckout: true,
        });
        return;
      }
      const cleanMatches = matches.filter((r) => r.isClean);
      if (cleanMatches.length === 1) {
        onDone({
          selectedPR: pr,
          selectedRepo: cleanMatches[0],
          skipCheckout: false,
        });
        return;
      }
      setScreen({ type: 'clone-prompt', pr, matches });
    },
    [onDone]
  );

  // ─── Watch polling ────────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(async () => {
      if (watchedPRs.size === 0) return;
      const { sendNotification } = await import('./notify.js');
      for (const key of watchedPRs) {
        const match = key.match(/^(.+)#(\d+)$/);
        if (!match) continue;
        const pr = prs.find(
          (p) => p.repoId === match[1] && p.number === Number(match[2])
        );
        if (!pr) continue;
        const oldCI = ciCache.get(key);
        await fetchDetails(pr);
        const newCI = ciCache.get(key);
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
      bump();
    }, 30_000);
    return () => clearInterval(interval);
  }, [prs, watchedPRs, ciCache, fetchDetails]);

  // ─── Render active screen ─────────────────────────────────────

  switch (screen.type) {
    case 'pr-list':
      return (
        <PrApp
          prs={prs}
          localRepos={localRepos}
          ciCache={ciCache}
          reviewCache={reviewCache}
          onSelect={(pr, matches) => {
            setScreen({ type: 'pr-detail', pr, matches });
          }}
          onFetchCI={async (pr) => {
            await fetchDetails(pr);
            bump();
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
          ci={ciCache.get(prKey) ?? null}
          review={reviewCache.get(prKey) ?? null}
          ciLoading={ciLoading}
          matches={matches}
          watched={watchedPRs.has(prKey)}
          onOpenInEditor={() => handleOpenInEditor(pr, matches)}
          onBack={() => setScreen({ type: 'pr-list' })}
          onRefreshCI={() => {
            setCILoading(true);
            fetchDetails(pr).then(() => {
              setCILoading(false);
              bump();
            });
          }}
          onWatch={() => {
            if (watchedPRs.has(prKey)) {
              watchedPRs.delete(prKey);
            } else {
              watchedPRs.add(prKey);
            }
            bump();
          }}
          onOpenUrl={(url) => openUrl(url)}
          onCopyLogs={async (check: CheckRun) => {
            const logs = await fetchCheckLogs(
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
          }}
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
            onDone({
              selectedPR: pr,
              skipCheckout: false,
              newWorktreePath: path,
            });
          }}
          onCancel={() => {
            setScreen({ type: 'pr-detail', pr, matches });
          }}
        />
      );
    }

    case 'editor-prompt': {
      const { editors } = screen;
      return (
        <EditorPrompt
          editors={editors}
          onSelect={(editorInfo) => {
            // This case is handled after TUI exits
          }}
          onCancel={() => onDone(null)}
        />
      );
    }
  }
}

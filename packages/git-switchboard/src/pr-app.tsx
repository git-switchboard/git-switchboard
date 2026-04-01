import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { rateLimit } from './github.js';
import type { LocalRepo } from './scanner.js';
import type {
  CIInfo,
  ReviewInfo,
  ReviewStatus,
  UserPullRequest,
} from './types.js';
import {
  CHECKMARK,
  CROSSMARK,
  DOWN_ARROW,
  RETURN_SYMBOL,
  UP_ARROW,
} from './unicode.js';
import { useExitOnCtrlC } from './use-exit-on-ctrl-c.js';

function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

const SPINNER_FRAMES = ['|', '/', '-', '\\'];

function ciSummary(
  ci: CIInfo | undefined,
  spinnerChar: string
): { text: string; fg: string } {
  if (!ci || ci.checks.length === 0) return { text: '?', fg: '#565f89' };
  const pass = ci.checks.filter(
    (c) =>
      c.status === 'completed' &&
      (c.conclusion === 'success' ||
        c.conclusion === 'skipped' ||
        c.conclusion === 'neutral')
  ).length;
  const fail = ci.checks.filter(
    (c) => c.status === 'completed' && c.conclusion === 'failure'
  ).length;
  const pending = ci.checks.filter((c) => c.status !== 'completed').length;

  const parts: string[] = [];
  if (pass > 0) parts.push(`${pass}${CHECKMARK}`);
  if (fail > 0) parts.push(`${fail}${CROSSMARK}`);
  if (pending > 0) parts.push(`${pending}${spinnerChar}`);

  const fg = fail > 0 ? '#f7768e' : pending > 0 ? '#e0af68' : '#9ece6a';
  return { text: parts.join(' '), fg };
}

function reviewLabel(status: ReviewStatus): { text: string; fg: string } {
  switch (status) {
    case 'approved':
      return { text: `${CHECKMARK} Approved`, fg: '#9ece6a' };
    case 'changes-requested':
      return { text: CROSSMARK + ' Changes req', fg: '#f7768e' };
    case 're-review-needed':
      return { text: '~ Re-review', fg: '#e0af68' };
    default:
      return { text: 'Needs review', fg: '#565f89' };
  }
}

interface PrAppProps {
  prs: UserPullRequest[];
  localRepos: LocalRepo[];
  ciCache: Map<string, CIInfo>;
  reviewCache: Map<string, ReviewInfo>;
  onSelect: (pr: UserPullRequest, matches: LocalRepo[]) => void;
  onFetchCI: (pr: UserPullRequest) => void;
  onExit: () => void;
}

export function PrApp({
  prs,
  localRepos,
  ciCache,
  reviewCache,
  onSelect,
  onFetchCI,
  onExit,
}: PrAppProps) {
  useExitOnCtrlC();
  const { width, height } = useTerminalDimensions();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState(false);
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  // Animate spinner when any PR has pending checks
  const hasPending = useMemo(
    () =>
      [...ciCache.values()].some((ci) =>
        ci.checks.some((c) => c.status !== 'completed')
      ),
    [ciCache]
  );

  useEffect(() => {
    if (!hasPending) return;
    const interval = setInterval(() => {
      setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 100);
    return () => clearInterval(interval);
  }, [hasPending]);

  const filteredPRs = useMemo(() => {
    const result = searchQuery
      ? prs.filter((pr) => {
          const q = searchQuery.toLowerCase();
          return (
            pr.title.toLowerCase().includes(q) ||
            pr.repoId.includes(q) ||
            pr.headRef.toLowerCase().includes(q)
          );
        })
      : [...prs];
    result.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    return result;
  }, [prs, searchQuery]);

  const repoMatchMap = useMemo(() => {
    const map = new Map<string, LocalRepo[]>();
    for (const pr of prs) {
      const matches = localRepos.filter(
        (r) =>
          r.repoId === pr.repoId ||
          (pr.forkRepoId != null && r.repoId === pr.forkRepoId)
      );
      map.set(`${pr.repoId}#${pr.number}`, matches);
    }
    return map;
  }, [prs, localRepos]);

  // 4 chrome rows (header, spacer, column headers, footer) + 2 padding rows
  const listHeight = Math.max(1, height - 6);

  const moveTo = useCallback(
    (newIndex: number) => {
      const clamped = Math.max(0, Math.min(newIndex, filteredPRs.length - 1));
      setSelectedIndex(clamped);
      setScrollOffset((prev) => {
        if (clamped < prev) return clamped;
        if (clamped >= prev + listHeight) return clamped - listHeight + 1;
        return prev;
      });
    },
    [filteredPRs.length, listHeight]
  );

  useKeyboard((key) => {
    if (searchMode) {
      if (key.name === 'escape') {
        setSearchMode(false);
        setSearchQuery('');
      } else if (key.name === 'return') {
        setSearchMode(false);
      } else if (key.name === 'backspace') {
        setSearchQuery((q) => q.slice(0, -1));
      } else if (key.raw && key.raw.length === 1 && key.raw >= ' ') {
        setSearchQuery((q) => q + key.raw);
        setSelectedIndex(0);
        setScrollOffset(0);
      }
      return;
    }

    switch (key.name) {
      case 'up':
      case 'k':
        moveTo(selectedIndex - 1);
        break;
      case 'down':
      case 'j':
        moveTo(selectedIndex + 1);
        break;
      case 'return': {
        const pr = filteredPRs[selectedIndex];
        if (pr) {
          const matches = repoMatchMap.get(`${pr.repoId}#${pr.number}`) ?? [];
          onSelect(pr, matches);
        }
        break;
      }
      case 'c': {
        const pr = filteredPRs[selectedIndex];
        if (pr) onFetchCI(pr);
        break;
      }
      case 'escape':
      case 'q':
        onExit();
        break;
      default:
        if (key.raw === '/') {
          setSearchMode(true);
        }
        break;
    }
  });

  // Column widths
  const updatedCol = 12;
  const ciCol = 12;
  const reviewCol = 15;
  const repoCol = Math.min(25, Math.floor(width * 0.2));
  const prCol = Math.max(
    20,
    width - repoCol - updatedCol - ciCol - reviewCol - 6
  );

  return (
    <box
      flexDirection="column"
      style={{ width: '100%', height: '100%', padding: 1 }}
    >
      {/* Header */}
      <box style={{ height: 1, width: '100%' }}>
        <text
          content={` git-switchboard pr  ${filteredPRs.length} open PRs${
            searchQuery ? ` | Search: ${searchQuery}` : ''
          }${searchMode ? ' | (type to search)' : ''}`}
          fg="#7aa2f7"
        />
      </box>

      <box style={{ height: 1 }} />

      {/* Column headers */}
      <box style={{ height: 1, width: '100%' }}>
        <text
          content={` ${'PR'.padEnd(prCol)}${'Repo'.padEnd(
            repoCol
          )}${'Updated'.padEnd(updatedCol)}${'CI'.padEnd(
            ciCol
          )}${'Review'.padEnd(reviewCol)}`}
          fg="#bb9af7"
        />
      </box>

      {/* PR list */}
      <box flexDirection="column" style={{ flexGrow: 1, width: '100%' }}>
        {filteredPRs
          .slice(scrollOffset, scrollOffset + listHeight)
          .map((pr, i) => {
            const actualIndex = scrollOffset + i;
            const isSelected = actualIndex === selectedIndex;
            const bg = isSelected ? '#292e42' : undefined;

            const prKey = `${pr.repoId}#${pr.number}`;
            const ci = ciCache.get(prKey);
            const ciStatus = ciSummary(ci, SPINNER_FRAMES[spinnerFrame]);
            const review = reviewCache.get(prKey);
            const rvw = reviewLabel(review?.status ?? 'needs-review');

            const prLabel = `#${pr.number} ${pr.title}`.slice(0, prCol - 1);
            const repoLabel = `${pr.repoOwner}/${pr.repoName}`.slice(
              0,
              repoCol - 1
            );

            return (
              <box
                key={`${pr.repoId}#${pr.number}`}
                style={{ height: 1, width: '100%', backgroundColor: bg }}
              >
                <text>
                  <span fg="#c0caf5"> {prLabel.padEnd(prCol)}</span>
                  <span fg="#a9b1d6">{repoLabel.padEnd(repoCol)}</span>
                  <span fg="#565f89">
                    {relativeTime(pr.updatedAt).padEnd(updatedCol)}
                  </span>
                  <span fg={ciStatus.fg}>
                    {ciStatus.text.slice(0, ciCol - 1).padEnd(ciCol)}
                  </span>
                  <span fg={rvw.fg}>
                    {rvw.text.slice(0, reviewCol - 1).padEnd(reviewCol)}
                  </span>
                </text>
              </box>
            );
          })}
      </box>

      {/* Footer */}
      <box style={{ height: 1, width: '100%' }}>
        {(() => {
          const keys = ` [${UP_ARROW}${DOWN_ARROW}] Navigate | [${RETURN_SYMBOL}] Select | [c] Fetch CI | [/] Search | [q]uit`;
          const rl = rateLimit.current
            ? `API: ${rateLimit.current.remaining}/${rateLimit.current.limit} `
            : '';
          const gap = Math.max(1, width - 2 - keys.length - rl.length);
          return (
            <text content={keys + ' '.repeat(gap) + rl} fg="#565f89" />
          );
        })()}
      </box>
    </box>
  );
}

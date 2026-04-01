import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useCallback, useMemo, useState } from 'react';
import type { LocalRepo } from './scanner.js';
import type { CIInfo, CIStatus, UserPullRequest } from './types.js';

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

function ciIcon(status: CIStatus): { char: string; fg: string } {
  switch (status) {
    case 'passing':
      return { char: '*', fg: '#9ece6a' };
    case 'failing':
      return { char: 'x', fg: '#f7768e' };
    case 'pending':
      return { char: '~', fg: '#e0af68' };
    case 'mixed':
      return { char: '!', fg: '#ff9e64' };
    default:
      return { char: '?', fg: '#565f89' };
  }
}

interface PrAppProps {
  prs: UserPullRequest[];
  localRepos: LocalRepo[];
  ciCache: Map<string, CIInfo>;
  onSelect: (pr: UserPullRequest, matches: LocalRepo[]) => void;
  onFetchCI: (pr: UserPullRequest) => void;
  onExit: () => void;
}

export function PrApp({
  prs,
  localRepos,
  ciCache,
  onSelect,
  onFetchCI,
  onExit,
}: PrAppProps) {
  const { width, height } = useTerminalDimensions();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState(false);

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
      const matches = localRepos.filter((r) => r.repoId === pr.repoId);
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
      case 'slash':
        setSearchMode(true);
        break;
      case 'escape':
      case 'q':
        onExit();
        break;
    }
  });

  // Column widths
  const localCol = 12;
  const statusCol = 8;
  const updatedCol = 12;
  const ciCol = 4;
  const prCol = Math.min(30, Math.floor(width * 0.25));
  const repoCol = Math.min(25, Math.floor(width * 0.2));
  const branchCol = Math.max(
    15,
    width - prCol - repoCol - statusCol - updatedCol - localCol - ciCol - 6
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
          )}${'Branch'.padEnd(branchCol)}${'Updated'.padEnd(
            updatedCol
          )}${'Status'.padEnd(statusCol)}${'CI'.padEnd(ciCol)}${'Local'.padEnd(
            localCol
          )}`}
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
            const matches = repoMatchMap.get(`${pr.repoId}#${pr.number}`) ?? [];
            const cleanMatch = matches.find((r) => r.isClean);

            const localStatus =
              matches.length === 0 ? '-' : cleanMatch ? '* clean' : 'x dirty';
            const localFg =
              matches.length === 0
                ? '#565f89'
                : cleanMatch
                ? '#9ece6a'
                : '#f7768e';

            const ciKey = `${pr.repoId}#${pr.number}`;
            const ci = ciCache.get(ciKey);
            const ciStatus = ciIcon(ci?.status ?? 'unknown');

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
                  <span fg="#ff9e64">
                    {pr.headRef.slice(0, branchCol - 1).padEnd(branchCol)}
                  </span>
                  <span fg="#565f89">
                    {relativeTime(pr.updatedAt).padEnd(updatedCol)}
                  </span>
                  <span fg={pr.draft ? '#e0af68' : '#9ece6a'}>
                    {(pr.draft ? 'Draft' : 'Open').padEnd(statusCol)}
                  </span>
                  <span fg={ciStatus.fg}>{ciStatus.char.padEnd(ciCol)}</span>
                  <span fg={localFg}>{localStatus.padEnd(localCol)}</span>
                </text>
              </box>
            );
          })}
      </box>

      {/* Footer */}
      <box style={{ height: 1, width: '100%' }}>
        <text
          content={
            ' [j/k] Navigate | [Enter] Select | [c] Fetch CI | [/] Search | [q]uit'
          }
          fg="#565f89"
        />
      </box>
    </box>
  );
}

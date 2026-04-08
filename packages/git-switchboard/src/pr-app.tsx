import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useKeybinds } from './use-keybinds.js';
import { muteColor } from './colors.js';
import { buildFooterRows, FooterRows } from './footer.js';
import { footerParts } from './view.js';
import type { ViewProps } from './view.js';
import { useNavigate } from './tui-router.js';
import type { PrScreen } from './store.js';
import { ScrollList, handleListKey } from './scroll-list.js';
import type { LocalRepo } from './scanner.js';
import type {
  CIInfo,
  MergeableStatus,
  PRRole,
  ReviewInfo,
  ReviewStatus,
  UserPullRequest,
} from './types.js';
import {
  CHECKMARK,
  CROSSMARK,
  ELLIPSIS,
  RETURN_SYMBOL,
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

function fit(str: string, width: number): string {
  if (width <= 0) return '';
  if (str.length <= width) return str.padEnd(width);
  if (width === 1) return ELLIPSIS;
  return str.slice(0, width - 1) + ELLIPSIS;
}

const SPINNER_FRAMES = ['|', '/', '-', '\\'];
const PREFETCH_BUFFER_ROWS = 5;

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

// ─── Sort system ─────────────────────────────────────────────

type SortField = 'updated' | 'review' | 'ci' | 'repo' | 'merge' | 'number';
type SortDir = 'asc' | 'desc';

interface SortLayer {
  field: SortField;
  dir: SortDir;
}

const SORT_FIELDS: { field: SortField; label: string; defaultDir: SortDir }[] = [
  { field: 'updated', label: 'Updated', defaultDir: 'desc' },
  { field: 'review', label: 'Review Status', defaultDir: 'asc' },
  { field: 'ci', label: 'CI Status', defaultDir: 'asc' },
  { field: 'repo', label: 'Repository', defaultDir: 'asc' },
  { field: 'merge', label: 'Merge Status', defaultDir: 'asc' },
  { field: 'number', label: 'PR Number', defaultDir: 'desc' },
];

const DEFAULT_SORT: SortLayer[] = [
  { field: 'review', dir: 'asc' },
  { field: 'updated', dir: 'desc' },
];

function ciSortOrder(status: string | undefined): number {
  switch (status) {
    case 'failing': return 0;
    case 'mixed': return 1;
    case 'pending': return 2;
    case 'passing': return 3;
    default: return 4;
  }
}

function mergeSortOrder(status: string | undefined): number {
  switch (status) {
    case 'CONFLICTING': return 0;
    case 'UNKNOWN': return 1;
    case 'MERGEABLE': return 2;
    default: return 3;
  }
}

function reviewSortOrder(status: ReviewStatus | undefined): number {
  if (status == null) return 6;
  switch (status) {
    case 'approved': return 0;
    case 'changes-requested': return 1;
    case 're-review-needed': return 2;
    case 'needs-review': return 3;
    case 'dismissed': return 4;
    case 'commented': return 5;
    default: return 6;
  }
}

function roleIndicator(role: PRRole): { text: string; fg: string } {
  switch (role) {
    case 'author':
      return { text: '✎', fg: '#7aa2f7' };
    case 'assigned':
      return { text: '→', fg: '#e0af68' };
    case 'both':
      return { text: '✎→', fg: '#bb9af7' };
  }
}

function mergeLabel(status: MergeableStatus | undefined, compact: boolean): { text: string; fg: string } {
  if (status === 'CONFLICTING') {
    return { text: compact ? CROSSMARK : `${CROSSMARK} Conflict`, fg: '#f7768e' };
  }
  return { text: '', fg: '#565f89' };
}

function reviewLabel(status: ReviewStatus | undefined, compact: boolean): { text: string; fg: string } {
  if (status == null) {
    return { text: ELLIPSIS, fg: '#565f89' };
  }
  if (compact) {
    switch (status) {
      case 'approved':
        return { text: CHECKMARK, fg: '#9ece6a' };
      case 'changes-requested':
        return { text: CROSSMARK, fg: '#f7768e' };
      case 're-review-needed':
        return { text: '~', fg: '#e0af68' };
      default:
        return { text: ELLIPSIS, fg: '#565f89' };
    }
  }
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

interface PrAppProps extends ViewProps {
  prs: UserPullRequest[];
  localRepos: LocalRepo[];
  ciCache: Map<string, CIInfo>;
  reviewCache: Map<string, ReviewInfo>;
  mergeableCache: Record<string, MergeableStatus>;
  linearCache: Map<string, import('./types.js').LinearIssue>;
  repoMode: string | null;
  refreshing: boolean;
  /** Fetch CI + review for a PR. Resolves when caches are updated. */
  onFetchCI: (pr: UserPullRequest) => Promise<void>;
  onPrefetchDetails: (prs: UserPullRequest[]) => void;
  onRetryChecks: (pr: UserPullRequest) => Promise<string>;
  onRefreshAll: (prs: UserPullRequest[]) => Promise<void>;
  onExit: () => void;
}

export function PrApp({
  prs,
  localRepos,
  ciCache,
  reviewCache,
  mergeableCache,
  linearCache,
  repoMode,
  refreshing,
  onFetchCI,
  onPrefetchDetails,
  onRetryChecks,
  onRefreshAll,
  onExit,
  keybinds,
}: PrAppProps) {
  const navigate = useNavigate<PrScreen>();
  useExitOnCtrlC();
  const { width, height } = useTerminalDimensions();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState(false);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [sortLayers, setSortLayers] = useState<SortLayer[]>(DEFAULT_SORT);
  const [sortModal, setSortModal] = useState<{ selectedIndex: number } | null>(null);
  const refreshSessionRef = useRef<{
    signature: string;
    refreshedKeys: Set<string>;
  } | null>(null);
  const queuedRefreshCountRef = useRef(0);
  // Bump to force re-render after CI fetch (caches are mutated externally)
  const [, forceRender] = useState(0);

  // Animate spinner when any PR has pending checks or a refresh is in flight
  const hasPending = useMemo(
    () =>
      [...ciCache.values()].some((ci) =>
        ci.checks.some((c) => c.status !== 'completed')
      ),
    [ciCache]
  );
  const animateSpinner = hasPending || refreshing;

  useEffect(() => {
    if (!animateSpinner) return;
    const interval = setInterval(() => {
      setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 100);
    return () => clearInterval(interval);
  }, [animateSpinner]);

  const filteredPRs = useMemo(() => {
    const result = searchQuery
      ? prs.filter((pr) => {
          const q = searchQuery.toLowerCase();
          const linearIssue = linearCache.get(`${pr.repoId}#${pr.number}`);
          return (
            pr.title.toLowerCase().includes(q) ||
            pr.repoId.includes(q) ||
            pr.headRef.toLowerCase().includes(q) ||
            pr.author.toLowerCase().includes(q) ||
            (linearIssue?.identifier.toLowerCase().includes(q) ?? false)
          );
        })
      : [...prs];
    result.sort((a, b) => {
      for (const layer of sortLayers) {
        const dir = layer.dir === 'asc' ? 1 : -1;
        let cmp = 0;
        const aKey = `${a.repoId}#${a.number}`;
        const bKey = `${b.repoId}#${b.number}`;
        switch (layer.field) {
          case 'updated':
            cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
            break;
          case 'review':
            cmp = reviewSortOrder(reviewCache.get(aKey)?.status)
              - reviewSortOrder(reviewCache.get(bKey)?.status);
            break;
          case 'ci':
            cmp = ciSortOrder(ciCache.get(aKey)?.status)
              - ciSortOrder(ciCache.get(bKey)?.status);
            break;
          case 'repo':
            cmp = a.repoId.localeCompare(b.repoId);
            break;
          case 'merge':
            cmp = mergeSortOrder(mergeableCache[aKey])
              - mergeSortOrder(mergeableCache[bKey]);
            break;
          case 'number':
            cmp = a.number - b.number;
            break;
        }
        if (cmp !== 0) return cmp * dir;
      }
      return 0;
    });
    return result;
  }, [prs, searchQuery, reviewCache, ciCache, mergeableCache, linearCache, sortLayers]);

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

  const hasLinear = useMemo(
    () => filteredPRs.some((pr) => linearCache.has(`${pr.repoId}#${pr.number}`)),
    [filteredPRs, linearCache]
  );

  const hasFailedChecks = useMemo(() => {
    const selectedPR = filteredPRs[selectedIndex];
    const selectedKey = selectedPR ? `${selectedPR.repoId}#${selectedPR.number}` : '';
    const selectedCI = selectedKey ? ciCache.get(selectedKey) : undefined;
    return selectedCI?.checks.some((c) => c.status === 'completed' && c.conclusion === 'failure') ?? false;
  }, [filteredPRs, selectedIndex, ciCache]);

  const footerRows = useMemo(() => {
    const parts = footerParts(keybinds, { retryChecks: hasFailedChecks });
    return buildFooterRows(parts, width);
  }, [hasFailedChecks, width, keybinds]);

  // 4 chrome rows (header, spacer, column headers, footer) + 2 padding rows
  const footerHeight = statusText ? 1 : footerRows.length;
  const listHeight = Math.max(1, height - 5 - footerHeight);
  const visiblePRs = useMemo(
    () => filteredPRs.slice(scrollOffset, scrollOffset + listHeight),
    [filteredPRs, scrollOffset, listHeight]
  );
  const prefetchedPRs = useMemo(() => {
    const start = Math.max(0, scrollOffset - PREFETCH_BUFFER_ROWS);
    const end = Math.min(
      filteredPRs.length,
      scrollOffset + listHeight + PREFETCH_BUFFER_ROWS
    );
    return filteredPRs.slice(start, end);
  }, [filteredPRs, scrollOffset, listHeight]);
  const refreshSessionSignature = useMemo(
    () =>
      `${filteredPRs
        .map((pr) => `${pr.repoId}#${pr.number}`)
        .sort()
        .join('|')}::${scrollOffset}::${listHeight}`,
    [filteredPRs, scrollOffset, listHeight]
  );

  useEffect(() => {
    if (prefetchedPRs.length === 0) return;
    onPrefetchDetails(prefetchedPRs);
  }, [prefetchedPRs, onPrefetchDetails, selectedIndex]);

  const refreshCurrentChunk = useCallback(() => {
    if (filteredPRs.length === 0) return;

    const chunkSize = Math.min(listHeight, filteredPRs.length);
    const orderedPRs = [
      ...filteredPRs.slice(scrollOffset),
      ...filteredPRs.slice(0, scrollOffset),
    ];

    if (
      refreshSessionRef.current == null ||
      refreshSessionRef.current.signature !== refreshSessionSignature
    ) {
      refreshSessionRef.current = {
        signature: refreshSessionSignature,
        refreshedKeys: new Set(),
      };
    }

    const session = refreshSessionRef.current;
    let chunk = orderedPRs
      .filter((pr) => !session.refreshedKeys.has(`${pr.repoId}#${pr.number}`))
      .slice(0, chunkSize);

    if (chunk.length === 0) {
      session.refreshedKeys.clear();
      chunk = orderedPRs.slice(0, chunkSize);
    }

    for (const pr of chunk) {
      session.refreshedKeys.add(`${pr.repoId}#${pr.number}`);
    }

    void onRefreshAll(chunk);
  }, [
    filteredPRs,
    listHeight,
    onRefreshAll,
    refreshSessionSignature,
    scrollOffset,
  ]);

  useEffect(() => {
    if (refreshing || queuedRefreshCountRef.current === 0) return;
    queuedRefreshCountRef.current -= 1;
    refreshCurrentChunk();
  }, [refreshCurrentChunk, refreshing]);

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

  const toggleSortField = useCallback((field: SortField) => {
    setSortLayers((prev) => {
      const existing = prev.findIndex((l) => l.field === field);
      const defaults = SORT_FIELDS.find((f) => f.field === field)!;
      if (existing === -1) {
        // Add with default direction
        return [...prev, { field, dir: defaults.defaultDir }];
      }
      const current = prev[existing];
      if (current.dir === defaults.defaultDir) {
        // Flip direction
        return prev.map((l, i) =>
          i === existing ? { ...l, dir: current.dir === 'asc' ? 'desc' : 'asc' } : l
        );
      }
      // Remove (was already flipped, so toggle off)
      return prev.filter((_, i) => i !== existing);
    });
  }, []);

  useKeybinds(keybinds, {
    navigate: (key) => {
      if (key.name === 'up' || key.name === 'k') moveTo(selectedIndex - 1);
      else moveTo(selectedIndex + 1);
    },
    select: () => {
      if (searchMode || sortModal) return;
      const pr = filteredPRs[selectedIndex];
      if (pr) {
        const matches = repoMatchMap.get(`${pr.repoId}#${pr.number}`) ?? [];
        navigate({ type: 'pr-detail', pr, matches });
      }
    },
    fetchCI: () => {
      const pr = filteredPRs[selectedIndex];
      if (pr) { onFetchCI(pr).then(() => forceRender((n) => n + 1)); }
    },
    retryChecks: () => {
      const pr = filteredPRs[selectedIndex];
      if (pr) {
        onRetryChecks(pr).then((msg) => {
          setStatusText(msg);
          setTimeout(() => setStatusText(''), 4000);
        });
      }
    },
    refreshAll: () => {
      if (refreshing) { queuedRefreshCountRef.current += 1; }
      else { refreshCurrentChunk(); }
    },
    sort: () => setSortModal({ selectedIndex: 0 }),
    search: () => setSearchMode(true),
    quit: () => onExit(),
  }, { show: { retryChecks: hasFailedChecks } });

  // Fires first (LIFO) — handles sort modal, search text input, and page/home/end navigation.
  useKeyboard((key) => {
    if (sortModal) {
      switch (key.name) {
        case 'up':
        case 'k':
          setSortModal((m) => m ? { selectedIndex: Math.max(0, m.selectedIndex - 1) } : m);
          break;
        case 'down':
        case 'j':
          setSortModal((m) =>
            m ? { selectedIndex: Math.min(SORT_FIELDS.length - 1, m.selectedIndex + 1) } : m
          );
          break;
        case 'return': {
          const field = SORT_FIELDS[sortModal.selectedIndex];
          if (field) toggleSortField(field.field);
          break;
        }
        case 'escape':
        case 'q':
        case 's':
          setSortModal(null);
          break;
      }
      return true;
    }

    if (searchMode) {
      const shouldCommit =
        key.name === 'return' || key.name === 'tab' ||
        key.name === 'up' || key.name === 'down' || key.raw === '\t';
      if (key.name === 'escape') {
        setSearchMode(false);
        setSearchQuery('');
      } else if (shouldCommit) {
        setSearchMode(false);
      } else if (key.name === 'backspace') {
        setSearchQuery((q) => q.slice(0, -1));
      } else if (key.raw && key.raw.length >= 1 && key.raw >= ' ') {
        setSearchQuery((q) => q + key.raw);
        setSelectedIndex(0);
        setScrollOffset(0);
      }
      return true;
    }

    if (handleListKey(key.name, selectedIndex, filteredPRs.length, listHeight, moveTo)) return true;
  });

  // Determine which repo names are ambiguous (same name under different orgs)
  const ambiguousRepoNames = useMemo(() => {
    const nameToOwners = new Map<string, Set<string>>();
    for (const pr of prs) {
      const owners = nameToOwners.get(pr.repoName) ?? new Set();
      owners.add(pr.repoOwner);
      nameToOwners.set(pr.repoName, owners);
    }
    const ambiguous = new Set<string>();
    for (const [name, owners] of nameToOwners) {
      if (owners.size > 1) ambiguous.add(name);
    }
    return ambiguous;
  }, [prs]);
  const hasAnyAmbiguous = ambiguousRepoNames.size > 0;

  // Responsive column widths — collapse gracefully at narrow viewports
  const compact = width < 120;
  const veryCompact = width < 90;
  const authorCol = repoMode ? Math.min(20, Math.floor(width * 0.15)) : 0;
  const roleCol = repoMode ? 0 : 4;
  const repoCol = repoMode ? 0 : Math.min(hasAnyAmbiguous ? 25 : 18, Math.floor(width * 0.2));
  const updatedCol = veryCompact ? 8 : 12;
  const ciCol = veryCompact ? 8 : 12;
  const mergeCol = compact ? 3 : 11;
  const reviewCol = compact ? 3 : 15;
  const linearCol = hasLinear ? (compact ? 10 : 12) : 0;
  const prCol = Math.max(
    20,
    width - authorCol - roleCol - repoCol - updatedCol - ciCol - mergeCol - reviewCol - linearCol - 6
  );

  const sortHeader = (label: string, field: SortField, colWidth: number): string => {
    const layerIdx = sortLayers.findIndex((l) => l.field === field);
    if (layerIdx === -1) return label.padEnd(colWidth);
    const arrow = sortLayers[layerIdx].dir === 'asc' ? '↑' : '↓';
    return `${label}${arrow}`.padEnd(colWidth);
  };
  const tableFocused = !searchMode && !sortModal;
  const headerText = ` git-switchboard pr${repoMode ? ` ${repoMode}` : ''}  ${
    searchQuery ? `${filteredPRs.length}/${prs.length}` : String(filteredPRs.length)
  } open PRs${searchQuery ? ` | Search: ${searchQuery}` : ''}${
    searchMode ? ` | (type to search, [${RETURN_SYMBOL}] confirm)` : ''
  }`;
  const headerWidth = Math.max(1, width - 4);
  const headerContent = refreshing
    ? `${fit(headerText, Math.max(1, headerWidth - 2))} ${SPINNER_FRAMES[spinnerFrame]}`
    : fit(headerText, headerWidth);

  return (
    <box
      flexDirection="column"
      style={{ width: '100%', height: '100%', padding: 1 }}
    >
      {/* Header */}
      <box style={{ height: 1, width: '100%' }}>
        <text content={headerContent} fg="#7aa2f7" />
      </box>

      <box style={{ height: 1 }} />

      {/* Column headers */}
      <box style={{ height: 1, width: '100%' }}>
        <text
          content={` ${repoMode ? 'Author'.padEnd(authorCol) : ''.padEnd(roleCol)}${sortHeader('PR', 'number', prCol)}${repoMode ? '' : sortHeader('Repo', 'repo', repoCol)}${sortHeader(veryCompact ? 'Upd' : 'Updated', 'updated', updatedCol)}${sortHeader('CI', 'ci', ciCol)}${sortHeader(compact ? '' : '', 'merge', mergeCol)}${hasLinear ? (compact ? 'Lin' : 'Linear').padEnd(linearCol) : ''}${sortHeader(compact ? 'Rv' : 'Review', 'review', reviewCol)}`}
          fg={tableFocused ? '#bb9af7' : muteColor('#bb9af7')}
        />
      </box>

      {/* PR list + scrollbar */}
      <ScrollList
        totalItems={filteredPRs.length}
        selectedIndex={selectedIndex}
        scrollOffset={scrollOffset}
        listHeight={listHeight}
        onMove={moveTo}
      >
        {visiblePRs.map((pr, i) => {
            const actualIndex = scrollOffset + i;
            const isSelected = actualIndex === selectedIndex;
            const bg = isSelected
              ? tableFocused
                ? '#292e42'
                : muteColor('#292e42', 0.35)
              : undefined;

            const prKey = `${pr.repoId}#${pr.number}`;
            const ci = ciCache.get(prKey);
            const ciStatus = ciSummary(ci, SPINNER_FRAMES[spinnerFrame]);
            const review = reviewCache.get(prKey);
            const linearIssue = linearCache.get(prKey);
            const linearText = linearIssue ? linearIssue.identifier : (hasLinear ? '-' : '');
            const rvw = reviewLabel(review?.status, compact);
            const merge = mergeLabel(mergeableCache[prKey], compact);
            const roleIcon = roleIndicator(pr.role);
            const authorColor = tableFocused ? '#bb9af7' : muteColor('#bb9af7');
            const roleColor = tableFocused ? roleIcon.fg : muteColor(roleIcon.fg);
            const titleColor = tableFocused ? '#c0caf5' : muteColor('#c0caf5');
            const repoColor = tableFocused ? '#a9b1d6' : muteColor('#a9b1d6');
            const updatedColor = tableFocused
              ? '#565f89'
              : muteColor('#565f89', 0.3);
            const ciColor = tableFocused ? ciStatus.fg : muteColor(ciStatus.fg);
            const mergeColor = tableFocused ? merge.fg : muteColor(merge.fg);
            const reviewColor = tableFocused ? rvw.fg : muteColor(rvw.fg);

            const prLabel = `#${pr.number} ${pr.title}`.slice(0, prCol - 1);
            const repoLabel = (ambiguousRepoNames.has(pr.repoName) ? `${pr.repoOwner}/${pr.repoName}` : pr.repoName).slice(
              0,
              repoCol - 1
            );

            return (
              <box
                key={`${pr.repoId}#${pr.number}`}
                style={{ height: 1, width: '100%', backgroundColor: bg }}
                onMouseDown={() => {
                  if (actualIndex === selectedIndex) {
                    // Double-click effect: second click on same row opens it
                    const matches = repoMatchMap.get(`${pr.repoId}#${pr.number}`) ?? [];
                    navigate({ type: 'pr-detail', pr, matches });
                  } else {
                    moveTo(actualIndex);
                  }
                }}
              >
                <text>
                  {repoMode ? (
                    <span fg={authorColor}> {pr.author.slice(0, authorCol - 2).padEnd(authorCol)}</span>
                  ) : (
                    <span fg={roleColor}> {roleIcon.text.padEnd(roleCol)}</span>
                  )}
                  <span fg={titleColor}>{prLabel.padEnd(prCol)}</span>
                  {!repoMode && <span fg={repoColor}>{repoLabel.padEnd(repoCol)}</span>}
                  <span fg={updatedColor}>
                    {relativeTime(pr.updatedAt).padEnd(updatedCol)}
                  </span>
                  <span fg={ciColor}>
                    {ciStatus.text.slice(0, ciCol - 1).padEnd(ciCol)}
                  </span>
                  <span fg={mergeColor}>
                    {merge.text.slice(0, mergeCol - 1).padEnd(mergeCol)}
                  </span>
                  {hasLinear && (
                    <span fg={tableFocused ? '#bb9af7' : muteColor('#bb9af7')}>
                      {linearText.slice(0, linearCol - 1).padEnd(linearCol)}
                    </span>
                  )}
                  <span fg={reviewColor}>
                    {rvw.text.slice(0, reviewCol - 1).padEnd(reviewCol)}
                  </span>
                </text>
              </box>
            );
          })}
      </ScrollList>

      {/* Footer — shows status text when active, keybindings otherwise */}
      {statusText ? (
        <box style={{ height: 1, width: '100%' }}>
          <text
            content={` ${statusText}`}
            fg={
              tableFocused
                ? /^(Failed|No |Cannot )/i.test(statusText)
                  ? '#f7768e'
                  : '#9ece6a'
                : muteColor(
                    /^(Failed|No |Cannot )/i.test(statusText)
                      ? '#f7768e'
                      : '#9ece6a'
                  )
            }
          />
        </box>
      ) : (
        <FooterRows
          rows={footerRows}
          fg={tableFocused ? '#565f89' : muteColor('#565f89', 0.3)}
        />
      )}

      {/* Sort modal */}
      {sortModal && (
        <box
          style={{
            position: 'absolute',
            top: Math.floor(height / 2) - Math.floor((SORT_FIELDS.length + 4) / 2),
            left: Math.floor(width / 2) - 20,
            width: 40,
            height: SORT_FIELDS.length + 4,
          }}
        >
          <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text content=" Sort Order" fg="#7aa2f7" />
            </box>
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text content={`${'─'.repeat(40)}`} fg="#292e42" />
            </box>
            {SORT_FIELDS.map((sf, i) => {
              const isActive = i === sortModal.selectedIndex;
              const layerIdx = sortLayers.findIndex((l) => l.field === sf.field);
              const layer = layerIdx !== -1 ? sortLayers[layerIdx] : null;
              const indicator = layer
                ? `${layerIdx + 1}${layer.dir === 'asc' ? '↑' : '↓'}`
                : '  ';
              return (
                <box
                  key={sf.field}
                  style={{
                    height: 1,
                    width: '100%',
                    backgroundColor: isActive ? '#292e42' : '#1a1b26',
                  }}
                  onMouseDown={() => {
                    if (isActive) {
                      toggleSortField(sf.field);
                    } else {
                      setSortModal({ selectedIndex: i });
                    }
                  }}
                >
                  <text
                    content={` ${indicator} ${isActive ? '>' : ' '} ${sf.label}`}
                    fg={layer ? (isActive ? '#c0caf5' : '#7aa2f7') : (isActive ? '#a9b1d6' : '#565f89')}
                  />
                </box>
              );
            })}
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text content=" Enter toggle | Esc close" fg="#565f89" />
            </box>
          </box>
        </box>
      )}
    </box>
  );
}

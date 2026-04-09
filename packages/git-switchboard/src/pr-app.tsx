import { useTerminalDimensions } from '@opentui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusedKeyboard, useFocusOwner } from './focus-stack.js';
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
  ColumnConfig,
  FilterFieldDef,
  FilterFieldId,
  FilterPreset,
  FilterState,
  MergeableStatus,
  PRRole,
  ReviewStatus,
  StringFilter,
  StringMatchMode,
  SortDir,
  SortField,
  SortLayer,
  UserPullRequest,
} from './types.js';
import { cycleVisibility, EMPTY_FILTERS, FILTER_FIELD_DEFS } from './types.js';
import type { DataLayer, PR } from './data/index.js';
import type { PrColumnId } from './pr-columns.js';
import { PR_COLUMN_DEFS, PR_VIEW_NAME } from './pr-columns.js';
import { writeColumnConfig, readFilterPresets, writeFilterPresets } from './config.js';
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
  spinnerChar: string,
  loading?: boolean,
): { text: string; fg: string } {
  if (loading && (!ci || ci.checks.length === 0)) return { text: spinnerChar, fg: '#e0af68' };
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

const SORT_FIELDS: { field: SortField; label: string; defaultDir: SortDir }[] = [
  { field: 'updated', label: 'Updated', defaultDir: 'desc' },
  { field: 'review', label: 'Review Status', defaultDir: 'asc' },
  { field: 'ci', label: 'CI Status', defaultDir: 'asc' },
  { field: 'repo', label: 'Repository', defaultDir: 'asc' },
  { field: 'merge', label: 'Merge Status', defaultDir: 'asc' },
  { field: 'number', label: 'PR Number', defaultDir: 'desc' },
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

// ─── Column header labels and sort field mapping ────────────────────────────

const SORTABLE_COLUMNS: Partial<Record<PrColumnId, SortField>> = {
  number: 'number',
  repo: 'repo',
  updated: 'updated',
  ci: 'ci',
  merge: 'merge',
  review: 'review',
};

const COLUMN_HEADERS: Record<PrColumnId, (compact: boolean, veryCompact: boolean) => string> = {
  role: () => '',
  author: () => 'Author',
  number: () => '#',
  title: () => 'PR',
  repo: () => 'Repo',
  updated: (_c, vc) => vc ? 'Upd' : 'Updated',
  ci: () => 'CI',
  merge: () => '',
  linear: (c) => c ? 'Lin' : 'Linear',
  review: (c) => c ? 'Rv' : 'Review',
};

// ─── Filter helpers ─────────────────────────────────────────────────────────

function matchesStringFilter(value: string, filter: StringFilter): boolean {
  if (filter.mode === 'exact') return value.toLowerCase() === filter.value.toLowerCase();
  return value.toLowerCase().includes(filter.value.toLowerCase());
}

function applyFilters(pr: PR, filters: FilterState, dataLayer: DataLayer): boolean {
  if (filters.org && !matchesStringFilter(pr.repoOwner, filters.org)) return false;
  if (filters.repo && !matchesStringFilter(pr.repoId, filters.repo)) return false;
  if (filters.author && !matchesStringFilter(pr.author, filters.author)) return false;
  if (filters.linear) {
    const linearIssues = dataLayer.query.linearIssuesForPr(`${pr.repoId}#${pr.number}`);
    const linearIssue = linearIssues[0];
    if (!linearIssue || !matchesStringFilter(linearIssue.identifier, filters.linear)) return false;
  }
  if (filters.role && filters.role.length > 0 && !filters.role.includes(pr.role)) return false;
  if (filters.review && filters.review.length > 0) {
    if (!pr.review?.status || !filters.review.includes(pr.review.status)) return false;
  }
  if (filters.ci && filters.ci.length > 0) {
    if (!pr.ci?.status || !filters.ci.includes(pr.ci.status)) return false;
  }
  if (filters.merge && filters.merge.length > 0) {
    if (!pr.mergeable || !filters.merge.includes(pr.mergeable)) return false;
  }
  return true;
}

// ─── Multiselect option definitions ─────────────────────────────────────────

const MULTISELECT_OPTIONS: Record<string, { value: string; label: string }[]> = {
  role: [
    { value: 'author', label: 'Author' },
    { value: 'assigned', label: 'Assigned' },
    { value: 'both', label: 'Both' },
  ],
  review: [
    { value: 'approved', label: 'Approved' },
    { value: 'changes-requested', label: 'Changes Requested' },
    { value: 're-review-needed', label: 'Re-review Needed' },
    { value: 'needs-review', label: 'Needs Review' },
    { value: 'commented', label: 'Commented' },
    { value: 'dismissed', label: 'Dismissed' },
  ],
  ci: [
    { value: 'passing', label: 'Passing' },
    { value: 'failing', label: 'Failing' },
    { value: 'pending', label: 'Pending' },
    { value: 'mixed', label: 'Mixed' },
    { value: 'unknown', label: 'Unknown' },
  ],
  merge: [
    { value: 'MERGEABLE', label: 'Mergeable' },
    { value: 'CONFLICTING', label: 'Conflicting' },
    { value: 'UNKNOWN', label: 'Unknown' },
  ],
};

// ─── Filter modal menu item type ────────────────────────────────────────────

type FilterMenuItem =
  | { type: 'preset'; index: number; preset: FilterPreset }
  | { type: 'field'; def: FilterFieldDef }
  | { type: 'clear' }
  | { type: 'save' };

interface PrAppProps extends ViewProps {
  prs: PR[];
  localRepos: LocalRepo[];
  dataLayer: DataLayer;
  repoMode: string | null;
  refreshing: boolean;
  /** Persistent filter state from the store */
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  sortLayers: SortLayer[];
  setSortLayers: (layers: SortLayer[] | ((prev: SortLayer[]) => SortLayer[])) => void;
  columns: ColumnConfig[];
  setColumns: (columns: ColumnConfig[] | ((prev: ColumnConfig[]) => ColumnConfig[])) => void;
  filters: FilterState;
  setFilters: (filters: FilterState | ((prev: FilterState) => FilterState)) => void;
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
  scrollOffset: number;
  setScrollOffset: (offset: number) => void;
  /** Fetch CI + review for a PR. Resolves when caches are updated. */
  onFetchCI: (pr: UserPullRequest) => void;
  onPrefetchDetails: (prs: UserPullRequest[]) => void;
  onRetryChecks: (pr: UserPullRequest) => Promise<string>;
  onRefreshAll: (visiblePRs: UserPullRequest[]) => void;
  onExit: () => void;
  storeStatusText?: string;
}

export function PrApp({
  prs,
  localRepos,
  dataLayer,
  repoMode,
  refreshing,
  searchQuery,
  setSearchQuery,
  sortLayers,
  setSortLayers,
  columns,
  setColumns,
  filters,
  setFilters,
  selectedIndex,
  setSelectedIndex,
  scrollOffset,
  setScrollOffset,
  onFetchCI,
  onPrefetchDetails,
  onRetryChecks,
  onRefreshAll,
  onExit,
  storeStatusText,
  keybinds,
}: PrAppProps) {
  const navigate = useNavigate<PrScreen>();
  useExitOnCtrlC();
  const { width, height } = useTerminalDimensions();
  const [searchMode, setSearchMode] = useState(false);
  const [sortModal, setSortModal] = useState<{ selectedIndex: number } | null>(null);
  const [columnModal, setColumnModal] = useState<{
    selectedIndex: number;
    reordering: boolean;
  } | null>(null);
  const [filterModal, setFilterModal] = useState<{
    level: 'fields';
    selectedIndex: number;
  } | {
    level: 'string-picker';
    fieldId: FilterFieldId;
    inputValue: string;
    mode: StringMatchMode;
    selectedIndex: number;
  } | {
    level: 'multiselect-picker';
    fieldId: FilterFieldId;
    selected: string[];
    selectedIndex: number;
  } | {
    level: 'save-preset';
    inputValue: string;
  } | null>(null);
  const [filterPresets, setFilterPresets] = useState<FilterPreset[]>([]);

  useFocusOwner('pr-search', searchMode);
  useFocusOwner('sort-modal', !!sortModal);
  useFocusOwner('column-modal', !!columnModal);
  useFocusOwner('filter-modal', !!filterModal);

  // Load presets on mount
  useEffect(() => {
    void readFilterPresets(PR_VIEW_NAME).then(setFilterPresets);
  }, []);

  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [localStatusText, setLocalStatusText] = useState('');
  // Local status (from retry/copy actions) takes priority over store status (from error events)
  const statusText = localStatusText || storeStatusText || '';
  const refreshSessionRef = useRef<{
    signature: string;
    refreshedKeys: Set<string>;
  } | null>(null);
  const queuedRefreshCountRef = useRef(0);
  // Bump to force re-render after CI fetch (caches are mutated externally)


  // Animate spinner when any PR has pending checks or a refresh is in flight
  const hasPending = useMemo(
    () =>
      prs.some((pr) =>
        pr.ci?.checks.some((c) => c.status !== 'completed') ?? false
      ),
    [prs]
  );
  const hasLoadingEntities = dataLayer.loading.loadingPrKeys().size > 0 || dataLayer.loading.loadingLinearKeys().size > 0;
  const animateSpinner = hasPending || refreshing || hasLoadingEntities;

  useEffect(() => {
    if (!animateSpinner) return;
    const interval = setInterval(() => {
      setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 100);
    return () => clearInterval(interval);
  }, [animateSpinner]);

  const filteredPRs = useMemo(() => {
    // Apply structured filters first
    let result = prs.filter((pr) => applyFilters(pr, filters, dataLayer));

    // Then apply freetext search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((pr) => {
        const linearIssues = dataLayer.query.linearIssuesForPr(`${pr.repoId}#${pr.number}`);
        const linearIssue = linearIssues[0];
        return (
          pr.title.toLowerCase().includes(q) ||
          pr.repoId.includes(q) ||
          pr.headRef.toLowerCase().includes(q) ||
          pr.author.toLowerCase().includes(q) ||
          (linearIssue?.identifier.toLowerCase().includes(q) ?? false)
        );
      });
    }

    result.sort((a, b) => {
      for (const layer of sortLayers) {
        const dir = layer.dir === 'asc' ? 1 : -1;
        let cmp = 0;
        switch (layer.field) {
          case 'updated':
            cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
            break;
          case 'review':
            cmp = reviewSortOrder(a.review?.status)
              - reviewSortOrder(b.review?.status);
            break;
          case 'ci':
            cmp = ciSortOrder(a.ci?.status)
              - ciSortOrder(b.ci?.status);
            break;
          case 'repo':
            cmp = a.repoId.localeCompare(b.repoId);
            break;
          case 'merge':
            cmp = mergeSortOrder(a.mergeable)
              - mergeSortOrder(b.mergeable);
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
  }, [prs, searchQuery, filters, dataLayer, sortLayers]);

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
    () => filteredPRs.some((pr) => dataLayer.query.linearIssuesForPr(`${pr.repoId}#${pr.number}`).length > 0),
    [filteredPRs, dataLayer]
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.org) count++;
    if (filters.repo) count++;
    if (filters.author) count++;
    if (filters.linear) count++;
    if (filters.role && filters.role.length > 0) count++;
    if (filters.review && filters.review.length > 0) count++;
    if (filters.ci && filters.ci.length > 0) count++;
    if (filters.merge && filters.merge.length > 0) count++;
    return count;
  }, [filters]);

  const stringFieldValues = useMemo(() => {
    const orgs = [...new Set(prs.map((pr) => pr.repoOwner))].sort();
    const repos = [...new Set(prs.map((pr) => pr.repoId))].sort();
    const authors = [...new Set(prs.map((pr) => pr.author))].sort();
    const linearIds: string[] = [];
    for (const pr of prs) {
      const issues = dataLayer.query.linearIssuesForPr(`${pr.repoId}#${pr.number}`);
      for (const issue of issues) {
        if (!linearIds.includes(issue.identifier)) linearIds.push(issue.identifier);
      }
    }
    return { org: orgs, repo: repos, author: authors, linear: linearIds.sort() };
  }, [prs, dataLayer]);

  const filterFieldItems = useMemo((): FilterMenuItem[] => {
    const items: FilterMenuItem[] = [];
    for (let i = 0; i < filterPresets.length; i++) {
      items.push({ type: 'preset', index: i, preset: filterPresets[i] });
    }
    for (const def of FILTER_FIELD_DEFS) {
      items.push({ type: 'field', def });
    }
    if (activeFilterCount > 0) {
      items.push({ type: 'clear' });
      items.push({ type: 'save' });
    }
    return items;
  }, [filterPresets, activeFilterCount]);

  const hasFailedChecks = useMemo(() => {
    const selectedPR = filteredPRs[selectedIndex];
    return selectedPR?.ci?.checks.some((c) => c.status === 'completed' && c.conclusion === 'failure') ?? false;
  }, [filteredPRs, selectedIndex]);

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

  const prefetchedKeysRef = useRef(new Set<string>());
  useEffect(() => {
    if (prefetchedPRs.length === 0) return;
    const newPRs = prefetchedPRs.filter((pr) => {
      const key = `${pr.repoId}#${pr.number}`;
      return !prefetchedKeysRef.current.has(key);
    });
    if (newPRs.length === 0) return;
    for (const pr of newPRs) {
      prefetchedKeysRef.current.add(`${pr.repoId}#${pr.number}`);
    }
    onPrefetchDetails(newPRs);
  }, [prefetchedPRs, onPrefetchDetails]);

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

    onRefreshAll(chunk);
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
      if (clamped < scrollOffset) setScrollOffset(clamped);
      else if (clamped >= scrollOffset + listHeight) setScrollOffset(clamped - listHeight + 1);
    },
    [filteredPRs.length, listHeight, scrollOffset, setSelectedIndex, setScrollOffset]
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
      const pr = filteredPRs[selectedIndex];
      if (pr) {
        const matches = repoMatchMap.get(`${pr.repoId}#${pr.number}`) ?? [];
        navigate({ type: 'pr-detail', pr, matches });
      }
    },
    fetchCI: () => {
      const pr = filteredPRs[selectedIndex];
      if (pr) { onFetchCI(pr); }
    },
    retryChecks: () => {
      const pr = filteredPRs[selectedIndex];
      if (pr) {
        onRetryChecks(pr).then((msg) => {
          setLocalStatusText(msg);
          setTimeout(() => setLocalStatusText(''), 4000);
        });
      }
    },
    refreshAll: () => {
      if (refreshing) { queuedRefreshCountRef.current += 1; }
      else { refreshCurrentChunk(); }
    },
    sort: () => setSortModal({ selectedIndex: 0 }),
    columns: () => setColumnModal({ selectedIndex: 0, reordering: false }),
    filter: () => setFilterModal({ level: 'fields', selectedIndex: 0 }),
    search: () => setSearchMode(true),
    debug: () => navigate({ type: 'debug' }),
    quit: () => onExit(),
  }, { show: { retryChecks: hasFailedChecks } });

  // Sort modal navigation — only fires when sort-modal focus is active.
  useFocusedKeyboard((key) => {
    key.stopPropagation();
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
        const field = sortModal ? SORT_FIELDS[sortModal.selectedIndex] : undefined;
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
  }, { focusId: 'sort-modal' });

  // Column modal navigation — only fires when column-modal focus is active.
  const closeColumnModal = useCallback(() => {
    setColumnModal(null);
    // Persist to config file on close
    void writeColumnConfig(PR_VIEW_NAME, columns);
  }, [columns]);

  useFocusedKeyboard((key) => {
    key.stopPropagation();
    if (!columnModal) return true;
    const { selectedIndex: si, reordering } = columnModal;

    if (reordering) {
      // Reorder mode: j/k moves the grabbed row
      switch (key.name) {
        case 'up':
        case 'k':
          if (si > 0) {
            setColumns((prev) => {
              const next = [...prev];
              [next[si - 1], next[si]] = [next[si], next[si - 1]];
              return next;
            });
            setColumnModal({ selectedIndex: si - 1, reordering: true });
          }
          break;
        case 'down':
        case 'j':
          if (si < columns.length - 1) {
            setColumns((prev) => {
              const next = [...prev];
              [next[si], next[si + 1]] = [next[si + 1], next[si]];
              return next;
            });
            setColumnModal({ selectedIndex: si + 1, reordering: true });
          }
          break;
        case 'return':
        case 'escape':
          setColumnModal({ selectedIndex: si, reordering: false });
          break;
      }
    } else {
      // Navigate mode
      switch (key.name) {
        case 'up':
        case 'k':
          setColumnModal({ selectedIndex: Math.max(0, si - 1), reordering: false });
          break;
        case 'down':
        case 'j':
          setColumnModal({ selectedIndex: Math.min(columns.length - 1, si + 1), reordering: false });
          break;
        case 'return': {
          // Toggle visibility
          const col = columns[si];
          const def = PR_COLUMN_DEFS.find((d) => d.id === col.id);
          if (def) {
            setColumns((prev) =>
              prev.map((c, idx) =>
                idx === si ? { ...c, visibility: cycleVisibility(c.visibility, def.supportsAuto) } : c
              )
            );
          }
          break;
        }
        case 'escape':
        case 'q':
          closeColumnModal();
          break;
        default:
          if (key.raw === 'r' || key.raw === 'R') {
            setColumnModal({ selectedIndex: si, reordering: true });
          } else if (key.raw === 'C') {
            closeColumnModal();
          }
          break;
      }
    }
    return true;
  }, { focusId: 'column-modal' });

  // Filter modal navigation — only fires when filter-modal focus is active.
  useFocusedKeyboard((key) => {
    key.stopPropagation();
    if (!filterModal) return true;

    // ── Field list level ────────────────────────────────────────
    if (filterModal.level === 'fields') {
      const items = filterFieldItems;
      switch (key.name) {
        case 'up':
        case 'k':
          setFilterModal({ ...filterModal, selectedIndex: Math.max(0, filterModal.selectedIndex - 1) });
          break;
        case 'down':
        case 'j':
          setFilterModal({ ...filterModal, selectedIndex: Math.min(items.length - 1, filterModal.selectedIndex + 1) });
          break;
        case 'return': {
          const item = items[filterModal.selectedIndex];
          if (!item) break;
          if (item.type === 'preset') {
            setFilters(item.preset.filters);
            setFilterModal(null);
          } else if (item.type === 'field') {
            if (item.def.type === 'string') {
              const current = filters[item.def.id] as StringFilter | undefined;
              setFilterModal({
                level: 'string-picker',
                fieldId: item.def.id,
                inputValue: current?.value ?? '',
                mode: current?.mode ?? 'fuzzy',
                selectedIndex: 0,
              });
            } else {
              const current = (filters[item.def.id] as string[] | undefined) ?? [];
              setFilterModal({
                level: 'multiselect-picker',
                fieldId: item.def.id,
                selected: [...current],
                selectedIndex: 0,
              });
            }
          } else if (item.type === 'clear') {
            setFilters(EMPTY_FILTERS);
          } else if (item.type === 'save') {
            setFilterModal({ level: 'save-preset', inputValue: '' });
          }
          break;
        }
        case 'escape':
        case 'q':
          setFilterModal(null);
          break;
        default:
          if (key.raw === 'f' || key.raw === 'F') {
            setFilterModal(null);
          } else if (key.raw === 'd' || key.raw === 'D') {
            const item = items[filterModal.selectedIndex];
            if (item?.type === 'preset') {
              const next = filterPresets.filter((_, idx) => idx !== item.index);
              setFilterPresets(next);
              void writeFilterPresets(PR_VIEW_NAME, next);
              setFilterModal({
                ...filterModal,
                selectedIndex: Math.min(filterModal.selectedIndex, items.length - 2),
              });
            }
          }
          break;
      }
    }

    // ── String picker level ─────────────────────────────────────
    if (filterModal.level === 'string-picker') {
      const allValues = stringFieldValues[filterModal.fieldId as keyof typeof stringFieldValues] ?? [];
      const query = filterModal.inputValue.toLowerCase();
      const suggestions = query
        ? allValues.filter((v) => v.toLowerCase().includes(query))
        : allValues;

      switch (key.name) {
        case 'up':
          setFilterModal({ ...filterModal, selectedIndex: Math.max(0, filterModal.selectedIndex - 1) });
          break;
        case 'down':
          setFilterModal({ ...filterModal, selectedIndex: Math.min(suggestions.length - 1, filterModal.selectedIndex + 1) });
          break;
        case 'tab': {
          setFilterModal({
            ...filterModal,
            mode: filterModal.mode === 'fuzzy' ? 'exact' : 'fuzzy',
          });
          break;
        }
        case 'return': {
          const value = suggestions[filterModal.selectedIndex] ?? filterModal.inputValue;
          if (value) {
            setFilters((prev) => ({
              ...prev,
              [filterModal.fieldId]: { value, mode: filterModal.mode },
            }));
          } else {
            setFilters((prev) => {
              const next = { ...prev };
              delete next[filterModal.fieldId];
              return next;
            });
          }
          setFilterModal({ level: 'fields', selectedIndex: 0 });
          break;
        }
        case 'backspace':
          setFilterModal({ ...filterModal, inputValue: filterModal.inputValue.slice(0, -1), selectedIndex: 0 });
          break;
        case 'escape':
          setFilterModal({ level: 'fields', selectedIndex: 0 });
          break;
        default:
          if (key.raw && key.raw.length >= 1 && key.raw >= ' ') {
            setFilterModal({
              ...filterModal,
              inputValue: filterModal.inputValue + key.raw,
              selectedIndex: 0,
            });
          }
          break;
      }
    }

    // ── Multiselect picker level ────────────────────────────────
    if (filterModal.level === 'multiselect-picker') {
      const options = MULTISELECT_OPTIONS[filterModal.fieldId] ?? [];

      switch (key.name) {
        case 'up':
        case 'k':
          setFilterModal({ ...filterModal, selectedIndex: Math.max(0, filterModal.selectedIndex - 1) });
          break;
        case 'down':
        case 'j':
          setFilterModal({ ...filterModal, selectedIndex: Math.min(options.length - 1, filterModal.selectedIndex + 1) });
          break;
        case 'return': {
          const opt = options[filterModal.selectedIndex];
          if (opt) {
            const sel = filterModal.selected;
            const next = sel.includes(opt.value)
              ? sel.filter((v) => v !== opt.value)
              : [...sel, opt.value];
            setFilterModal({ ...filterModal, selected: next });
          }
          break;
        }
        case 'escape': {
          const selected = filterModal.selected;
          if (selected.length > 0) {
            setFilters((prev) => ({ ...prev, [filterModal.fieldId]: selected }));
          } else {
            setFilters((prev) => {
              const next = { ...prev };
              delete next[filterModal.fieldId];
              return next;
            });
          }
          setFilterModal({ level: 'fields', selectedIndex: 0 });
          break;
        }
      }
      // Space also toggles
      if (key.raw === ' ') {
        const opt = options[filterModal.selectedIndex];
        if (opt) {
          const sel = filterModal.selected;
          const next = sel.includes(opt.value)
            ? sel.filter((v) => v !== opt.value)
            : [...sel, opt.value];
          setFilterModal({ ...filterModal, selected: next });
        }
      }
    }

    // ── Save preset level ───────────────────────────────────────
    if (filterModal.level === 'save-preset') {
      switch (key.name) {
        case 'return': {
          if (filterModal.inputValue.trim()) {
            const preset: FilterPreset = {
              label: filterModal.inputValue.trim(),
              filters: { ...filters },
            };
            const next = [...filterPresets, preset];
            setFilterPresets(next);
            void writeFilterPresets(PR_VIEW_NAME, next);
          }
          setFilterModal({ level: 'fields', selectedIndex: 0 });
          break;
        }
        case 'escape':
          setFilterModal({ level: 'fields', selectedIndex: 0 });
          break;
        case 'backspace':
          setFilterModal({ ...filterModal, inputValue: filterModal.inputValue.slice(0, -1) });
          break;
        default:
          if (key.raw && key.raw.length >= 1 && key.raw >= ' ') {
            setFilterModal({ ...filterModal, inputValue: filterModal.inputValue + key.raw });
          }
          break;
      }
    }

    return true;
  }, { focusId: 'filter-modal' });

  // Search text input — only fires when pr-search focus is active.
  useFocusedKeyboard((key) => {
    key.stopPropagation();
    const shouldCommit =
      key.name === 'return' || key.name === 'tab' ||
      key.name === 'up' || key.name === 'down' || key.raw === '\t';
    if (key.name === 'escape') {
      setSearchMode(false);
      setSearchQuery('');
    } else if (shouldCommit) {
      setSearchMode(false);
    } else if (key.name === 'backspace') {
      setSearchQuery(searchQuery.slice(0, -1));
    } else if (key.raw && key.raw.length >= 1 && key.raw >= ' ') {
      setSearchQuery(searchQuery + key.raw);
      setSelectedIndex(0);
      setScrollOffset(0);
    }
    return true;
  }, { focusId: 'pr-search' });

  // Page/Home/End navigation — only fires when no focus is claimed.
  useFocusedKeyboard((key) => {
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

  // ─── Resolve column visibility from config + auto rules ─────
  const compact = width < 120;
  const veryCompact = width < 90;
  const hasDistinctAuthors = useMemo(
    () => new Set(prs.map((pr) => pr.author)).size > 1,
    [prs]
  );
  const maxPrNumber = useMemo(
    () => filteredPRs.reduce((max, pr) => Math.max(max, pr.number), 0),
    [filteredPRs]
  );

  /** Resolve 'auto' visibility to a concrete boolean for each column. */
  const autoResolvers: Record<string, () => boolean> = useMemo(() => ({
    role: () => !repoMode,
    author: () => !!repoMode && hasDistinctAuthors,
    repo: () => !repoMode,
    linear: () => hasLinear,
  }), [repoMode, hasDistinctAuthors, hasLinear]);

  /** Ordered list of columns with resolved visibility and widths. */
  const resolvedColumns = useMemo(() => {
    const numberWidth = Math.max(2, String(maxPrNumber).length) + 2; // # + digits + space

    // Width resolvers per column id (before flex fill)
    const widthOf: Record<string, () => number> = {
      role: () => 4,
      author: () => Math.min(20, Math.floor(width * 0.15)),
      number: () => numberWidth,
      title: () => 0, // flex fill — computed after
      repo: () => Math.min(hasAnyAmbiguous ? 25 : 18, Math.floor(width * 0.2)),
      updated: () => veryCompact ? 8 : 12,
      ci: () => veryCompact ? 8 : 12,
      merge: () => compact ? 3 : 11,
      linear: () => compact ? 10 : 12,
      review: () => compact ? 3 : 15,
    };

    type ResolvedCol = { id: string; width: number; visible: boolean };
    const cols: ResolvedCol[] = columns.map((col) => {
      let visible: boolean;
      if (col.visibility === 'auto') {
        visible = autoResolvers[col.id]?.() ?? true;
      } else {
        visible = col.visibility === 'visible';
      }
      const w = visible ? (widthOf[col.id]?.() ?? 0) : 0;
      return { id: col.id, width: w, visible };
    });

    // Title is flex fill — gets remaining space
    const fixedTotal = cols.reduce((sum, c) => sum + (c.id === 'title' ? 0 : c.width), 0);
    const titleCol = cols.find((c) => c.id === 'title');
    if (titleCol && titleCol.visible) {
      titleCol.width = Math.max(20, width - fixedTotal - 6);
    }

    return cols;
  }, [columns, width, compact, veryCompact, maxPrNumber, hasAnyAmbiguous, autoResolvers]);


  const sortHeader = (label: string, field: SortField, colWidth: number): string => {
    const layerIdx = sortLayers.findIndex((l) => l.field === field);
    if (layerIdx === -1) return label.padEnd(colWidth);
    const arrow = sortLayers[layerIdx].dir === 'asc' ? '↑' : '↓';
    return `${label}${arrow}`.padEnd(colWidth);
  };
  const tableFocused = !searchMode && !sortModal && !columnModal && !filterModal;
  const isFiltered = activeFilterCount > 0 || !!searchQuery;
  const headerText = ` git-switchboard pr${repoMode ? ` ${repoMode}` : ''}  ${
    isFiltered ? `${filteredPRs.length}/${prs.length}` : String(filteredPRs.length)
  } open PRs${activeFilterCount > 0 ? ` | ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''}` : ''}${
    searchQuery ? ` | Search: ${searchQuery}` : ''
  }${searchMode ? ` | (type to search, [${RETURN_SYMBOL}] confirm)` : ''}`;
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
          content={' ' + resolvedColumns
            .filter((c) => c.visible)
            .map((c) => {
              const w = c.width;
              const sortField = SORTABLE_COLUMNS[c.id as PrColumnId];
              const headerLabel = COLUMN_HEADERS[c.id as PrColumnId]?.(compact, veryCompact) ?? c.id;
              if (sortField) return sortHeader(headerLabel, sortField, w);
              return headerLabel.padEnd(w);
            })
            .join('')}
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
            const prLoading = dataLayer.loading.isPrLoading(prKey);
            const ciStatus = ciSummary(pr.ci, SPINNER_FRAMES[spinnerFrame], prLoading);
            const linearIssues = dataLayer.query.linearIssuesForPr(prKey);
            const linearIssue = linearIssues[0];
            const linearLoading = linearIssues.length === 0 && dataLayer.loading.loadingLinearKeys().size > 0;
            const linearText = linearIssue
              ? linearIssue.identifier
              : linearLoading
                ? SPINNER_FRAMES[spinnerFrame]
                : (hasLinear ? '-' : '');
            const rvw = reviewLabel(pr.review?.status, compact);
            const merge = mergeLabel(pr.mergeable, compact);
            const roleIcon = roleIndicator(pr.role);

            // Per-column render data: { text, fg, width }
            const colData: Record<string, { text: string; fg: string }> = {
              role: { text: roleIcon.text, fg: roleIcon.fg },
              author: { text: pr.author, fg: '#bb9af7' },
              number: { text: `#${pr.number}`, fg: '#c0caf5' },
              title: { text: pr.title, fg: '#c0caf5' },
              repo: {
                text: ambiguousRepoNames.has(pr.repoName)
                  ? `${pr.repoOwner}/${pr.repoName}`
                  : pr.repoName,
                fg: '#a9b1d6',
              },
              updated: { text: relativeTime(pr.updatedAt), fg: '#565f89' },
              ci: { text: ciStatus.text, fg: ciStatus.fg },
              merge: { text: merge.text, fg: merge.fg },
              linear: { text: linearText, fg: '#bb9af7' },
              review: { text: rvw.text, fg: rvw.fg },
            };

            const visibleCols = resolvedColumns.filter((c) => c.visible);

            return (
              <box
                key={`${pr.repoId}#${pr.number}`}
                style={{ height: 1, width: '100%', backgroundColor: bg }}
                onMouseDown={() => {
                  if (actualIndex === selectedIndex) {
                    const matches = repoMatchMap.get(`${pr.repoId}#${pr.number}`) ?? [];
                    navigate({ type: 'pr-detail', pr, matches });
                  } else {
                    moveTo(actualIndex);
                  }
                }}
              >
                <text>
                  {visibleCols.map((col, ci) => {
                    const d = colData[col.id];
                    if (!d) return null;
                    const fg = tableFocused
                      ? d.fg
                      : col.id === 'updated'
                        ? muteColor(d.fg, 0.3)
                        : muteColor(d.fg);
                    const sliced = d.text.slice(0, col.width - 1);
                    const padded = (ci === 0 ? ' ' : '') + sliced.padEnd(ci === 0 ? col.width - 1 : col.width);
                    return <span key={col.id} fg={fg}>{padded}</span>;
                  })}
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

      {/* Column config modal */}
      {columnModal && (
        <box
          style={{
            position: 'absolute',
            top: Math.floor(height / 2) - Math.floor((columns.length + 4) / 2),
            left: Math.floor(width / 2) - 22,
            width: 44,
            height: columns.length + 4,
          }}
        >
          <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text content=" Columns" fg="#7aa2f7" />
            </box>
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text content={'─'.repeat(44)} fg="#292e42" />
            </box>
            {columns.map((col, i) => {
              const isActive = i === columnModal.selectedIndex;
              const isGrabbed = isActive && columnModal.reordering;
              const def = PR_COLUMN_DEFS.find((d) => d.id === col.id);
              const visIcon = col.visibility === 'auto' ? '▣' : col.visibility === 'visible' ? '✓' : '✗';
              const label = def?.label ?? col.id;
              const grip = isGrabbed ? '≡' : ' ';
              return (
                <box
                  key={col.id}
                  style={{
                    height: 1,
                    width: '100%',
                    backgroundColor: isGrabbed
                      ? '#3b4261'
                      : isActive
                        ? '#292e42'
                        : '#1a1b26',
                  }}
                  onMouseDown={() => {
                    if (isActive) {
                      if (def) {
                        setColumns((prev) =>
                          prev.map((c, idx) =>
                            idx === i ? { ...c, visibility: cycleVisibility(c.visibility, def.supportsAuto) } : c
                          )
                        );
                      }
                    } else {
                      setColumnModal({ selectedIndex: i, reordering: false });
                    }
                  }}
                >
                  <text
                    content={` ${grip} ${isActive ? '>' : ' '} ${visIcon} ${label}`}
                    fg={
                      col.visibility === 'hidden'
                        ? '#565f89'
                        : isActive
                          ? '#c0caf5'
                          : '#a9b1d6'
                    }
                  />
                </box>
              );
            })}
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text
                content={
                  columnModal.reordering
                    ? ' ↑↓ move | Enter/Esc done'
                    : ' Enter toggle | r reorder | Esc close'
                }
                fg="#565f89"
              />
            </box>
          </box>
        </box>
      )}

      {/* Filter modal — field list */}
      {filterModal?.level === 'fields' && (
        <box
          style={{
            position: 'absolute',
            top: Math.floor(height / 2) - Math.floor((filterFieldItems.length + 4) / 2),
            left: Math.floor(width / 2) - 22,
            width: 44,
            height: filterFieldItems.length + 4,
          }}
        >
          <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text
                content={activeFilterCount > 0 ? ` Filters (${activeFilterCount} active)` : ' Filters'}
                fg="#7aa2f7"
              />
            </box>
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text content={'─'.repeat(44)} fg="#292e42" />
            </box>
            {filterFieldItems.map((item, i) => {
              const isActive = i === filterModal.selectedIndex;
              let label: string;
              let valueText = '';
              let fg: string;

              if (item.type === 'preset') {
                label = `★ ${item.preset.label}`;
                fg = isActive ? '#e0af68' : '#bb9af7';
              } else if (item.type === 'field') {
                label = item.def.label;
                const val = filters[item.def.id];
                if (item.def.type === 'string' && val && typeof val === 'object' && 'value' in val) {
                  const sf = val as StringFilter;
                  valueText = ` = ${sf.mode === 'exact' ? '"' : ''}${sf.value}${sf.mode === 'exact' ? '"' : ''}`;
                } else if (Array.isArray(val) && val.length > 0) {
                  valueText = ` = ${val.join(', ')}`;
                }
                fg = valueText
                  ? (isActive ? '#c0caf5' : '#7aa2f7')
                  : (isActive ? '#a9b1d6' : '#565f89');
              } else if (item.type === 'clear') {
                label = '✗ Clear all filters';
                fg = isActive ? '#f7768e' : '#565f89';
              } else {
                label = '+ Save as preset';
                fg = isActive ? '#9ece6a' : '#565f89';
              }

              const itemKey = item.type === 'field' ? item.def.id
                : item.type === 'preset' ? `preset-${item.index}`
                : item.type;

              return (
                <box
                  key={itemKey}
                  style={{
                    height: 1,
                    width: '100%',
                    backgroundColor: isActive ? '#292e42' : '#1a1b26',
                  }}
                >
                  <text
                    content={` ${isActive ? '>' : ' '} ${label}${valueText}`}
                    fg={fg}
                  />
                </box>
              );
            })}
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text content=" Enter select | d delete preset | Esc close" fg="#565f89" />
            </box>
          </box>
        </box>
      )}

      {/* Filter modal — string picker */}
      {filterModal?.level === 'string-picker' && (() => {
        const allValues = stringFieldValues[filterModal.fieldId as keyof typeof stringFieldValues] ?? [];
        const query = filterModal.inputValue.toLowerCase();
        const suggestions = query
          ? allValues.filter((v) => v.toLowerCase().includes(query))
          : allValues;
        const maxVisible = Math.min(suggestions.length, 10);
        const fieldDef = FILTER_FIELD_DEFS.find((d) => d.id === filterModal.fieldId);
        const modalHeight = maxVisible + 5;

        return (
          <box
            style={{
              position: 'absolute',
              top: Math.floor(height / 2) - Math.floor(modalHeight / 2),
              left: Math.floor(width / 2) - 22,
              width: 44,
              height: modalHeight,
            }}
          >
            <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
              <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
                <text content={` ${fieldDef?.label ?? filterModal.fieldId} (${filterModal.mode})`} fg="#7aa2f7" />
              </box>
              <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
                <text content={'─'.repeat(44)} fg="#292e42" />
              </box>
              <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
                <text content={` > ${filterModal.inputValue}█`} fg="#c0caf5" />
              </box>
              {suggestions.slice(0, maxVisible).map((val, i) => {
                const isActive = i === filterModal.selectedIndex;
                return (
                  <box
                    key={val}
                    style={{
                      height: 1,
                      width: '100%',
                      backgroundColor: isActive ? '#292e42' : '#1a1b26',
                    }}
                  >
                    <text
                      content={`   ${isActive ? '>' : ' '} ${val}`}
                      fg={isActive ? '#c0caf5' : '#a9b1d6'}
                    />
                  </box>
                );
              })}
              <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
                <text content=" Tab fuzzy/exact | Enter confirm | Esc back" fg="#565f89" />
              </box>
            </box>
          </box>
        );
      })()}

      {/* Filter modal — multiselect picker */}
      {filterModal?.level === 'multiselect-picker' && (() => {
        const options = MULTISELECT_OPTIONS[filterModal.fieldId] ?? [];
        const fieldDef = FILTER_FIELD_DEFS.find((d) => d.id === filterModal.fieldId);
        const modalHeight = options.length + 4;

        return (
          <box
            style={{
              position: 'absolute',
              top: Math.floor(height / 2) - Math.floor(modalHeight / 2),
              left: Math.floor(width / 2) - 22,
              width: 44,
              height: modalHeight,
            }}
          >
            <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
              <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
                <text content={` ${fieldDef?.label ?? filterModal.fieldId}`} fg="#7aa2f7" />
              </box>
              <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
                <text content={'─'.repeat(44)} fg="#292e42" />
              </box>
              {options.map((opt, i) => {
                const isActive = i === filterModal.selectedIndex;
                const isChecked = filterModal.selected.includes(opt.value);
                return (
                  <box
                    key={opt.value}
                    style={{
                      height: 1,
                      width: '100%',
                      backgroundColor: isActive ? '#292e42' : '#1a1b26',
                    }}
                  >
                    <text
                      content={` ${isActive ? '>' : ' '} [${isChecked ? '✓' : ' '}] ${opt.label}`}
                      fg={isChecked ? (isActive ? '#c0caf5' : '#7aa2f7') : (isActive ? '#a9b1d6' : '#565f89')}
                    />
                  </box>
                );
              })}
              <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
                <text content=" Enter/Space toggle | Esc apply & back" fg="#565f89" />
              </box>
            </box>
          </box>
        );
      })()}

      {/* Filter modal — save preset */}
      {filterModal?.level === 'save-preset' && (
        <box
          style={{
            position: 'absolute',
            top: Math.floor(height / 2) - 2,
            left: Math.floor(width / 2) - 22,
            width: 44,
            height: 4,
          }}
        >
          <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text content=" Save Filter Preset" fg="#7aa2f7" />
            </box>
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text content={'─'.repeat(44)} fg="#292e42" />
            </box>
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text content={` Name: ${filterModal.inputValue}█`} fg="#c0caf5" />
            </box>
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text content=" Enter save | Esc cancel" fg="#565f89" />
            </box>
          </box>
        </box>
      )}
    </box>
  );
}

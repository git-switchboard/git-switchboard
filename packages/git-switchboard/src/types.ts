export interface BranchInfo {
  name: string;
  author: string;
  date: Date;
  isRemote: boolean;
  isCurrent: boolean;
  trackingBranch?: string;
  /** Relative time string like "2d ago" */
  relativeDate: string;
}

export interface PullRequestInfo {
  number: number;
  title: string;
  state: string;
  draft: boolean;
}

export type PRRole = 'author' | 'assigned' | 'both';

export interface UserPullRequest {
  /** GitHub GraphQL node ID for batched enrichment queries */
  nodeId: string;
  number: number;
  title: string;
  state: string;
  draft: boolean;
  /** The base repo (where the PR is opened against) */
  repoOwner: string;
  repoName: string;
  /** owner/name in lowercase for matching */
  repoId: string;
  /** The head (fork) repo if different from base, for matching local clones */
  forkRepoId: string | null;
  headRef: string;
  updatedAt: string;
  url: string;
  /** GitHub login of the PR author */
  author: string;
  /** Whether this PR was authored by the user, assigned to them, or both */
  role: PRRole;
}

export type MergeableStatus = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';

export type CIStatus = "unknown" | "pending" | "passing" | "failing" | "mixed";

export interface CheckRun {
  id: number;
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** GitHub App slug that created this check (e.g. "github-actions", "nx-cloud"). Null for commit statuses. */
  appSlug: string | null;
}

export interface CIInfo {
  status: CIStatus;
  checks: CheckRun[];
  fetchedAt: number;
}

export type ReviewStatus =
  | "needs-review"
  | "approved"
  | "changes-requested"
  | "commented"
  | "dismissed"
  | "re-review-needed";

export interface ReviewerState {
  login: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED" | "COMMENTED" | "PENDING";
  submittedAt: string;
}

export interface ReviewInfo {
  status: ReviewStatus;
  reviewers: ReviewerState[];
  fetchedAt: number;
}

export interface BranchWithPR extends BranchInfo {
  pr?: PullRequestInfo;
  linearIssue?: LinearIssue;
}

// ─── Column types (generic, shared across table views) ──────────────────────

export type ColumnVisibility = 'auto' | 'visible' | 'hidden';

export interface ColumnConfig<TId extends string = string> {
  id: TId;
  visibility: ColumnVisibility;
}

export interface ColumnDef<TId extends string = string> {
  id: TId;
  label: string;
  /** Whether this column supports the 'auto' visibility state */
  supportsAuto: boolean;
}

/** Build default column config from definitions — auto-capable cols start as 'auto', others as 'visible'. */
export function defaultColumns<TId extends string>(defs: ColumnDef<TId>[]): ColumnConfig<TId>[] {
  return defs.map((def) => ({
    id: def.id,
    visibility: def.supportsAuto ? ('auto' as const) : ('visible' as const),
  }));
}

/** Cycle visibility: two-state (visible↔hidden) or three-state (auto→visible→hidden→auto). */
export function cycleVisibility(current: ColumnVisibility, supportsAuto: boolean): ColumnVisibility {
  if (supportsAuto) {
    switch (current) {
      case 'auto': return 'visible';
      case 'visible': return 'hidden';
      case 'hidden': return 'auto';
    }
  }
  return current === 'visible' ? 'hidden' : 'visible';
}

// ─── Filter types (shared between pr-app and store) ─────────────────────────

export type StringMatchMode = 'fuzzy' | 'exact';

export interface StringFilter {
  value: string;
  mode: StringMatchMode;
}

export interface FilterState {
  org?: StringFilter;
  repo?: StringFilter;
  author?: StringFilter;
  linear?: StringFilter;
  role?: PRRole[];
  review?: ReviewStatus[];
  ci?: CIStatus[];
  merge?: MergeableStatus[];
}

export const EMPTY_FILTERS: FilterState = {};

export type FilterFieldId = keyof FilterState;

export interface FilterFieldDef {
  id: FilterFieldId;
  label: string;
  type: 'string' | 'multiselect';
}

export const FILTER_FIELD_DEFS: FilterFieldDef[] = [
  { id: 'org', label: 'Organization', type: 'string' },
  { id: 'repo', label: 'Repository', type: 'string' },
  { id: 'author', label: 'Author', type: 'string' },
  { id: 'linear', label: 'Linear Issue', type: 'string' },
  { id: 'role', label: 'Role', type: 'multiselect' },
  { id: 'review', label: 'Review Status', type: 'multiselect' },
  { id: 'ci', label: 'CI Status', type: 'multiselect' },
  { id: 'merge', label: 'Merge Status', type: 'multiselect' },
];

export interface FilterPreset {
  label: string;
  filters: FilterState;
}

// ─── Sort types (shared between pr-app and store) ──────────────────────────
export type SortField = 'updated' | 'review' | 'ci' | 'repo' | 'merge' | 'number' | 'diff';
export type SortDir = 'asc' | 'desc';

export interface SortLayer {
  field: SortField;
  dir: SortDir;
}

export const DEFAULT_SORT: SortLayer[] = [
  { field: 'review', dir: 'asc' },
  { field: 'updated', dir: 'desc' },
];

export type AuthorFilterMode = "all" | "me" | "list";

export interface WorktreeInfo {
  /** Absolute path to the worktree */
  path: string;
  /** Currently checked-out branch name (without refs/heads/ prefix), or undefined for detached HEAD */
  branch: string | undefined;
  /** True if this is the main (primary) worktree */
  isMain: boolean;
}

export type WorktreeConflictAction =
  | { type: 'open-editor'; worktreePath: string }
  | { type: 'checkout-new-branch'; newBranchName: string; fromBranch: string; stashCurrentFirst: boolean }
  | {
      type: 'move-worktree-to-new-branch';
      worktreePath: string;
      newBranchName: string;
      fromBranch: string;
      /** Branch to checkout in the current worktree after the move. */
      thenCheckout: string;
      stashCurrentFirst: boolean;
    }
  | {
      type: 'move-worktree-to-existing-branch';
      worktreePath: string;
      targetBranch: string;
      /** Branch to checkout in the current worktree after the move. */
      thenCheckout: string;
      stashOtherFirst: boolean;
      stashCurrentFirst: boolean;
    };

export interface AppState {
  branches: BranchWithPR[];
  showRemote: boolean;
  authorFilter: AuthorFilterMode;
  searchQuery: string;
  selectedIndex: number;
  currentUser: string;
  authorList: string[];
}

// ─── Linear ─────────────────────────────────────────────────────

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: number;
  assignee: string | null;
  url: string;
  teamKey: string;
}

export interface LinearAttachment {
  issueId: string;
  issueIdentifier: string;
  url: string;
}

export interface LinearData {
  /** identifier → issue (e.g., "ENG-123" → LinearIssue) */
  issues: Map<string, LinearIssue>;
  /** GitHub PR URL → Linear issue identifier */
  attachments: Map<string, string>;
}

export interface ProviderRateLimit {
  provider: string;
  remaining: number;
  limit: number;
  used: number;
  resetAt: Date;
}

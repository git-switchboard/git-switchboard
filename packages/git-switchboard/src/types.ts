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
}

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

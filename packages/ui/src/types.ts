// ─── Shared data types ─────────────────────────────────────────
// Matches the types from the main git-switchboard package.

export interface BranchInfo {
  name: string;
  author: string;
  date: string;
  isRemote: boolean;
  isCurrent: boolean;
  trackingBranch?: string;
  relativeDate: string;
}

export interface PullRequestInfo {
  number: number;
  title: string;
  state: string;
  draft: boolean;
}

export interface BranchWithPR extends BranchInfo {
  pr?: PullRequestInfo;
}

export type PRRole = 'author' | 'assigned' | 'both';

export interface UserPullRequest {
  nodeId: string;
  number: number;
  title: string;
  state: string;
  draft: boolean;
  repoOwner: string;
  repoName: string;
  repoId: string;
  forkRepoId: string | null;
  headRef: string;
  updatedAt: string;
  url: string;
  author: string;
  role: PRRole;
}

export type CIStatus = 'unknown' | 'pending' | 'passing' | 'failing' | 'mixed';

export interface CheckRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
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
  | 'needs-review'
  | 'approved'
  | 'changes-requested'
  | 'commented'
  | 'dismissed'
  | 're-review-needed';

export interface ReviewerState {
  login: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED' | 'COMMENTED' | 'PENDING';
  submittedAt: string;
}

export interface ReviewInfo {
  status: ReviewStatus;
  reviewers: ReviewerState[];
  fetchedAt: number;
}

export type MergeableStatus = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';

// ─── Bridge message types ──────────────────────────────────────

export interface BranchPickerInitData {
  view: 'branch-picker';
  branches: BranchWithPR[];
  currentUser: string;
  showRemote: boolean;
}

export interface PRDashboardInitData {
  view: 'pr-dashboard';
  prs: PRDisplayData[];
  repoMode: string | null;
}

export interface PRDisplayData extends UserPullRequest {
  ciLabel: string;
  ciColor: string;
  reviewLabel: string;
  reviewColor: string;
  mergeLabel: string;
  mergeColor: string;
}

export type InitData = BranchPickerInitData | PRDashboardInitData;

/** Messages sent from the UI to the host */
export type OutgoingMessage =
  | { type: 'ready' }
  | { type: 'select-branch'; data: BranchWithPR }
  | { type: 'select-pr'; data: UserPullRequest }
  | { type: 'toggle-remote'; data: { showRemote: boolean } }
  | { type: 'exit' };

/** Messages sent from the host to the UI */
export type IncomingMessage =
  | { type: 'init'; data: InitData }
  | { type: 'update-branches'; data: BranchWithPR[] }
  | { type: 'update-prs'; data: PRDisplayData[] };

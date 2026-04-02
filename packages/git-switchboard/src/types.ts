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

export interface UserPullRequest {
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
}

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

export interface AppState {
  branches: BranchWithPR[];
  showRemote: boolean;
  authorFilter: AuthorFilterMode;
  searchQuery: string;
  selectedIndex: number;
  currentUser: string;
  authorList: string[];
}

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
  repoOwner: string;
  repoName: string;
  /** owner/name in lowercase for matching */
  repoId: string;
  headRef: string;
  updatedAt: string;
  url: string;
}

export type CIStatus = "unknown" | "pending" | "passing" | "failing" | "mixed";

export interface CheckRun {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
  detailsUrl: string | null;
}

export interface CIInfo {
  status: CIStatus;
  checks: CheckRun[];
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

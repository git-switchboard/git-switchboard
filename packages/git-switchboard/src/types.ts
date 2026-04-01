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

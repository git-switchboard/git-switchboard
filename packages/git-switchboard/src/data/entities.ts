import type { CIInfo, ReviewInfo, MergeableStatus, PRRole } from '../types.js';

export interface PR {
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
  url: string;
  author: string;
  role: PRRole;
  updatedAt: string;
  ci?: CIInfo;
  review?: ReviewInfo;
  mergeable?: MergeableStatus;
}

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

export interface Branch {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
  lastCommitDate?: string;
}

export interface LocalCheckout {
  path: string;
  remoteUrl: string | null;
  repoId: string | null;
  currentBranch: string;
  isWorktree: boolean;
  parentCheckoutKey: string | null;
}

import type { EntityStore } from './entity-store.js';

export interface Stores {
  prs: EntityStore<PR>;
  linearIssues: EntityStore<LinearIssue>;
  branches: EntityStore<Branch>;
  checkouts: EntityStore<LocalCheckout>;
}

export const prKey = (pr: PR): string => `${pr.repoId}#${pr.number}`;
export const linearKey = (issue: LinearIssue): string => issue.identifier;
export const branchKey = (branch: Branch): string => branch.name;
export const checkoutKey = (checkout: LocalCheckout): string => checkout.path;

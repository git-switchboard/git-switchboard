import type { PR, LinearIssue, Branch, LocalCheckout } from './entities.js';

export type RelationType =
  | 'prToLinear'
  | 'branchToPr'
  | 'branchToLinear'
  | 'checkoutToPr'
  | 'checkoutToBranch';

export type DataEventMap = {
  // Data events
  'pr:discovered': PR;
  'pr:enriched': PR;
  'linear:issue:discovered': LinearIssue;
  'linear:attachment:discovered': { prUrl: string; issueIdentifier: string };
  'branch:discovered': Branch;
  'checkout:discovered': LocalCheckout;
  'relation:created': {
    type: RelationType;
    sourceKey: string;
    targetKey: string;
  };

  // Command events
  'pr:fetch': { repoId: string; number: number };
  'pr:fetchDetail': { repoId: string; number: number; force?: boolean };
  'pr:fetchAll': { repoMode: string | null };
  'linear:issue:fetch': { identifier: string };
  'linear:fetchAll': {};
  'checkout:scan': { paths?: string[] };

  // Error events
  'error': { source: string; message: string };
};

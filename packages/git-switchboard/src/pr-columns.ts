import type { ColumnDef } from './types.js';

export type PrColumnId =
  | 'role'
  | 'author'
  | 'number'
  | 'title'
  | 'repo'
  | 'updated'
  | 'ci'
  | 'merge'
  | 'diff'
  | 'linear'
  | 'review';

export const PR_COLUMN_DEFS: ColumnDef<PrColumnId>[] = [
  { id: 'role', label: 'Role', supportsAuto: true },
  { id: 'author', label: 'Author', supportsAuto: true },
  { id: 'number', label: 'PR Number', supportsAuto: false },
  { id: 'title', label: 'Title', supportsAuto: false },
  { id: 'repo', label: 'Repository', supportsAuto: true },
  { id: 'updated', label: 'Updated', supportsAuto: false },
  { id: 'ci', label: 'CI Status', supportsAuto: false },
  { id: 'merge', label: 'Merge Status', supportsAuto: false },
  { id: 'diff', label: 'Diff', supportsAuto: false },
  { id: 'linear', label: 'Linear', supportsAuto: true },
  { id: 'review', label: 'Review', supportsAuto: false },
];

export const PR_VIEW_NAME = 'pr-list';

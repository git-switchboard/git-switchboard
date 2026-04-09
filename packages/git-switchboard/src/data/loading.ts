import type { EventBus } from './event-bus.js';
import type { DataEventMap } from './events.js';

export interface LoadingTracker {
  /** Check if a specific PR's detail data is being fetched */
  isPrLoading(prKey: string): boolean;
  /** Check if a specific Linear issue is being fetched */
  isLinearLoading(identifier: string): boolean;
  /** Check if the full PR list is being refreshed */
  isPrListLoading(): boolean;
  /** Get all currently loading PR keys */
  loadingPrKeys(): ReadonlySet<string>;
  /** Get all currently loading Linear identifiers */
  loadingLinearKeys(): ReadonlySet<string>;
  destroy(): void;
}

export function createLoadingTracker(
  bus: EventBus<DataEventMap>,
): LoadingTracker {
  const loadingPrs = new Set<string>();
  const loadingLinear = new Set<string>();
  let prListLoading = false;

  const unsubs = [
    // PR detail fetching
    bus.on('pr:fetchDetail', ({ repoId, number }) => {
      loadingPrs.add(`${repoId}#${number}`);
    }),
    bus.on('pr:enriched', (pr) => {
      loadingPrs.delete(`${pr.repoId}#${pr.number}`);
    }),

    // Linear issue fetching
    bus.on('linear:issue:fetch', ({ identifier }) => {
      loadingLinear.add(identifier);
    }),
    bus.on('linear:issue:discovered', (issue) => {
      loadingLinear.delete(issue.identifier);
    }),

    // PR list refresh
    bus.on('pr:fetchAll', () => {
      prListLoading = true;
    }),
    bus.on('pr:discovered', () => {
      prListLoading = false;
    }),

    // Errors clear loading state
    bus.on('error', ({ source }) => {
      if (source === 'pr:fetchDetail') {
        // Can't know which specific PR failed — clear all
        loadingPrs.clear();
      } else if (source === 'linear:issue:fetch') {
        loadingLinear.clear();
      } else if (source === 'pr:fetchAll') {
        prListLoading = false;
      }
    }),
  ];

  return {
    isPrLoading: (key) => loadingPrs.has(key),
    isLinearLoading: (id) => loadingLinear.has(id),
    isPrListLoading: () => prListLoading,
    loadingPrKeys: () => loadingPrs,
    loadingLinearKeys: () => loadingLinear,
    destroy: () => { for (const unsub of unsubs) unsub(); },
  };
}

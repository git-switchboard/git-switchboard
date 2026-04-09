import type { EventBus } from '../event-bus.js';
import type { DataEventMap } from '../events.js';
import type { PR } from '../entities.js';
import type { Ingester } from '../ingest.js';
import type { EntityStore } from '../entity-store.js';
import type { CIInfo, ReviewInfo, MergeableStatus } from '../../types.js';

interface FetchUserPRsResult {
  prs: PR[];
  ciCache: Map<string, CIInfo>;
  reviewCache: Map<string, ReviewInfo>;
  mergeableCache: Map<string, MergeableStatus>;
}

interface GithubFetcherDeps {
  fetchPRDetailsBatch: (
    prs: PR[],
  ) => Promise<Map<string, { ci: CIInfo; review: ReviewInfo; mergeable: MergeableStatus }>>;
  fetchAllPRs?: (repoMode: string | null) => Promise<FetchUserPRsResult>;
  batchDelayMs?: number;
  /** How long before a successfully-fetched PR can be re-fetched (default 30s) */
  cooldownMs?: number;
}

interface Stores {
  prs: EntityStore<PR>;
}

export function createGithubFetcher(
  bus: EventBus<DataEventMap>,
  ingester: Ingester,
  stores: Stores,
  deps: GithubFetcherDeps,
): () => void {
  const batchDelay = deps.batchDelayMs ?? 50;
  const cooldown = deps.cooldownMs ?? 30_000;
  const pendingDetails = new Map<string, { repoId: string; number: number }>();
  const forcedKeys = new Set<string>();
  const inFlight = new Set<string>();
  const recentlyFetched = new Map<string, number>();
  let detailTimer: ReturnType<typeof setTimeout> | null = null;

  async function flushDetailBatch(): Promise<void> {
    const batch = new Map(pendingDetails);
    const batchForced = new Set(forcedKeys);
    pendingDetails.clear();
    forcedKeys.clear();
    detailTimer = null;

    const now = Date.now();
    const prsToFetch: PR[] = [];
    for (const [key] of batch) {
      if (inFlight.has(key)) continue;
      // Only apply cooldown for non-forced requests
      if (!batchForced.has(key)) {
        const lastFetch = recentlyFetched.get(key);
        if (lastFetch && now - lastFetch < cooldown) continue;
      }
      const pr = stores.prs.get(key);
      if (pr) prsToFetch.push(pr);
    }

    if (prsToFetch.length === 0) return;

    const batchKeys = prsToFetch.map((pr) => `${pr.repoId}#${pr.number}`);
    for (const key of batchKeys) inFlight.add(key);

    try {
      const results = await deps.fetchPRDetailsBatch(prsToFetch);

      const fetchedAt = Date.now();
      for (const key of results.keys()) {
        recentlyFetched.set(key, fetchedAt);
      }

      const enriched: PR[] = [];
      for (const [key, details] of results) {
        const existing = stores.prs.get(key);
        if (existing) {
          enriched.push({
            ...existing,
            ci: details.ci,
            review: details.review,
            mergeable: details.mergeable,
          });
        }
      }

      if (enriched.length > 0) {
        ingester.ingestPRs(enriched);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      bus.emit('error', { source: 'pr:fetchDetail', message });
    } finally {
      for (const key of batchKeys) inFlight.delete(key);
    }
  }

  const unsubDetail = bus.on('pr:fetchDetail', ({ repoId, number, force }) => {
    const key = `${repoId}#${number}`;

    if (force) {
      // Force: clear cooldown, allow even if pending/in-flight
      recentlyFetched.delete(key);
      forcedKeys.add(key);
    } else {
      // Normal: skip if already pending, in-flight, or recently fetched
      if (pendingDetails.has(key)) return;
      if (inFlight.has(key)) return;
      const lastFetch = recentlyFetched.get(key);
      if (lastFetch && Date.now() - lastFetch < cooldown) return;
    }

    pendingDetails.set(key, { repoId, number });

    if (!detailTimer) {
      detailTimer = setTimeout(flushDetailBatch, batchDelay);
    }
  });

  const unsubFetchAll = deps.fetchAllPRs
    ? bus.on('pr:fetchAll', async ({ repoMode }) => {
        try {
          const result = await deps.fetchAllPRs!(repoMode);
          const prsWithEnrichment: PR[] = result.prs.map((pr) => {
            const key = `${pr.repoId}#${pr.number}`;
            return {
              ...pr,
              ci: result.ciCache.get(key),
              review: result.reviewCache.get(key),
              mergeable: result.mergeableCache.get(key),
            };
          });
          ingester.ingestPRs(prsWithEnrichment);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          bus.emit('error', { source: 'pr:fetchAll', message });
        }
      })
    : null;

  return () => {
    unsubDetail();
    unsubFetchAll?.();
    if (detailTimer) clearTimeout(detailTimer);
  };
}

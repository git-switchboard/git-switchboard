import type { EventBus } from '../event-bus.js';
import type { DataEventMap } from '../events.js';
import type { PR } from '../entities.js';
import type { Ingester } from '../ingest.js';
import type { EntityStore } from '../entity-store.js';
import type { CIInfo, ReviewInfo, MergeableStatus } from '../../types.js';

interface GithubFetcherDeps {
  fetchPRDetailsBatch: (
    prs: PR[],
  ) => Promise<Map<string, { ci: CIInfo; review: ReviewInfo; mergeable: MergeableStatus }>>;
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
  const inFlight = new Set<string>();
  const recentlyFetched = new Map<string, number>();
  let detailTimer: ReturnType<typeof setTimeout> | null = null;

  async function flushDetailBatch(): Promise<void> {
    const batch = new Map(pendingDetails);
    pendingDetails.clear();
    detailTimer = null;

    const now = Date.now();
    const prsToFetch: PR[] = [];
    for (const [key] of batch) {
      // Skip if already in-flight
      if (inFlight.has(key)) continue;
      // Skip if recently fetched (cooldown)
      const lastFetch = recentlyFetched.get(key);
      if (lastFetch && now - lastFetch < cooldown) continue;
      // Resolve full PR from store
      const pr = stores.prs.get(key);
      if (pr) prsToFetch.push(pr);
    }

    if (prsToFetch.length === 0) return;

    // Mark in-flight
    const batchKeys = prsToFetch.map((pr) => `${pr.repoId}#${pr.number}`);
    for (const key of batchKeys) inFlight.add(key);

    try {
      const results = await deps.fetchPRDetailsBatch(prsToFetch);

      // Mark as recently fetched
      const fetchedAt = Date.now();
      for (const key of results.keys()) {
        recentlyFetched.set(key, fetchedAt);
      }

      // Re-ingest PRs with enrichment data
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

  const unsubDetail = bus.on('pr:fetchDetail', ({ repoId, number }) => {
    const key = `${repoId}#${number}`;
    // Skip if already pending, in-flight, or recently fetched
    if (pendingDetails.has(key)) return;
    if (inFlight.has(key)) return;
    const lastFetch = recentlyFetched.get(key);
    if (lastFetch && Date.now() - lastFetch < cooldown) return;

    pendingDetails.set(key, { repoId, number });

    if (!detailTimer) {
      detailTimer = setTimeout(flushDetailBatch, batchDelay);
    }
  });

  return () => {
    unsubDetail();
    if (detailTimer) clearTimeout(detailTimer);
  };
}

import type { EventBus } from './event-bus.js';
import type { DataEventMap } from './events.js';
import type {
  PR, LinearIssue, Branch, LocalCheckout, Stores,
} from './entities.js';
import { prKey, linearKey, branchKey, checkoutKey } from './entities.js';

export type { Stores };

export interface Ingester {
  ingestPRs(prs: PR[]): void;
  ingestLinearData(data: {
    issues: LinearIssue[];
    attachments: { prUrl: string; issueIdentifier: string }[];
  }): void;
  ingestBranches(branches: Branch[]): void;
  ingestCheckouts(checkouts: LocalCheckout[]): void;
}

type EventEntry<K extends keyof DataEventMap> = { event: K; payload: DataEventMap[K] };

export function createIngester(
  bus: EventBus<DataEventMap>,
  stores: Stores,
): Ingester {
  // Shared helper: two-phase batch ingest
  // Phase 1: store all items, collect events to emit
  // Phase 2: emit all events (effects now see the full batch in the store)
  function emitDeferred(events: EventEntry<keyof DataEventMap>[]): void {
    for (const { event, payload } of events) {
      (bus.emit as (e: string, p: unknown) => void)(event, payload);
    }
  }

  return {
    ingestPRs(prs: PR[]): void {
      // Phase 1: store all, determine which events to fire
      const deferred: EventEntry<'pr:discovered' | 'pr:enriched'>[] = [];

      for (const pr of prs) {
        const key = prKey(pr);
        const existing = stores.prs.get(key);

        // If new PR lacks enrichment but existing has it, preserve it
        const merged: PR = existing
          ? {
              ...pr,
              body: pr.body ?? existing.body,
              ci: pr.ci ?? existing.ci,
              review: pr.review ?? existing.review,
              mergeable: pr.mergeable ?? existing.mergeable,
            }
          : pr;
        stores.prs.set(merged);

        if (!existing) {
          deferred.push({ event: 'pr:discovered', payload: merged });
          continue;
        }

        // If the incoming PR carries fresh enrichment data, always emit pr:enriched
        // (fetchedAt changes on every fetch, so this captures "we verified it's current")
        if (pr.ci || pr.review || pr.mergeable) {
          deferred.push({ event: 'pr:enriched', payload: merged });
          continue;
        }

        // Check if basic (non-enrichment) fields changed
        if (hasChanged(existing, pr, PR_ENRICHMENT_KEYS)) {
          deferred.push({ event: 'pr:discovered', payload: merged });
        }
      }

      // Phase 2: emit events (all PRs in batch are now in the store)
      emitDeferred(deferred);
    },

    ingestLinearData(data): void {
      const deferred: EventEntry<'linear:issue:discovered' | 'linear:attachment:discovered'>[] = [];

      for (const issue of data.issues) {
        const existing = stores.linearIssues.get(linearKey(issue));
        stores.linearIssues.set(issue);

        if (!existing || hasChanged(existing, issue)) {
          deferred.push({ event: 'linear:issue:discovered', payload: issue });
        }
      }
      for (const attachment of data.attachments) {
        deferred.push({ event: 'linear:attachment:discovered', payload: attachment });
      }

      emitDeferred(deferred);
    },

    ingestBranches(branches: Branch[]): void {
      const deferred: EventEntry<'branch:discovered'>[] = [];

      for (const branch of branches) {
        const existing = stores.branches.get(branchKey(branch));
        stores.branches.set(branch);

        if (!existing || hasChanged(existing, branch)) {
          deferred.push({ event: 'branch:discovered', payload: branch });
        }
      }

      emitDeferred(deferred);
    },

    ingestCheckouts(checkouts: LocalCheckout[]): void {
      const deferred: EventEntry<'checkout:discovered'>[] = [];

      for (const checkout of checkouts) {
        const existing = stores.checkouts.get(checkoutKey(checkout));
        stores.checkouts.set(checkout);

        if (!existing || hasChanged(existing, checkout)) {
          deferred.push({ event: 'checkout:discovered', payload: checkout });
        }
      }

      emitDeferred(deferred);
    },
  };
}

function hasChanged(a: object, b: object, skipKeys?: Set<string>): boolean {
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const keysA = Object.keys(aRecord);
  const keysB = Object.keys(bRecord);
  if (keysA.length !== keysB.length) return true;
  for (const key of keysA) {
    if (skipKeys?.has(key)) continue;
    const valA = aRecord[key];
    const valB = bRecord[key];
    if (valA === valB) continue;
    // For objects, compare by value
    if (typeof valA === 'object' && typeof valB === 'object' && valA !== null && valB !== null) {
      if (JSON.stringify(valA) !== JSON.stringify(valB)) return true;
      continue;
    }
    return true;
  }
  return false;
}

// Fields on PR that are handled separately by the enrichment check
const PR_ENRICHMENT_KEYS = new Set(['ci', 'review', 'mergeable', 'body']);

import type { EventBus } from '../event-bus.js';
import type { DataEventMap } from '../events.js';
import type { LinearIssue } from '../entities.js';
import type { Ingester } from '../ingest.js';

interface LinearFetcherDeps {
  fetchIssuesByIdentifier: (identifiers: string[]) => Promise<LinearIssue[]>;
  batchDelayMs?: number;
}

export function createLinearFetcher(
  bus: EventBus<DataEventMap>,
  ingester: Ingester,
  deps: LinearFetcherDeps,
): () => void {
  const batchDelay = deps.batchDelayMs ?? 50;
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function flush(): Promise<void> {
    const identifiers = [...pending];
    pending.clear();
    timer = null;

    if (identifiers.length === 0) return;

    try {
      const issues = await deps.fetchIssuesByIdentifier(identifiers);
      if (issues.length > 0) {
        ingester.ingestLinearData({ issues, attachments: [] });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      bus.emit('error', { source: 'linear:issue:fetch', message });
    }
  }

  const unsub = bus.on('linear:issue:fetch', ({ identifier }) => {
    if (pending.has(identifier)) return;
    pending.add(identifier);

    if (!timer) {
      timer = setTimeout(flush, batchDelay);
    }
  });

  return () => {
    unsub();
    if (timer) clearTimeout(timer);
  };
}

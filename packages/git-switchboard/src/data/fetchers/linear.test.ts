import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDataLayer } from '../index.js';
import { createLinearFetcher } from './linear.js';
import type { LinearIssue } from '../entities.js';

describe('Linear Fetch Listener', () => {
  it('batches multiple linear:issue:fetch into one call', async () => {
    const layer = createDataLayer();
    const fetchedIds: string[][] = [];

    const cleanup = createLinearFetcher(layer.bus, layer.ingest, {
      fetchIssuesByIdentifier: async (identifiers) => {
        fetchedIds.push([...identifiers]);
        return identifiers.map((id) => ({
          id: `li-${id}`, identifier: id, title: `Issue ${id}`,
          status: 'In Progress', priority: 1, assignee: null,
          url: `https://linear.app/eng/${id}`, teamKey: id.split('-')[0],
        }));
      },
      batchDelayMs: 10,
    });

    layer.bus.emit('linear:issue:fetch', { identifier: 'ENG-1' });
    layer.bus.emit('linear:issue:fetch', { identifier: 'ENG-2' });
    layer.bus.emit('linear:issue:fetch', { identifier: 'ENG-3' });

    await new Promise((r) => setTimeout(r, 50));

    assert.equal(fetchedIds.length, 1);
    assert.deepEqual(fetchedIds[0].sort(), ['ENG-1', 'ENG-2', 'ENG-3']);

    // Issues should be in the store
    assert.equal(layer.stores.linearIssues.has('ENG-1'), true);
    assert.equal(layer.stores.linearIssues.has('ENG-2'), true);

    cleanup();
  });

  it('deduplicates same identifier in batch window', async () => {
    const layer = createDataLayer();
    let batchSize = 0;

    const cleanup = createLinearFetcher(layer.bus, layer.ingest, {
      fetchIssuesByIdentifier: async (identifiers) => {
        batchSize = identifiers.length;
        return identifiers.map((id) => ({
          id: `li-${id}`, identifier: id, title: `Issue ${id}`,
          status: 'Done', priority: 1, assignee: null,
          url: `https://linear.app/eng/${id}`, teamKey: 'ENG',
        }));
      },
      batchDelayMs: 10,
    });

    layer.bus.emit('linear:issue:fetch', { identifier: 'ENG-1' });
    layer.bus.emit('linear:issue:fetch', { identifier: 'ENG-1' });

    await new Promise((r) => setTimeout(r, 50));

    assert.equal(batchSize, 1);
    cleanup();
  });
});

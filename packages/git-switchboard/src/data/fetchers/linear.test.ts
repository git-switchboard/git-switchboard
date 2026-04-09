import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDataLayer } from '../index.js';
import { createLinearFetcher } from './linear.js';
import type { LinearIssue } from '../entities.js';
import type { DataEventMap } from '../events.js';

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

describe('Linear fetchAll listener', () => {
  it('linear:fetchAll triggers bulk fetch and ingests issues + attachments', async () => {
    const layer = createDataLayer();
    let fetchAllCalled = false;

    const cleanup = createLinearFetcher(layer.bus, layer.ingest, {
      fetchIssuesByIdentifier: async () => [],
      fetchAll: async () => {
        fetchAllCalled = true;
        return {
          issues: [
            {
              id: 'li-1', identifier: 'ENG-100', title: 'Auth flow',
              status: 'In Progress', priority: 1, assignee: 'Alice',
              url: 'https://linear.app/eng/ENG-100', teamKey: 'ENG',
            },
            {
              id: 'li-2', identifier: 'ENG-200', title: 'Dashboard',
              status: 'Todo', priority: 2, assignee: 'Alice',
              url: 'https://linear.app/eng/ENG-200', teamKey: 'ENG',
            },
          ],
          attachments: [
            { prUrl: 'https://github.com/acme/api/pull/5', issueIdentifier: 'ENG-100' },
          ],
        };
      },
    });

    layer.bus.emit('linear:fetchAll', {});

    await new Promise((r) => setTimeout(r, 50));

    assert.equal(fetchAllCalled, true);
    assert.equal(layer.stores.linearIssues.has('ENG-100'), true);
    assert.equal(layer.stores.linearIssues.has('ENG-200'), true);
    assert.equal(layer.stores.linearIssues.get('ENG-100')!.assignee, 'Alice');

    cleanup();
  });

  it('emits linear:issue:discovered for each fetched issue', async () => {
    const layer = createDataLayer();
    const discovered: string[] = [];
    layer.bus.on('linear:issue:discovered', (issue) => discovered.push(issue.identifier));

    const cleanup = createLinearFetcher(layer.bus, layer.ingest, {
      fetchIssuesByIdentifier: async () => [],
      fetchAll: async () => ({
        issues: [
          {
            id: 'li-1', identifier: 'PLAT-10', title: 'Infra',
            status: 'In Progress', priority: 1, assignee: null,
            url: 'https://linear.app/plat/PLAT-10', teamKey: 'PLAT',
          },
        ],
        attachments: [],
      }),
    });

    layer.bus.emit('linear:fetchAll', {});
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(discovered.length, 1);
    assert.equal(discovered[0], 'PLAT-10');

    cleanup();
  });

  it('emits error event when fetchAll fails', async () => {
    const layer = createDataLayer();
    const errors: DataEventMap['error'][] = [];
    layer.bus.on('error', (e) => errors.push(e));

    const cleanup = createLinearFetcher(layer.bus, layer.ingest, {
      fetchIssuesByIdentifier: async () => [],
      fetchAll: async () => { throw new Error('Linear API down'); },
    });

    layer.bus.emit('linear:fetchAll', {});
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(errors.length, 1);
    assert.equal(errors[0].source, 'linear:fetchAll');
    assert.match(errors[0].message, /Linear API down/);

    cleanup();
  });
});

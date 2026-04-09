import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDataLayer } from './index.js';
import { createPersistence } from './persistence.js';
import type { PR } from './entities.js';
import type { DataEventMap } from './events.js';

function makePR(overrides: Partial<PR> = {}): PR {
  return {
    nodeId: 'PR_1', number: 1, title: 'Test PR', state: 'OPEN',
    draft: false, repoOwner: 'acme', repoName: 'api', repoId: 'acme/api',
    forkRepoId: null, headRef: 'feat/ENG-123-auth',
    url: 'https://github.com/acme/api/pull/1',
    author: 'dev', role: 'author', updatedAt: '2026-04-08T00:00:00Z',
    ...overrides,
  };
}

describe('Persistence', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'gsb-test-'));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true });
  });

  it('persist() writes data, hydrate() restores it to a new layer', async () => {
    // Layer 1: ingest data, persist
    const layer1 = createDataLayer();
    const persistence1 = createPersistence(layer1.bus, layer1.stores, layer1.relations, cacheDir);

    layer1.ingest.ingestLinearData({
      issues: [{
        id: 'li1', identifier: 'ENG-123', title: 'Auth',
        status: 'In Progress', priority: 1, assignee: null,
        url: 'https://linear.app/eng/ENG-123', teamKey: 'ENG',
      }],
      attachments: [],
    });
    layer1.ingest.ingestPRs([makePR()]);
    await persistence1.persist();

    // Layer 2: hydrate from disk
    const layer2 = createDataLayer();
    layer2.destroy(); // Remove effects so we can test hydration in isolation
    const persistence2 = createPersistence(layer2.bus, layer2.stores, layer2.relations, cacheDir);
    await persistence2.hydrate();

    assert.equal(layer2.stores.prs.has('acme/api#1'), true);
    assert.equal(layer2.stores.linearIssues.has('ENG-123'), true);
  });

  it('hydration does NOT trigger fetch commands for existing entities', async () => {
    // Layer 1: build up relations between PR and Linear
    const layer1 = createDataLayer();
    const persistence1 = createPersistence(layer1.bus, layer1.stores, layer1.relations, cacheDir);

    layer1.ingest.ingestLinearData({
      issues: [{
        id: 'li1', identifier: 'ENG-123', title: 'Auth',
        status: 'Done', priority: 1, assignee: null,
        url: 'https://linear.app/eng/ENG-123', teamKey: 'ENG',
      }],
      attachments: [],
    });
    layer1.ingest.ingestPRs([makePR()]);
    await persistence1.persist();

    // Layer 2: hydrate with effects active
    const layer2 = createDataLayer();
    const fetches: DataEventMap['linear:issue:fetch'][] = [];
    layer2.bus.on('linear:issue:fetch', (p) => fetches.push(p));
    const persistence2 = createPersistence(layer2.bus, layer2.stores, layer2.relations, cacheDir);
    await persistence2.hydrate();

    // Both sides exist — no fetch should fire
    assert.equal(fetches.length, 0);
  });
});

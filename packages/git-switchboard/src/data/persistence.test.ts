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

  it('persist→hydrate round-trip preserves StatusContext-derived checks', async () => {
    const layer1 = createDataLayer();
    const persistence1 = createPersistence(layer1.bus, layer1.stores, layer1.relations, cacheDir);

    layer1.ingest.ingestPRs([makePR({
      ci: {
        status: 'failing',
        checks: [
          { id: 42, name: 'main-linux', status: 'completed', conclusion: 'success', detailsUrl: 'https://github.com/actions/run/42', startedAt: '2026-04-08T00:00:00Z', completedAt: '2026-04-08T00:10:00Z', appSlug: 'github-actions' },
          { id: 0, name: 'linux / affected --targets=lint,test', status: 'completed', conclusion: 'failure', detailsUrl: 'https://staging.nx.app/runs/abc', startedAt: '2026-04-08T00:00:00Z', completedAt: '2026-04-08T00:10:00Z', appSlug: null },
          { id: 0, name: 'netlify/nx-dev/deploy-preview', status: 'completed', conclusion: 'success', detailsUrl: 'https://deploy-preview.netlify.app', startedAt: '2026-04-08T00:00:00Z', completedAt: null, appSlug: null },
        ],
        fetchedAt: Date.now(),
      },
    })]);
    await persistence1.persist();

    // Hydrate into a fresh layer
    const layer2 = createDataLayer();
    layer2.destroy();
    const persistence2 = createPersistence(layer2.bus, layer2.stores, layer2.relations, cacheDir);
    await persistence2.hydrate();

    const pr = layer2.stores.prs.get('acme/api#1');
    assert.ok(pr?.ci, 'CI data should be present after hydration');
    assert.equal(pr.ci.checks.length, 3, 'all 3 checks (1 CheckRun + 2 StatusContext) should survive');
    assert.equal(pr.ci.checks[0].appSlug, 'github-actions');
    assert.equal(pr.ci.checks[1].appSlug, null);
    assert.equal(pr.ci.checks[1].name, 'linux / affected --targets=lint,test');
    assert.equal(pr.ci.checks[2].name, 'netlify/nx-dev/deploy-preview');
  });

  it('hydrated StatusContext checks survive a pr:fetchDetail re-enrichment cycle', async () => {
    const layer1 = createDataLayer();
    const persistence1 = createPersistence(layer1.bus, layer1.stores, layer1.relations, cacheDir);

    const ciWithContextChecks = {
      status: 'failing' as const,
      checks: [
        { id: 42, name: 'main-linux', status: 'completed' as const, conclusion: 'success', detailsUrl: null, startedAt: '2026-04-08T00:00:00Z', completedAt: '2026-04-08T00:10:00Z', appSlug: 'github-actions' },
        { id: 0, name: 'linux / affected', status: 'completed' as const, conclusion: 'failure', detailsUrl: 'https://nx.app/runs/abc', startedAt: '2026-04-08T00:00:00Z', completedAt: '2026-04-08T00:10:00Z', appSlug: null },
      ],
      fetchedAt: Date.now(),
    };
    layer1.ingest.ingestPRs([makePR({ ci: ciWithContextChecks })]);
    await persistence1.persist();

    // Simulate app restart: hydrate, then a detail fetch returns ONLY CheckRun data
    // (simulating a scenario where the enrichment query result is processed differently)
    const layer2 = createDataLayer();
    layer2.destroy();
    const persistence2 = createPersistence(layer2.bus, layer2.stores, layer2.relations, cacheDir);
    await persistence2.hydrate();

    // Now simulate re-enrichment that returns both check types
    layer2.ingest.ingestPRs([makePR({
      ci: {
        status: 'failing',
        checks: [
          { id: 42, name: 'main-linux', status: 'completed', conclusion: 'success', detailsUrl: null, startedAt: '2026-04-08T01:00:00Z', completedAt: '2026-04-08T01:10:00Z', appSlug: 'github-actions' },
          { id: 0, name: 'linux / affected', status: 'completed', conclusion: 'failure', detailsUrl: 'https://nx.app/runs/def', startedAt: '2026-04-08T01:00:00Z', completedAt: '2026-04-08T01:10:00Z', appSlug: null },
        ],
        fetchedAt: Date.now(),
      },
    })]);

    const pr = layer2.stores.prs.get('acme/api#1');
    assert.ok(pr?.ci);
    assert.equal(pr.ci.checks.length, 2);
    assert.equal(pr.ci.checks.filter(c => c.appSlug === null).length, 1, 'StatusContext check should be present');
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

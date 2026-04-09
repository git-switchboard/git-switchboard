import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDataLayer } from '../index.js';
import { createGithubFetcher } from './github.js';
import type { PR } from '../entities.js';
import type { DataEventMap } from '../events.js';
import type { CIInfo, ReviewInfo, MergeableStatus } from '../../types.js';

function makePR(overrides: Partial<PR> = {}): PR {
  return {
    nodeId: 'PR_1', number: 1, title: 'Test', state: 'OPEN',
    draft: false, repoOwner: 'acme', repoName: 'api', repoId: 'acme/api',
    forkRepoId: null, headRef: 'main',
    url: 'https://github.com/acme/api/pull/1',
    author: 'dev', role: 'author', updatedAt: '2026-04-08T00:00:00Z',
    ...overrides,
  };
}

describe('GitHub Fetch Listener', () => {
  it('pr:fetchDetail batches multiple requests', async () => {
    const layer = createDataLayer();
    const batchCalls: PR[][] = [];

    // Pre-populate PRs so the fetcher can find them
    layer.ingest.ingestPRs([
      makePR({ number: 1, nodeId: 'PR_1' }),
      makePR({ number: 2, nodeId: 'PR_2', url: 'https://github.com/acme/api/pull/2' }),
    ]);

    const cleanup = createGithubFetcher(layer.bus, layer.ingest, layer.stores, {
      fetchPRDetailsBatch: async (prs) => {
        batchCalls.push(prs);
        const result = new Map<string, { ci: CIInfo; review: ReviewInfo; mergeable: MergeableStatus }>();
        for (const pr of prs) {
          result.set(`${pr.repoId}#${pr.number}`, {
            ci: { status: 'passing', checks: [], fetchedAt: Date.now() },
            review: { status: 'approved', reviewers: [], fetchedAt: Date.now() },
            mergeable: 'MERGEABLE',
          });
        }
        return result;
      },
      batchDelayMs: 10,
    });

    // Emit two fetch commands rapidly
    layer.bus.emit('pr:fetchDetail', { repoId: 'acme/api', number: 1 });
    layer.bus.emit('pr:fetchDetail', { repoId: 'acme/api', number: 2 });

    // Wait for batch to process
    await new Promise((r) => setTimeout(r, 50));

    // Should have been batched into a single call
    assert.equal(batchCalls.length, 1);
    assert.equal(batchCalls[0].length, 2);

    // PR should now have CI data
    const pr = layer.stores.prs.get('acme/api#1');
    assert.equal(pr?.ci?.status, 'passing');

    cleanup();
  });

  it('deduplicates concurrent fetch requests for same PR', async () => {
    const layer = createDataLayer();
    let callCount = 0;

    layer.ingest.ingestPRs([makePR()]);

    const cleanup = createGithubFetcher(layer.bus, layer.ingest, layer.stores, {
      fetchPRDetailsBatch: async (prs) => {
        callCount++;
        const result = new Map();
        for (const pr of prs) {
          result.set(`${pr.repoId}#${pr.number}`, {
            ci: { status: 'passing', checks: [], fetchedAt: Date.now() },
            review: { status: 'approved', reviewers: [], fetchedAt: Date.now() },
            mergeable: 'MERGEABLE',
          });
        }
        return result;
      },
      batchDelayMs: 10,
    });

    // Same PR fetched multiple times
    layer.bus.emit('pr:fetchDetail', { repoId: 'acme/api', number: 1 });
    layer.bus.emit('pr:fetchDetail', { repoId: 'acme/api', number: 1 });
    layer.bus.emit('pr:fetchDetail', { repoId: 'acme/api', number: 1 });

    await new Promise((r) => setTimeout(r, 50));

    assert.equal(callCount, 1);
    cleanup();
  });
});

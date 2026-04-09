import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDataLayer } from './index.js';
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

describe('DataLayer integration', () => {
  it('ingesting a PR with a Linear pattern in headRef creates prToLinear relation', () => {
    const layer = createDataLayer();

    layer.ingest.ingestPRs([makePR()]);

    const issues = layer.query.linearIssuesForPr('acme/api#1');
    // Issue not in store yet, but relation exists
    assert.equal(layer.relations.prToLinear.has('acme/api#1', 'ENG-123'), true);
  });

  it('relation:created for missing Linear issue triggers linear:issue:fetch', () => {
    const layer = createDataLayer();
    const fetches: DataEventMap['linear:issue:fetch'][] = [];
    layer.bus.on('linear:issue:fetch', (p) => fetches.push(p));

    layer.ingest.ingestPRs([makePR()]);

    assert.equal(fetches.length, 1);
    assert.deepEqual(fetches[0], { identifier: 'ENG-123' });
  });

  it('no fetch emitted when Linear issue already in store', () => {
    const layer = createDataLayer();
    const fetches: DataEventMap['linear:issue:fetch'][] = [];

    // Pre-populate Linear issue
    layer.ingest.ingestLinearData({
      issues: [{
        id: 'li1', identifier: 'ENG-123', title: 'Auth',
        status: 'In Progress', priority: 1, assignee: null,
        url: 'https://linear.app/eng/ENG-123', teamKey: 'ENG',
      }],
      attachments: [],
    });

    layer.bus.on('linear:issue:fetch', (p) => fetches.push(p));
    layer.ingest.ingestPRs([makePR()]);

    assert.equal(fetches.length, 0);
  });

  it('query resolves across entity stores and relations', () => {
    const layer = createDataLayer();

    layer.ingest.ingestLinearData({
      issues: [{
        id: 'li1', identifier: 'ENG-123', title: 'Auth',
        status: 'In Progress', priority: 1, assignee: null,
        url: 'https://linear.app/eng/ENG-123', teamKey: 'ENG',
      }],
      attachments: [],
    });
    layer.ingest.ingestPRs([makePR()]);

    const issues = layer.query.linearIssuesForPr('acme/api#1');
    assert.equal(issues.length, 1);
    assert.equal(issues[0].identifier, 'ENG-123');
  });

  it('destroy() stops all effects', () => {
    const layer = createDataLayer();
    const fetches: DataEventMap['linear:issue:fetch'][] = [];
    layer.bus.on('linear:issue:fetch', (p) => fetches.push(p));

    layer.destroy();
    layer.ingest.ingestPRs([makePR()]);

    // Effects are unregistered — no fetch emitted
    // (relation still won't be created because discovery effects are gone)
    assert.equal(fetches.length, 0);
  });
});

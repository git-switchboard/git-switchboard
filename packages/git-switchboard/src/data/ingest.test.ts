import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEventBus } from './event-bus.js';
import { createEntityStore } from './entity-store.js';
import { createIngester } from './ingest.js';
import { prKey, linearKey, branchKey, checkoutKey } from './entities.js';
import type { PR, LinearIssue, Branch, LocalCheckout } from './entities.js';
import type { DataEventMap } from './events.js';

function makePR(overrides: Partial<PR> = {}): PR {
  return {
    nodeId: 'PR_1', number: 1, title: 'Test PR', state: 'OPEN',
    draft: false, repoOwner: 'acme', repoName: 'api', repoId: 'acme/api',
    forkRepoId: null, headRef: 'feat/ENG-123-auth', url: 'https://github.com/acme/api/pull/1',
    author: 'dev', role: 'author', updatedAt: '2026-04-08T00:00:00Z',
    ...overrides,
  };
}

function makeLinearIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: 'li1', identifier: 'ENG-123', title: 'Auth feature',
    status: 'In Progress', priority: 1, assignee: null,
    url: 'https://linear.app/eng/ENG-123', teamKey: 'ENG',
    ...overrides,
  };
}

function makeBranch(overrides: Partial<Branch> = {}): Branch {
  return {
    name: 'feat/ENG-123-auth', isRemote: false, isCurrent: false,
    ...overrides,
  };
}

function makeCheckout(overrides: Partial<LocalCheckout> = {}): LocalCheckout {
  return {
    path: '/Users/me/repos/api', remoteUrl: 'git@github.com:acme/api.git',
    repoId: 'acme/api', currentBranch: 'main', isWorktree: false,
    parentCheckoutKey: null,
    ...overrides,
  };
}

function createTestIngester() {
  const bus = createEventBus<DataEventMap>();
  const stores = {
    prs: createEntityStore<PR>(prKey),
    linearIssues: createEntityStore<LinearIssue>(linearKey),
    branches: createEntityStore<Branch>(branchKey),
    checkouts: createEntityStore<LocalCheckout>(checkoutKey),
  };
  const ingester = createIngester(bus, stores);
  return { bus, stores, ingester };
}

describe('Ingester', () => {
  describe('ingestPRs', () => {
    it('stores PRs and emits pr:discovered for each', () => {
      const { bus, stores, ingester } = createTestIngester();
      const discovered: PR[] = [];
      bus.on('pr:discovered', (pr) => discovered.push(pr));

      const pr = makePR();
      ingester.ingestPRs([pr]);

      assert.deepEqual(stores.prs.get('acme/api#1'), pr);
      assert.equal(discovered.length, 1);
    });

    it('skips emit for unchanged PR on re-ingest', () => {
      const { bus, stores, ingester } = createTestIngester();
      const discovered: PR[] = [];

      const pr = makePR();
      ingester.ingestPRs([pr]);
      bus.on('pr:discovered', (p) => discovered.push(p));
      ingester.ingestPRs([pr]);

      assert.equal(discovered.length, 0);
    });

    it('re-emits when PR has changed', () => {
      const { bus, stores, ingester } = createTestIngester();
      const discovered: PR[] = [];

      ingester.ingestPRs([makePR()]);
      bus.on('pr:discovered', (p) => discovered.push(p));
      ingester.ingestPRs([makePR({ title: 'Updated title' })]);

      assert.equal(discovered.length, 1);
      assert.equal(stores.prs.get('acme/api#1')?.title, 'Updated title');
    });
  });

  describe('ingestPRs with enrichment', () => {
    it('emits pr:enriched when CI/review/mergeable data is added', () => {
      const { bus, stores, ingester } = createTestIngester();
      const enriched: PR[] = [];
      bus.on('pr:enriched', (pr) => enriched.push(pr));

      ingester.ingestPRs([makePR()]);
      ingester.ingestPRs([makePR({
        ci: { status: 'passing', checks: [], fetchedAt: Date.now() },
      })]);

      assert.equal(enriched.length, 1);
    });

    it('re-emits pr:enriched on re-ingest with same enrichment data (fetchedAt differs)', () => {
      const { bus, ingester } = createTestIngester();
      const enriched: PR[] = [];

      ingester.ingestPRs([makePR({
        ci: { status: 'passing', checks: [], fetchedAt: 1000 },
      })]);
      bus.on('pr:enriched', (pr) => enriched.push(pr));
      ingester.ingestPRs([makePR({
        ci: { status: 'passing', checks: [], fetchedAt: 2000 },
      })]);

      assert.equal(enriched.length, 1);
    });

    it('preserves existing enrichment when re-ingested without it', () => {
      const { stores, ingester } = createTestIngester();
      const ci = { status: 'passing' as const, checks: [], fetchedAt: Date.now() };

      ingester.ingestPRs([makePR({ ci })]);
      ingester.ingestPRs([makePR({ title: 'Updated' })]);

      const stored = stores.prs.get('acme/api#1');
      assert.equal(stored?.ci?.status, 'passing');
      assert.equal(stored?.title, 'Updated');
    });
  });

  describe('ingestLinearData', () => {
    it('stores issues and emits linear:issue:discovered', () => {
      const { bus, stores, ingester } = createTestIngester();
      const discovered: LinearIssue[] = [];
      bus.on('linear:issue:discovered', (issue) => discovered.push(issue));

      ingester.ingestLinearData({
        issues: [makeLinearIssue()],
        attachments: [],
      });

      assert.equal(stores.linearIssues.has('ENG-123'), true);
      assert.equal(discovered.length, 1);
    });

    it('emits linear:attachment:discovered for each attachment', () => {
      const { bus, ingester } = createTestIngester();
      const attachments: DataEventMap['linear:attachment:discovered'][] = [];
      bus.on('linear:attachment:discovered', (a) => attachments.push(a));

      ingester.ingestLinearData({
        issues: [],
        attachments: [{ prUrl: 'https://github.com/acme/api/pull/1', issueIdentifier: 'ENG-123' }],
      });

      assert.equal(attachments.length, 1);
      assert.deepEqual(attachments[0], {
        prUrl: 'https://github.com/acme/api/pull/1',
        issueIdentifier: 'ENG-123',
      });
    });
  });

  describe('ingestBranches', () => {
    it('stores branches and emits branch:discovered', () => {
      const { bus, stores, ingester } = createTestIngester();
      const discovered: Branch[] = [];
      bus.on('branch:discovered', (b) => discovered.push(b));

      ingester.ingestBranches([makeBranch()]);

      assert.equal(stores.branches.has('feat/ENG-123-auth'), true);
      assert.equal(discovered.length, 1);
    });
  });

  describe('ingestCheckouts', () => {
    it('stores checkouts and emits checkout:discovered', () => {
      const { bus, stores, ingester } = createTestIngester();
      const discovered: LocalCheckout[] = [];
      bus.on('checkout:discovered', (c) => discovered.push(c));

      ingester.ingestCheckouts([makeCheckout()]);

      assert.equal(stores.checkouts.has('/Users/me/repos/api'), true);
      assert.equal(discovered.length, 1);
    });
  });

  describe('batch two-phase behavior', () => {
    it('all PRs in batch are in store before any discovery event fires', () => {
      const { bus, stores, ingester } = createTestIngester();
      let storeCountDuringFirstEvent: number | null = null;

      bus.on('pr:discovered', () => {
        if (storeCountDuringFirstEvent === null) {
          storeCountDuringFirstEvent = stores.prs.getAll().length;
        }
      });

      ingester.ingestPRs([
        makePR({ number: 1 }),
        makePR({ number: 2, nodeId: 'PR_2', url: 'https://github.com/acme/api/pull/2' }),
        makePR({ number: 3, nodeId: 'PR_3', url: 'https://github.com/acme/api/pull/3' }),
      ]);

      // When the first event fires, all 3 should already be in the store
      assert.equal(storeCountDuringFirstEvent, 3);
    });
  });
});

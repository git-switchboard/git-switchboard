import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPrStore } from './store.js';
import { createDataLayer } from './data/index.js';
import type { PR } from './data/index.js';
import type {
  CIInfo,
  UserPullRequest,
} from './types.js';

function createPR(overrides: Partial<PR> = {}): PR {
  return {
    nodeId: 'PR_test_123',
    number: 123,
    title: 'Keep existing PRs on refresh failure',
    state: 'OPEN',
    draft: false,
    repoOwner: 'acme',
    repoName: 'widgets',
    repoId: 'acme/widgets',
    forkRepoId: null,
    headRef: 'fix/refresh-state',
    updatedAt: '2026-04-02T16:00:00Z',
    url: 'https://github.com/acme/widgets/pull/123',
    author: 'octocat',
    role: 'author',
    ...overrides,
  };
}

function createCIInfo(overrides: Partial<CIInfo> = {}): CIInfo {
  return {
    status: 'passing',
    checks: [],
    fetchedAt: Date.now(),
    ...overrides,
  };
}

function createStoreWithDataLayer(prs: PR[] = []) {
  const dataLayer = createDataLayer();
  if (prs.length > 0) {
    dataLayer.ingest.ingestPRs(prs);
  }
  const store = createPrStore({
    dataLayer,
    localRepos: [],
    repoScanDone: true,
    repoMode: null,
    token: 'test-token',
    copyToClipboard: async () => true,
    onDone: () => {},
    openEditorForPR: async () => 'ok',
    waitForLocalRepos: async () => [],
    editor: null,
    installedEditors: [],
  });
  return { store, dataLayer };
}

describe('PrStore with DataLayer', () => {
  it('initializes prs from DataLayer snapshot', () => {
    const pr = createPR();
    const { store } = createStoreWithDataLayer([pr]);

    const state = store.getState();
    assert.equal(state.prs.length, 1);
    assert.equal(state.prs[0].number, 123);
  });

  it('updates prs when DataLayer ingests new PRs', () => {
    const { store, dataLayer } = createStoreWithDataLayer();

    assert.equal(store.getState().prs.length, 0);

    dataLayer.ingest.ingestPRs([createPR()]);

    assert.equal(store.getState().prs.length, 1);
  });

  it('updates prs when PR is enriched via DataLayer', () => {
    const pr = createPR();
    const { store, dataLayer } = createStoreWithDataLayer([pr]);

    assert.equal(store.getState().prs[0].ci, undefined);

    const ci = createCIInfo();
    dataLayer.ingest.ingestPRs([{ ...pr, ci }]);

    assert.equal(store.getState().prs[0].ci?.status, 'passing');
  });

  it('refreshAllPRs preserves existing data on failure', async () => {
    const pr = createPR();
    const { dataLayer } = createStoreWithDataLayer([pr]);

    const storeInstance = createPrStore(
      {
        dataLayer,
        localRepos: [],
        repoScanDone: true,
        repoMode: null,
        token: 'test-token',
        copyToClipboard: async () => true,
        onDone: () => {},
        openEditorForPR: async () => 'ok',
        waitForLocalRepos: async () => [],
        editor: null,
        installedEditors: [],
      },
      {
        fetchUserPRs: async () => {
          throw new Error('network blew up');
        },
      }
    );

    await storeInstance.getState().refreshAllPRs();

    const state = storeInstance.getState();
    assert.equal(state.refreshing, false);
    // PRs still in DataLayer — store snapshot preserved
    assert.equal(state.prs.length, 1);
  });

  it('prefetchDetails emits pr:fetchDetail events on DataLayer bus', () => {
    const pr = createPR();
    const { store, dataLayer } = createStoreWithDataLayer([pr]);

    const fetches: { repoId: string; number: number }[] = [];
    dataLayer.bus.on('pr:fetchDetail', (p) => fetches.push(p));

    store.getState().prefetchDetails([pr as UserPullRequest]);

    assert.equal(fetches.length, 1);
    assert.deepEqual(fetches[0], { repoId: 'acme/widgets', number: 123 });
  });

  it('destroy cleans up event subscriptions', () => {
    const { store, dataLayer } = createStoreWithDataLayer();

    store.getState().destroy();

    // After destroy, ingesting shouldn't update the store
    const prsBefore = store.getState().prs.length;
    dataLayer.ingest.ingestPRs([createPR()]);
    assert.equal(store.getState().prs.length, prsBefore);
  });
});

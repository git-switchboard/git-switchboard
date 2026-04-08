import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrStore } from './store.js';
import type {
  CIInfo,
  MergeableStatus,
  ReviewInfo,
  UserPullRequest,
} from './types.js';

function createPR(overrides: Partial<UserPullRequest> = {}): UserPullRequest {
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

function createReviewInfo(overrides: Partial<ReviewInfo> = {}): ReviewInfo {
  return {
    status: 'approved',
    reviewers: [],
    fetchedAt: Date.now(),
    ...overrides,
  };
}

function createStoreInitialState(prs: UserPullRequest[]) {
  return {
    prs,
    localRepos: [],
    repoScanDone: true,
    ciCache: new Map<string, CIInfo>(),
    reviewCache: new Map<string, ReviewInfo>(),
    mergeableCache: new Map<string, MergeableStatus>(),
    linearCache: new Map<string, import('./types.js').LinearIssue>(),
    repoMode: null,
    token: 'test-token',
    copyToClipboard: async () => true,
    onDone: () => {},
    openEditorForPR: async () => 'ok',
    waitForLocalRepos: async () => [],
    editor: null,
    installedEditors: [],
  };
}

test('refreshAllPRs preserves the existing list when refresh fails', async () => {
  const existingPR = createPR();
  const prKey = `${existingPR.repoId}#${existingPR.number}`;
  const existingCI = createCIInfo();
  const existingReview = createReviewInfo();
  const existingMergeable: MergeableStatus = 'MERGEABLE';

  const store = createPrStore(
    {
      ...createStoreInitialState([existingPR]),
      ciCache: new Map([[prKey, existingCI]]),
      reviewCache: new Map([[prKey, existingReview]]),
      mergeableCache: new Map([[prKey, existingMergeable]]),
    },
    {
      fetchUserPRs: async () => {
        throw new Error('network blew up');
      },
    }
  );

  await store.getState().refreshAllPRs();

  const state = store.getState();
  assert.equal(state.refreshing, false);
  assert.deepEqual(state.prs, [existingPR]);
  assert.deepEqual(state.ciCache, { [prKey]: existingCI });
  assert.deepEqual(state.reviewCache, { [prKey]: existingReview });
  assert.deepEqual(state.mergeableCache, { [prKey]: existingMergeable });
});

test('refreshAllPRs keeps existing enrichment when the refreshed PR list has no details yet', async () => {
  const existingPR = createPR();
  const prKey = `${existingPR.repoId}#${existingPR.number}`;
  const existingCI = createCIInfo();
  const existingReview = createReviewInfo();
  const existingMergeable: MergeableStatus = 'MERGEABLE';

  const store = createPrStore(
    {
      ...createStoreInitialState([existingPR]),
      ciCache: new Map([[prKey, existingCI]]),
      reviewCache: new Map([[prKey, existingReview]]),
      mergeableCache: new Map([[prKey, existingMergeable]]),
    },
    {
      fetchUserPRs: async () => ({
        prs: [existingPR],
        ciCache: new Map(),
        reviewCache: new Map(),
        mergeableCache: new Map(),
      }),
    }
  );

  await store.getState().refreshAllPRs();

  const state = store.getState();
  assert.deepEqual(state.prs, [existingPR]);
  assert.deepEqual(state.ciCache, { [prKey]: existingCI });
  assert.deepEqual(state.reviewCache, { [prKey]: existingReview });
  assert.deepEqual(state.mergeableCache, { [prKey]: existingMergeable });
});

test('refreshPRs only refreshes the requested PR subset', async () => {
  const firstPR = createPR();
  const secondPR = createPR({
    nodeId: 'PR_test_456',
    number: 456,
    title: 'Leave this PR alone',
    headRef: 'feature/untouched',
    url: 'https://github.com/acme/widgets/pull/456',
  });
  const firstKey = `${firstPR.repoId}#${firstPR.number}`;
  const secondKey = `${secondPR.repoId}#${secondPR.number}`;

  const firstCI = createCIInfo({ status: 'pending' });
  const firstReview = createReviewInfo({ status: 'needs-review' });
  const secondCI = createCIInfo({ status: 'passing' });
  const secondReview = createReviewInfo({ status: 'approved' });

  const refreshedCI = createCIInfo({ status: 'failing' });
  const refreshedReview = createReviewInfo({ status: 'changes-requested' });
  const refreshedMergeable: MergeableStatus = 'CONFLICTING';
  const untouchedMergeable: MergeableStatus = 'MERGEABLE';
  let batchCalls = 0;
  let receivedPRs: UserPullRequest[] = [];
  let persistedToken: string | undefined;
  let persistedCiCache: Map<string, CIInfo> | undefined;

  const store = createPrStore(
    {
      ...createStoreInitialState([firstPR, secondPR]),
      ciCache: new Map([
        [firstKey, firstCI],
        [secondKey, secondCI],
      ]),
      reviewCache: new Map([
        [firstKey, firstReview],
        [secondKey, secondReview],
      ]),
      mergeableCache: new Map([
        [firstKey, 'UNKNOWN'],
        [secondKey, untouchedMergeable],
      ]),
    },
    {
      fetchPRDetailsBatch: async (token, prs) => {
        batchCalls += 1;
        assert.equal(token, 'test-token');
        receivedPRs = [...prs];
        return new Map([
          [
            firstKey,
            {
              ci: refreshedCI,
              review: refreshedReview,
              mergeable: refreshedMergeable,
            },
          ],
        ]);
      },
      persistPRCache: (token, result) => {
        persistedToken = token;
        persistedCiCache = result.ciCache;
      },
    }
  );

  await store.getState().refreshPRs([firstPR]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const state = store.getState();
  assert.equal(batchCalls, 1);
  assert.deepEqual(receivedPRs, [firstPR]);
  assert.equal(persistedToken, 'test-token');
  assert.deepEqual(persistedCiCache, new Map([
    [firstKey, refreshedCI],
    [secondKey, secondCI],
  ]));
  assert.equal(state.refreshing, false);
  assert.deepEqual(state.ciCache, {
    [firstKey]: refreshedCI,
    [secondKey]: secondCI,
  });
  assert.deepEqual(state.reviewCache, {
    [firstKey]: refreshedReview,
    [secondKey]: secondReview,
  });
  assert.deepEqual(state.mergeableCache, {
    [firstKey]: refreshedMergeable,
    [secondKey]: untouchedMergeable,
  });
});

test('prefetchDetailsForPRs deduplicates in-flight deferred enrichment', async () => {
  const existingPR = createPR();
  const prKey = `${existingPR.repoId}#${existingPR.number}`;
  const fetchedCI = createCIInfo({ status: 'pending' });
  const fetchedReview = createReviewInfo({ status: 'changes-requested' });
  const fetchedMergeable: MergeableStatus = 'CONFLICTING';

  let fetchCalls = 0;
  let resolveFetch:
    | ((value: {
        ci: CIInfo;
        review: ReviewInfo;
        mergeable: MergeableStatus;
      }) => void)
    | null = null;
  const fetchPromise = new Promise<{
    ci: CIInfo;
    review: ReviewInfo;
    mergeable: MergeableStatus;
  }>((resolve) => {
    resolveFetch = resolve;
  });

  const store = createPrStore(
    {
      ...createStoreInitialState([existingPR]),
    },
    {
      fetchPRDetailsBatch: async () => {
        fetchCalls += 1;
        return new Map([[prKey, await fetchPromise]]);
      },
    }
  );

  store.getState().prefetchDetailsForPRs([existingPR]);
  store.getState().prefetchDetailsForPRs([existingPR]);

  assert.equal(fetchCalls, 1);

  resolveFetch?.({
    ci: fetchedCI,
    review: fetchedReview,
    mergeable: fetchedMergeable,
  });
  await fetchPromise;
  await new Promise((resolve) => setTimeout(resolve, 0));

  const state = store.getState();
  assert.deepEqual(state.ciCache, { [prKey]: fetchedCI });
  assert.deepEqual(state.reviewCache, { [prKey]: fetchedReview });
  assert.deepEqual(state.mergeableCache, { [prKey]: fetchedMergeable });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeCachedPRData } from './github.js';
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
    title: 'Preserve stale detail data',
    state: 'OPEN',
    draft: false,
    repoOwner: 'nrwl',
    repoName: 'nx',
    repoId: 'nrwl/nx',
    forkRepoId: null,
    headRef: 'feature/cache',
    updatedAt: '2026-04-03T12:00:00Z',
    url: 'https://github.com/nrwl/nx/pull/123',
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

test('mergeCachedPRData preserves cached detail data for PRs still in the list', () => {
  const activePR = createPR();
  const droppedPR = createPR({
    nodeId: 'PR_test_999',
    number: 999,
    title: 'Dropped PR',
    headRef: 'feature/dropped',
    url: 'https://github.com/nrwl/nx/pull/999',
  });
  const activeKey = `${activePR.repoId}#${activePR.number}`;
  const droppedKey = `${droppedPR.repoId}#${droppedPR.number}`;

  const staleCI = createCIInfo({ status: 'failing' });
  const staleReview = createReviewInfo({ status: 'changes-requested' });
  const staleMergeable: MergeableStatus = 'CONFLICTING';

  const merged = mergeCachedPRData(
    {
      prs: [activePR],
      ciCache: new Map(),
      reviewCache: new Map(),
      mergeableCache: new Map(),
    },
    {
      prs: [activePR, droppedPR],
      ciCache: new Map([
        [activeKey, staleCI],
        [droppedKey, createCIInfo({ status: 'pending' })],
      ]),
      reviewCache: new Map([
        [activeKey, staleReview],
        [droppedKey, createReviewInfo({ status: 'needs-review' })],
      ]),
      mergeableCache: new Map([
        [activeKey, staleMergeable],
        [droppedKey, 'UNKNOWN'],
      ]),
    }
  );

  assert.deepEqual(merged.prs, [activePR]);
  assert.deepEqual([...merged.ciCache.entries()], [[activeKey, staleCI]]);
  assert.deepEqual([...merged.reviewCache.entries()], [[activeKey, staleReview]]);
  assert.deepEqual(
    [...merged.mergeableCache.entries()],
    [[activeKey, staleMergeable]]
  );
});

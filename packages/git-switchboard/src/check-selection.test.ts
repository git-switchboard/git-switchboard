import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectRelevantCheckRuns,
  type CheckRunCandidate,
} from './check-selection.js';

function createCandidate(
  overrides: Partial<CheckRunCandidate>
): CheckRunCandidate {
  return {
    id: 1,
    name: 'Validate PR Title',
    status: 'completed',
    conclusion: 'success',
    detailsUrl: 'https://example.com/run',
    startedAt: '2026-04-02T16:00:00Z',
    completedAt: '2026-04-02T16:01:00Z',
    appSlug: 'github-actions',
    suiteId: 100,
    suiteCreatedAt: '2026-04-02T16:00:00Z',
    workflowRunId: 200,
    workflowRunNumber: 10,
    workflowRunCreatedAt: '2026-04-02T16:00:00Z',
    workflowName: 'PR Title Validation',
    matchingPullRequestNumbers: [],
    ...overrides,
  };
}

test('prefers the newer workflow run over a later rerun of an older run', () => {
  const staleFailedRerun = createCandidate({
    id: 69757970131,
    conclusion: 'failure',
    detailsUrl:
      'https://github.com/nrwl/nx/actions/runs/23910394097/job/69757970131',
    suiteId: 63114041206,
    suiteCreatedAt: '2026-04-02T16:18:43Z',
    workflowRunId: 23910394097,
    workflowRunNumber: 9174,
    workflowRunCreatedAt: '2026-04-02T16:18:43Z',
    startedAt: '2026-04-02T19:33:44Z',
    completedAt: '2026-04-02T19:34:00Z',
  });
  const newerPassingRun = createCandidate({
    id: 69735037301,
    conclusion: 'success',
    detailsUrl:
      'https://github.com/nrwl/nx/actions/runs/23911332938/job/69735037301',
    suiteId: 63117012485,
    suiteCreatedAt: '2026-04-02T16:41:13Z',
    workflowRunId: 23911332938,
    workflowRunNumber: 9178,
    workflowRunCreatedAt: '2026-04-02T16:41:13Z',
    startedAt: '2026-04-02T16:49:50Z',
    completedAt: '2026-04-02T16:50:11Z',
  });

  const selected = selectRelevantCheckRuns(
    [staleFailedRerun, newerPassingRun],
    33717
  );

  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, 69735037301);
  assert.equal(selected[0].conclusion, 'success');
});

test('keeps same-named jobs from different workflows separate', () => {
  const buildA = createCandidate({
    id: 10,
    name: 'build',
    workflowName: 'Main CI',
    workflowRunNumber: 50,
  });
  const buildB = createCandidate({
    id: 20,
    name: 'build',
    workflowName: 'Nightly',
    workflowRunNumber: 51,
  });

  const selected = selectRelevantCheckRuns([buildA, buildB], 33717);

  assert.equal(selected.length, 2);
  assert.deepEqual(
    selected.map((check) => check.id).sort((a, b) => a - b),
    [10, 20]
  );
});

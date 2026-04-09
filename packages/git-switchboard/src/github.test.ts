import assert from 'node:assert/strict';
import test from 'node:test';
import { extractChecksFromStatusContextNodes } from './github.js';

test('extractChecksFromStatusContextNodes handles both CheckRun and StatusContext nodes', () => {
  // Simulate the exact shape GitHub GraphQL API returns
  const contextNodes = [
    // CheckRun node
    {
      __typename: 'CheckRun',
      databaseId: 70540554133,
      name: 'main-linux',
      status: 'COMPLETED',
      conclusion: 'FAILURE',
      detailsUrl: 'https://github.com/nrwl/nx/actions/runs/24170345810/job/70540554133',
      startedAt: '2026-04-09T03:14:00Z',
      completedAt: '2026-04-09T04:06:26Z',
      checkSuite: {
        databaseId: 63774308853,
        createdAt: '2026-04-09T03:13:45Z',
        app: { slug: 'github-actions' },
        matchingPullRequests: { nodes: [{ number: 35227 }] },
        workflowRun: {
          databaseId: 24170345810,
          runNumber: 9362,
          createdAt: '2026-04-09T03:13:45Z',
          workflow: { name: 'CI' },
        },
      },
    },
    // StatusContext node (Nx Cloud)
    {
      __typename: 'StatusContext',
      context: 'linux / affected --targets=lint,test,build',
      state: 'FAILURE',
      description: 'Run failed. See logs and more details at Nx Cloud',
      targetUrl: 'https://staging.nx.app/runs/bOdBW3u4dF',
      createdAt: '2026-04-09T04:21:32Z',
    },
    // StatusContext node (Netlify)
    {
      __typename: 'StatusContext',
      context: 'netlify/nx-dev/deploy-preview',
      state: 'SUCCESS',
      description: 'Deploy Preview ready!',
      targetUrl: 'https://deploy-preview-35227--nx-dev.netlify.app',
      createdAt: '2026-04-09T03:16:55Z',
    },
  ] as const;

  const checks = extractChecksFromStatusContextNodes(contextNodes as any, 35227);

  assert.equal(checks.length, 3, `Expected 3 checks, got ${checks.length}: ${checks.map(c => c.name).join(', ')}`);

  const checkRun = checks.find(c => c.name === 'main-linux');
  assert.ok(checkRun);
  assert.equal(checkRun.appSlug, 'github-actions');
  assert.equal(checkRun.conclusion, 'failure');
  assert.equal(checkRun.id, 70540554133);

  const nxCloud = checks.find(c => c.name === 'linux / affected --targets=lint,test,build');
  assert.ok(nxCloud, 'StatusContext check from Nx Cloud should be present');
  assert.equal(nxCloud.appSlug, null);
  assert.equal(nxCloud.conclusion, 'failure');
  assert.equal(nxCloud.detailsUrl, 'https://staging.nx.app/runs/bOdBW3u4dF');

  const netlify = checks.find(c => c.name === 'netlify/nx-dev/deploy-preview');
  assert.ok(netlify, 'StatusContext check from Netlify should be present');
  assert.equal(netlify.conclusion, 'success');
});

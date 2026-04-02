/**
 * Generates captured frames of the TUI views for use in the docs site.
 *
 * Run with: bun run packages/git-switchboard/scripts/generate-demo-frame.tsx
 * Outputs JSON to stdout.
 */
import { testRender } from '@opentui/react/test-utils';
import { App } from '../src/app.js';
import { PrApp } from '../src/pr-app.js';
import type {
  BranchWithPR,
  CIInfo,
  ReviewInfo,
  UserPullRequest,
} from '../src/types.js';

// ── Mock data: Branch Picker ──

const MOCK_BRANCHES: BranchWithPR[] = [
  {
    name: 'feat/add-pr-dashboard',
    author: 'craigory',
    date: new Date('2025-03-28'),
    isRemote: false,
    isCurrent: false,
    trackingBranch: 'origin/feat/add-pr-dashboard',
    relativeDate: '3d ago',
    pr: { number: 42, title: 'Add PR dashboard', state: 'open', draft: false },
  },
  {
    name: 'fix/auth-token-refresh',
    author: 'craigory',
    date: new Date('2025-03-29'),
    isRemote: false,
    isCurrent: false,
    relativeDate: '2d ago',
    pr: {
      number: 38,
      title: 'Fix auth token refresh',
      state: 'open',
      draft: false,
    },
  },
  {
    name: 'main',
    author: 'craigory',
    date: new Date('2025-03-30'),
    isRemote: false,
    isCurrent: true,
    trackingBranch: 'origin/main',
    relativeDate: '1d ago',
  },
  {
    name: 'chore/update-deps',
    author: 'dependabot',
    date: new Date('2025-03-27'),
    isRemote: false,
    isCurrent: false,
    relativeDate: '4d ago',
    pr: {
      number: 45,
      title: 'Update dependencies',
      state: 'open',
      draft: true,
    },
  },
  {
    name: 'feat/branch-filters',
    author: 'craigory',
    date: new Date('2025-03-25'),
    isRemote: false,
    isCurrent: false,
    relativeDate: '6d ago',
  },
  {
    name: 'fix/unicode-rendering',
    author: 'alex',
    date: new Date('2025-03-26'),
    isRemote: false,
    isCurrent: false,
    relativeDate: '5d ago',
    pr: {
      number: 47,
      title: 'Fix unicode rendering in table',
      state: 'open',
      draft: false,
    },
  },
];

// ── Mock data: PR Dashboard ──

const NOW = new Date();

const MOCK_PRS: UserPullRequest[] = [
  {
    number: 42,
    title: 'Add interactive PR dashboard with CI status',
    state: 'open',
    draft: false,
    repoOwner: 'git-switchboard',
    repoName: 'git-switchboard',
    repoId: 'git-switchboard/git-switchboard',
    forkRepoId: null,
    headRef: 'feat/add-pr-dashboard',
    updatedAt: new Date(NOW.getTime() - 2 * 3600_000).toISOString(),
    url: '',
  },
  {
    number: 127,
    title: 'Refactor auth middleware for OAuth2 flow',
    state: 'open',
    draft: false,
    repoOwner: 'acme',
    repoName: 'backend-api',
    repoId: 'acme/backend-api',
    forkRepoId: null,
    headRef: 'refactor/auth-middleware',
    updatedAt: new Date(NOW.getTime() - 5 * 3600_000).toISOString(),
    url: '',
  },
  {
    number: 89,
    title: 'Add branch filter by author name',
    state: 'open',
    draft: false,
    repoOwner: 'git-switchboard',
    repoName: 'git-switchboard',
    repoId: 'git-switchboard/git-switchboard',
    forkRepoId: null,
    headRef: 'feat/branch-filters',
    updatedAt: new Date(NOW.getTime() - 24 * 3600_000).toISOString(),
    url: '',
  },
  {
    number: 15,
    title: 'Fix unicode table rendering on Windows',
    state: 'open',
    draft: false,
    repoOwner: 'opentui',
    repoName: 'opentui',
    repoId: 'opentui/opentui',
    forkRepoId: 'craigory/opentui',
    headRef: 'fix/unicode-rendering',
    updatedAt: new Date(NOW.getTime() - 3 * 24 * 3600_000).toISOString(),
    url: '',
  },
  {
    number: 8,
    title: 'Update Homebrew formula for v0.3.0',
    state: 'open',
    draft: true,
    repoOwner: 'git-switchboard',
    repoName: 'homebrew-tap',
    repoId: 'git-switchboard/homebrew-tap',
    forkRepoId: null,
    headRef: 'chore/update-formula',
    updatedAt: new Date(NOW.getTime() - 4 * 24 * 3600_000).toISOString(),
    url: '',
  },
  {
    number: 301,
    title: 'Add retry for failed CI checks from TUI',
    state: 'open',
    draft: false,
    repoOwner: 'acme',
    repoName: 'frontend',
    repoId: 'acme/frontend',
    forkRepoId: null,
    headRef: 'feat/retry-checks',
    updatedAt: new Date(NOW.getTime() - 6 * 3600_000).toISOString(),
    url: '',
  },
];

const MOCK_CI_CACHE = new Map<string, CIInfo>([
  [
    'git-switchboard/git-switchboard#42',
    {
      status: 'passing',
      checks: [
        { id: 1, name: 'build', status: 'completed', conclusion: 'success', detailsUrl: null, startedAt: null, completedAt: null },
        { id: 2, name: 'test', status: 'completed', conclusion: 'success', detailsUrl: null, startedAt: null, completedAt: null },
        { id: 3, name: 'lint', status: 'completed', conclusion: 'success', detailsUrl: null, startedAt: null, completedAt: null },
      ],
      fetchedAt: Date.now(),
    },
  ],
  [
    'acme/backend-api#127',
    {
      status: 'failing',
      checks: [
        { id: 4, name: 'build', status: 'completed', conclusion: 'success', detailsUrl: null, startedAt: null, completedAt: null },
        { id: 5, name: 'test', status: 'completed', conclusion: 'failure', detailsUrl: null, startedAt: null, completedAt: null },
      ],
      fetchedAt: Date.now(),
    },
  ],
  [
    'git-switchboard/git-switchboard#89',
    {
      status: 'passing',
      checks: [
        { id: 6, name: 'build', status: 'completed', conclusion: 'success', detailsUrl: null, startedAt: null, completedAt: null },
        { id: 7, name: 'test', status: 'completed', conclusion: 'success', detailsUrl: null, startedAt: null, completedAt: null },
      ],
      fetchedAt: Date.now(),
    },
  ],
  [
    'opentui/opentui#15',
    {
      status: 'passing',
      checks: [
        { id: 8, name: 'ci', status: 'completed', conclusion: 'success', detailsUrl: null, startedAt: null, completedAt: null },
      ],
      fetchedAt: Date.now(),
    },
  ],
  [
    'acme/frontend#301',
    {
      status: 'failing',
      checks: [
        { id: 9, name: 'build', status: 'completed', conclusion: 'success', detailsUrl: null, startedAt: null, completedAt: null },
        { id: 10, name: 'e2e', status: 'completed', conclusion: 'failure', detailsUrl: null, startedAt: null, completedAt: null },
        { id: 11, name: 'lint', status: 'completed', conclusion: 'success', detailsUrl: null, startedAt: null, completedAt: null },
      ],
      fetchedAt: Date.now(),
    },
  ],
]);

const MOCK_REVIEW_CACHE = new Map<string, ReviewInfo>([
  [
    'git-switchboard/git-switchboard#42',
    { status: 'approved', reviewers: [{ login: 'alex', state: 'APPROVED', submittedAt: '' }], fetchedAt: Date.now() },
  ],
  [
    'acme/backend-api#127',
    { status: 'changes-requested', reviewers: [{ login: 'sarah', state: 'CHANGES_REQUESTED', submittedAt: '' }], fetchedAt: Date.now() },
  ],
  [
    'git-switchboard/git-switchboard#89',
    { status: 'needs-review', reviewers: [], fetchedAt: Date.now() },
  ],
  [
    'opentui/opentui#15',
    { status: 'approved', reviewers: [{ login: 'maintainer', state: 'APPROVED', submittedAt: '' }], fetchedAt: Date.now() },
  ],
  [
    'acme/frontend#301',
    { status: 're-review-needed', reviewers: [{ login: 'bob', state: 'DISMISSED', submittedAt: '' }], fetchedAt: Date.now() },
  ],
]);

// ── Capture helpers ──

interface SerializedFrame {
  cols: number;
  rows: number;
  lines: {
    spans: {
      text: string;
      fg: [number, number, number, number];
      bg: [number, number, number, number];
      width: number;
    }[];
  }[];
}

async function captureFrame(
  element: JSX.Element,
  width: number,
  height: number
): Promise<SerializedFrame> {
  const { renderOnce, captureSpans, renderer } = await testRender(element, {
    width,
    height,
  });
  await renderOnce();
  const frame = captureSpans();

  const serialized: SerializedFrame = {
    cols: frame.cols,
    rows: frame.rows,
    lines: frame.lines.map((line) => ({
      spans: line.spans.map((span) => ({
        text: span.text,
        fg: [span.fg.r, span.fg.g, span.fg.b, span.fg.a],
        bg: [span.bg.r, span.bg.g, span.bg.b, span.bg.a],
        width: span.width,
      })),
    })),
  };

  renderer.destroy();
  return serialized;
}

// ── Main ──

async function main() {
  const [branchFrame, prFrame] = await Promise.all([
    captureFrame(
      <App
        branches={MOCK_BRANCHES}
        currentUser="craigory"
        currentUserAliases={['craigory', 'Craigory Coppola']}
        authorList={[]}
        initialShowRemote={false}
        onSelect={() => {}}
        onExit={() => {}}
        fetchBranches={() => MOCK_BRANCHES}
      />,
      80,
      14
    ),
    captureFrame(
      <PrApp
        prs={MOCK_PRS}
        localRepos={[]}
        ciCache={MOCK_CI_CACHE}
        reviewCache={MOCK_REVIEW_CACHE}
        onSelect={() => {}}
        onFetchCI={async () => {}}
        onExit={() => {}}
      />,
      96,
      14
    ),
  ]);

  console.log(JSON.stringify({ branchPicker: branchFrame, prDashboard: prFrame }, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

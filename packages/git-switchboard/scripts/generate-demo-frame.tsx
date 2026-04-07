/**
 * Generates captured frames of the TUI views for use in the docs site.
 *
 * Usage: bun run packages/git-switchboard/scripts/generate-demo-frame.tsx <output-json>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { testRender } from '@opentui/react/test-utils';
import { App } from '../src/app.js';
import { PrApp } from '../src/pr-app.js';
import { PrDetail } from '../src/pr-detail.js';
import { ClonePrompt } from '../src/clone-prompt.js';
import { BRANCH_COMMAND } from '../src/branch-router.js';
import { PR_COMMAND } from '../src/pr-router.js';
import { TuiRouter } from '../src/tui-router.js';
import type {
  BranchWithPR,
  CIInfo,
  ReviewInfo,
  UserPullRequest,
} from '../src/types.js';
import type { LocalRepo } from '../src/scanner.js';
import type { PrScreen } from '../src/store.js';

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
    author: 'craigory',
    role: 'author',
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
    author: 'sarah-dev',
    role: 'assigned',
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
    author: 'craigory',
    role: 'both',
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
    author: 'craigory',
    role: 'author',
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
    author: 'craigory',
    role: 'author',
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
    author: 'alex',
    role: 'assigned',
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

const MOCK_MERGEABLE_CACHE: Record<string, 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'> = {
  'git-switchboard/git-switchboard#42': 'MERGEABLE',
  'acme/backend-api#127': 'CONFLICTING',
  'git-switchboard/git-switchboard#89': 'MERGEABLE',
  'opentui/opentui#15': 'MERGEABLE',
  'git-switchboard/homebrew-tap#8': 'UNKNOWN',
  'acme/frontend#301': 'CONFLICTING',
};

// The PR used for detail + clone-prompt demo frames
const DETAIL_PR = MOCK_PRS[1]!; // acme/backend-api#127 — has a failing test

const DETAIL_CI: CIInfo = {
  status: 'failing',
  checks: [
    {
      id: 4, name: 'build', status: 'completed', conclusion: 'success',
      detailsUrl: 'https://github.com/acme/backend-api/actions/runs/4',
      startedAt: new Date(NOW.getTime() - 8 * 60_000).toISOString(),
      completedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
    },
    {
      id: 5, name: 'test', status: 'completed', conclusion: 'failure',
      detailsUrl: 'https://github.com/acme/backend-api/actions/runs/5',
      startedAt: new Date(NOW.getTime() - 7 * 60_000).toISOString(),
      completedAt: new Date(NOW.getTime() - 4 * 60_000).toISOString(),
    },
    {
      id: 6, name: 'lint', status: 'completed', conclusion: 'success',
      detailsUrl: 'https://github.com/acme/backend-api/actions/runs/6',
      startedAt: new Date(NOW.getTime() - 6 * 60_000).toISOString(),
      completedAt: new Date(NOW.getTime() - 3 * 60_000).toISOString(),
    },
    {
      id: 7, name: 'typecheck', status: 'completed', conclusion: 'success',
      detailsUrl: null,
      startedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
      completedAt: new Date(NOW.getTime() - 2 * 60_000).toISOString(),
    },
  ],
  fetchedAt: Date.now(),
};

const DETAIL_REVIEW: ReviewInfo = {
  status: 'changes-requested',
  reviewers: [
    { login: 'sarah', state: 'CHANGES_REQUESTED', submittedAt: new Date(NOW.getTime() - 30 * 60_000).toISOString() },
  ],
  fetchedAt: Date.now(),
};

const CLONE_MATCHES: LocalRepo[] = [
  {
    path: '~/repos/backend-api',
    remoteUrl: 'git@github.com:acme/backend-api.git',
    repoId: 'acme/backend-api',
    isWorktree: false,
    isClean: true,
    currentBranch: 'main',
  },
  {
    path: '~/repos/worktrees/backend-api/refactor-auth',
    remoteUrl: 'git@github.com:acme/backend-api.git',
    repoId: 'acme/backend-api',
    isWorktree: true,
    isClean: false,
    currentBranch: 'refactor/auth-middleware',
  },
];

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
  const [outputPath] = process.argv.slice(2);
  if (!outputPath) {
    console.error('Usage: bun run generate-demo-frame.tsx <output-json>');
    process.exit(1);
  }

  const branchKeybinds = BRANCH_COMMAND.views['branch-picker'].keybinds;
  const prListKeybinds = PR_COMMAND.views['pr-list'].keybinds;
  const prDetailKeybinds = PR_COMMAND.views['pr-detail'].keybinds;
  const clonePromptKeybinds = PR_COMMAND.views['clone-prompt'].keybinds;

  const [branchFrame, prFrame, prDetailFrame, clonePromptFrame] = await Promise.all([
    captureFrame(
      <App
        keybinds={branchKeybinds}
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
      <TuiRouter
        views={{
          'pr-list': {
            keybinds: prListKeybinds,
            render: (_, keybinds) => (
              <PrApp
                keybinds={keybinds}
                prs={MOCK_PRS}
                localRepos={[]}
                ciCache={MOCK_CI_CACHE}
                reviewCache={MOCK_REVIEW_CACHE}
                mergeableCache={MOCK_MERGEABLE_CACHE}
                repoMode={null}
                refreshing={false}
                onFetchCI={async () => {}}
                onPrefetchDetails={() => {}}
                onRetryChecks={async () => ''}
                onRefreshAll={async () => {}}
                onExit={() => {}}
              />
            ),
          },
        }}
        initialScreen={{ type: 'pr-list' }}
      />,
      96,
      14
    ),
    captureFrame(
      <TuiRouter<PrScreen>
        views={{
          'pr-detail': {
            keybinds: prDetailKeybinds,
            render: (screen, keybinds) => (
              <PrDetail
                keybinds={keybinds}
                pr={(screen as Extract<PrScreen, { type: 'pr-detail' }>).pr}
                ci={DETAIL_CI}
                review={DETAIL_REVIEW}
                ciLoading={false}
                matches={CLONE_MATCHES}
                watched={false}
                onPrepareEditorOpen={async () => CLONE_MATCHES}
                onWatch={() => {}}
                onRefreshCI={() => {}}
                onRetryChecks={async () => ''}
                onRetryCheck={async () => ''}
                onOpenUrl={() => {}}
                onCopyLogs={async () => ''}
                onExit={() => {}}
              />
            ),
          },
        }}
        initialScreen={{ type: 'pr-detail', pr: DETAIL_PR, matches: CLONE_MATCHES }}
      />,
      96,
      20
    ),
    captureFrame(
      <TuiRouter<PrScreen>
        views={{
          'clone-prompt': {
            keybinds: clonePromptKeybinds,
            render: (screen, keybinds) => {
              const s = screen as Extract<PrScreen, { type: 'clone-prompt' }>;
              return (
                <ClonePrompt
                  keybinds={keybinds}
                  repoId={s.pr.repoId}
                  branchName={s.pr.headRef}
                  matches={CLONE_MATCHES}
                  onSelect={async () => {}}
                  onCreateWorktree={() => {}}
                />
              );
            },
          },
        }}
        initialScreen={{ type: 'clone-prompt', pr: DETAIL_PR, matches: CLONE_MATCHES }}
      />,
      80,
      12
    ),
  ]);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    JSON.stringify(
      { branchPicker: branchFrame, prDashboard: prFrame, prDetail: prDetailFrame, clonePrompt: clonePromptFrame },
      null,
      2
    )
  );
  console.log(`Wrote demo frames to ${outputPath}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

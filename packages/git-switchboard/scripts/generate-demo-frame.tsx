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
import { Modal, ModalRow, ModalTextInput } from '../src/modal.js';
import { BRANCH_COMMAND } from '../src/branch-router.js';
import { PR_COMMAND } from '../src/pr-router.js';
import { TuiRouter } from '../src/tui-router.js';
import type {
  BranchWithPR,
  CIInfo,
  ColumnConfig,
  ReviewInfo,
  UserPullRequest,
} from '../src/types.js';
import { DEFAULT_SORT, EMPTY_FILTERS, defaultColumns, FILTER_FIELD_DEFS } from '../src/types.js';
import { PR_COLUMN_DEFS } from '../src/pr-columns.js';
import type { PrColumnId } from '../src/pr-columns.js';
import type { PR } from '../src/data/index.js';
import type { DataLayer } from '../src/data/index.js';
import type { LocalRepo } from '../src/scanner.js';
import type { PrScreen } from '../src/store.js';
import { CHECKMARK, CROSSMARK, UP_ARROW, DOWN_ARROW, RETURN_SYMBOL, LEFT_ARROW, BACKSPACE_SYMBOL } from '../src/unicode.js';

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
    nodeId: 'PR_42',
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
    nodeId: 'PR_127',
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
    nodeId: 'PR_89',
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
    nodeId: 'PR_15',
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
    nodeId: 'PR_8',
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
    nodeId: 'PR_301',
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

// ── Enriched PR entities (CI, review, mergeable baked in) ──

function enrichPR(
  pr: UserPullRequest,
  ci?: CIInfo,
  review?: ReviewInfo,
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN',
): PR {
  return { ...pr, ci, review, mergeable };
}

const MOCK_ENRICHED_PRS: PR[] = [
  enrichPR(
    MOCK_PRS[0]!,
    {
      status: 'passing',
      checks: [
        { id: 1, name: 'build', status: 'completed', conclusion: 'success', detailsUrl: null, startedAt: null, completedAt: null, appSlug: 'github-actions' },
        { id: 2, name: 'test', status: 'completed', conclusion: 'success', detailsUrl: null, startedAt: null, completedAt: null, appSlug: 'github-actions' },
        { id: 3, name: 'lint', status: 'completed', conclusion: 'success', detailsUrl: null, startedAt: null, completedAt: null, appSlug: 'github-actions' },
      ],
      fetchedAt: Date.now(),
    },
    { status: 'approved', reviewers: [{ login: 'alex', state: 'APPROVED', submittedAt: '' }], fetchedAt: Date.now() },
    'MERGEABLE',
  ),
  enrichPR(
    MOCK_PRS[1]!,
    {
      status: 'failing',
      checks: [
        { id: 4, name: 'build', status: 'completed', conclusion: 'success', detailsUrl: null, startedAt: null, completedAt: null, appSlug: 'github-actions' },
        { id: 5, name: 'test', status: 'completed', conclusion: 'failure', detailsUrl: null, startedAt: null, completedAt: null, appSlug: 'github-actions' },
      ],
      fetchedAt: Date.now(),
    },
    { status: 'changes-requested', reviewers: [{ login: 'sarah', state: 'CHANGES_REQUESTED', submittedAt: '' }], fetchedAt: Date.now() },
    'CONFLICTING',
  ),
  enrichPR(
    MOCK_PRS[2]!,
    {
      status: 'passing',
      checks: [
        { id: 6, name: 'build', status: 'completed', conclusion: 'success', detailsUrl: null, startedAt: null, completedAt: null, appSlug: 'github-actions' },
        { id: 7, name: 'test', status: 'completed', conclusion: 'success', detailsUrl: null, startedAt: null, completedAt: null, appSlug: 'github-actions' },
      ],
      fetchedAt: Date.now(),
    },
    { status: 'needs-review', reviewers: [], fetchedAt: Date.now() },
    'MERGEABLE',
  ),
  enrichPR(
    MOCK_PRS[3]!,
    {
      status: 'passing',
      checks: [
        { id: 8, name: 'ci', status: 'completed', conclusion: 'success', detailsUrl: null, startedAt: null, completedAt: null, appSlug: 'github-actions' },
      ],
      fetchedAt: Date.now(),
    },
    { status: 'approved', reviewers: [{ login: 'maintainer', state: 'APPROVED', submittedAt: '' }], fetchedAt: Date.now() },
    'MERGEABLE',
  ),
  enrichPR(MOCK_PRS[4]!, undefined, undefined, 'UNKNOWN'),
  enrichPR(
    MOCK_PRS[5]!,
    {
      status: 'failing',
      checks: [
        { id: 9, name: 'build', status: 'completed', conclusion: 'success', detailsUrl: null, startedAt: null, completedAt: null, appSlug: 'github-actions' },
        { id: 10, name: 'e2e', status: 'completed', conclusion: 'failure', detailsUrl: null, startedAt: null, completedAt: null, appSlug: 'github-actions' },
        { id: 11, name: 'lint', status: 'completed', conclusion: 'success', detailsUrl: null, startedAt: null, completedAt: null, appSlug: 'github-actions' },
      ],
      fetchedAt: Date.now(),
    },
    { status: 're-review-needed', reviewers: [{ login: 'bob', state: 'DISMISSED', submittedAt: '' }], fetchedAt: Date.now() },
    'CONFLICTING',
  ),
];

// ── Mock DataLayer (only the subset PrApp actually calls) ──

const MOCK_DATA_LAYER: DataLayer = {
  query: {
    linearIssuesForPr: () => [],
    prsForLinearIssue: () => [],
    prsForBranch: () => [],
    branchesForPr: () => [],
    checkoutsForPr: () => [],
    prsForCheckout: () => [],
    branchesForCheckout: () => [],
    checkoutsForBranch: () => [],
    linearIssuesForBranch: () => [],
    branchesForLinearIssue: () => [],
  },
  loading: {
    isPrLoading: () => false,
    isLinearLoading: () => false,
    isPrListLoading: () => false,
    loadingPrKeys: () => new Set(),
    loadingLinearKeys: () => new Set(),
    destroy: () => {},
  },
  // Stubs — PrApp only reads query + loading
  bus: { on: () => () => {}, off: () => {}, emit: () => {}, history: [] } as unknown as DataLayer['bus'],
  stores: {} as unknown as DataLayer['stores'],
  relations: {} as unknown as DataLayer['relations'],
  ingest: {} as unknown as DataLayer['ingest'],
  hydrate: async () => {},
  persist: async () => {},
  destroy: () => {},
};

// The PR used for detail + clone-prompt demo frames
const DETAIL_PR = MOCK_PRS[1]!; // acme/backend-api#127 — has a failing test

const DETAIL_CI: CIInfo = {
  status: 'failing',
  checks: [
    {
      id: 4, name: 'build', status: 'completed', conclusion: 'success', appSlug: 'github-actions',
      detailsUrl: 'https://github.com/acme/backend-api/actions/runs/4',
      startedAt: new Date(NOW.getTime() - 8 * 60_000).toISOString(),
      completedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
    },
    {
      id: 5, name: 'test', status: 'completed', conclusion: 'failure', appSlug: 'github-actions',
      detailsUrl: 'https://github.com/acme/backend-api/actions/runs/5',
      startedAt: new Date(NOW.getTime() - 7 * 60_000).toISOString(),
      completedAt: new Date(NOW.getTime() - 4 * 60_000).toISOString(),
    },
    {
      id: 6, name: 'lint', status: 'completed', conclusion: 'success', appSlug: 'github-actions',
      detailsUrl: 'https://github.com/acme/backend-api/actions/runs/6',
      startedAt: new Date(NOW.getTime() - 6 * 60_000).toISOString(),
      completedAt: new Date(NOW.getTime() - 3 * 60_000).toISOString(),
    },
    {
      id: 7, name: 'typecheck', status: 'completed', conclusion: 'success', appSlug: null,
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

// ── Frame validation ──

const ERROR_PATTERNS = [
  /\bError\b/,
  /\bTypeError\b/,
  /\bReferenceError\b/,
  /\bSyntaxError\b/,
  /\bRangeError\b/,
  /\bCannot read propert/,
  /\bundefined is not/,
  /\bnull is not/,
  /\bis not a function\b/,
  /\bUnhandled\b/,
  /\buncaught\b/i,
  /\bstack trace\b/i,
  /\bat [\w.]+\s+\(/,  // stack frame like "at Module._compile ("
];

/**
 * Validates a captured frame to ensure it contains real TUI output
 * rather than error messages from a misconfigured component.
 */
function validateFrame(
  frame: SerializedFrame,
  name: string,
  expectedCols: number,
  expectedRows: number,
): string[] {
  const errors: string[] = [];

  // Check dimension consistency
  if (frame.cols !== expectedCols) {
    errors.push(`${name}: expected ${expectedCols} cols, got ${frame.cols}`);
  }
  if (frame.rows !== expectedRows) {
    errors.push(`${name}: expected ${expectedRows} rows, got ${frame.rows}`);
  }
  if (frame.lines.length !== frame.rows) {
    errors.push(
      `${name}: rows=${frame.rows} but lines.length=${frame.lines.length}`,
    );
  }

  // Extract all visible text from the frame
  const allText = frame.lines
    .map((line) => line.spans.map((s) => s.text).join(''))
    .join('\n');

  // Check for error patterns in the rendered text
  for (const pattern of ERROR_PATTERNS) {
    const match = allText.match(pattern);
    if (match) {
      errors.push(`${name}: frame contains error text: "${match[0]}"`);
    }
  }

  // Check content density — at least 10% of lines should have non-whitespace content
  const nonEmptyLines = frame.lines.filter((line) =>
    line.spans.some((s) => s.text.trim().length > 0),
  );
  const density = nonEmptyLines.length / frame.lines.length;
  if (density < 0.1) {
    errors.push(
      `${name}: frame is nearly empty (${nonEmptyLines.length}/${frame.lines.length} lines have content)`,
    );
  }

  return errors;
}

type CaptureResult =
  | { ok: true; frame: SerializedFrame }
  | { ok: false; error: string };

async function captureFrame(
  element: JSX.Element,
  width: number,
  height: number
): Promise<CaptureResult> {
  try {
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
    return { ok: true, frame: serialized };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ── Demo components for modal frames ──

const SORT_FIELDS_DEMO = [
  { field: 'updated', label: 'Updated' },
  { field: 'review', label: 'Review Status' },
  { field: 'ci', label: 'CI Status' },
  { field: 'repo', label: 'Repository' },
  { field: 'merge', label: 'Merge Status' },
  { field: 'diff', label: 'Diff Size' },
  { field: 'number', label: 'PR Number' },
];

function SortModalDemo({ termWidth, termHeight }: { termWidth: number; termHeight: number }) {
  // Default sort: review 1↑, updated 2↓
  const activeLayers = [
    { field: 'review', dir: 'asc', layerNum: 1 },
    { field: 'updated', dir: 'desc', layerNum: 2 },
  ];

  return (
    <box style={{ width: '100%', height: '100%' }}>
      <Modal
        title="Sort Order"
        hint="Enter/Space toggle | Esc close"
        width={46}
        height={SORT_FIELDS_DEMO.length + 2}
        termWidth={termWidth}
        termHeight={termHeight}
      >
        {SORT_FIELDS_DEMO.map((sf, i) => {
          const isActive = i === 2; // CI Status selected
          const layer = activeLayers.find((l) => l.field === sf.field);
          const indicator = layer
            ? `${layer.layerNum}${layer.dir === 'asc' ? '↑' : '↓'}`
            : '  ';
          return (
            <ModalRow
              key={sf.field}
              label={` ${indicator} ${isActive ? '>' : ' '} ${sf.label}`}
              fg={layer ? (isActive ? '#c0caf5' : '#7aa2f7') : (isActive ? '#a9b1d6' : '#565f89')}
              active={isActive}
            />
          );
        })}
        <box style={{ height: 1, width: '100%' }} />
        <ModalRow label="   Close" fg="#565f89" />
      </Modal>
    </box>
  );
}

function ColumnModalDemo({ termWidth, termHeight }: { termWidth: number; termHeight: number }) {
  const demoColumns: { id: string; label: string; visibility: 'auto' | 'visible' | 'hidden' }[] = [
    { id: 'role', label: 'Role', visibility: 'auto' },
    { id: 'author', label: 'Author', visibility: 'auto' },
    { id: 'number', label: 'PR Number', visibility: 'visible' },
    { id: 'title', label: 'Title', visibility: 'visible' },
    { id: 'repo', label: 'Repository', visibility: 'auto' },
    { id: 'updated', label: 'Updated', visibility: 'visible' },
    { id: 'ci', label: 'CI Status', visibility: 'visible' },
    { id: 'merge', label: 'Merge Status', visibility: 'hidden' },
    { id: 'diff', label: 'Diff', visibility: 'hidden' },
    { id: 'linear', label: 'Linear', visibility: 'auto' },
    { id: 'review', label: 'Review', visibility: 'visible' },
  ];

  return (
    <box style={{ width: '100%', height: '100%' }}>
      <Modal
        title="Columns"
        hint="Enter/Space toggle | r reorder | Esc close"
        width={46}
        height={demoColumns.length + 2}
        termWidth={termWidth}
        termHeight={termHeight}
      >
        {demoColumns.map((col, i) => {
          const isActive = i === 7; // Merge Status selected
          const visIcon = col.visibility === 'auto' ? '▣' : col.visibility === 'visible' ? '✓' : '✗';
          return (
            <box
              key={col.id}
              style={{
                height: 1,
                width: '100%',
                backgroundColor: isActive ? '#292e42' : undefined,
              }}
            >
              <text
                content={`   ${isActive ? '>' : ' '} ${visIcon} ${col.label}`}
                fg={col.visibility === 'hidden' ? '#565f89' : isActive ? '#c0caf5' : '#a9b1d6'}
              />
            </box>
          );
        })}
        <box style={{ height: 1, width: '100%' }} />
        <ModalRow label="   Close" fg="#565f89" />
      </Modal>
    </box>
  );
}

function FilterFieldsDemo({ termWidth, termHeight }: { termWidth: number; termHeight: number }) {
  const fields = FILTER_FIELD_DEFS;
  // Show review filter with active value
  const activeValues: Record<string, string> = {
    review: ' = approved, changes-requested',
    ci: ' = failing',
  };

  const totalItems = fields.length + 3; // fields + clear + save + close

  return (
    <box style={{ width: '100%', height: '100%' }}>
      <Modal
        title="Filters (2 active)"
        hint="Enter/Space select | d delete preset | Esc close"
        width={46}
        height={totalItems + 1}
        termWidth={termWidth}
        termHeight={termHeight}
      >
        {fields.map((def, i) => {
          const isActive = i === 1; // Repo selected
          const valueText = activeValues[def.id] ?? '';
          const fg = valueText
            ? (isActive ? '#c0caf5' : '#7aa2f7')
            : (isActive ? '#a9b1d6' : '#565f89');
          return (
            <ModalRow
              key={def.id}
              label={` ${isActive ? '>' : ' '} ${def.label}${valueText}`}
              fg={fg}
            />
          );
        })}
        <box style={{ height: 1, width: '100%' }} />
        <ModalRow label="   ✗ Clear all filters" fg="#565f89" />
        <ModalRow label="   + Save as preset" fg="#565f89" />
        <ModalRow label="   Close" fg="#565f89" />
      </Modal>
    </box>
  );
}

function FilterMultiselectDemo({ termWidth, termHeight }: { termWidth: number; termHeight: number }) {
  const options = [
    { value: 'passing', label: 'Passing', checked: false },
    { value: 'failing', label: 'Failing', checked: true },
    { value: 'pending', label: 'Pending', checked: false },
    { value: 'mixed', label: 'Mixed', checked: false },
    { value: 'unknown', label: 'Unknown', checked: false },
  ];

  return (
    <box style={{ width: '100%', height: '100%' }}>
      <Modal
        title="CI Status"
        hint="Enter/Space toggle | Esc apply & back"
        width={46}
        height={options.length}
        termWidth={termWidth}
        termHeight={termHeight}
      >
        {options.map((opt, i) => {
          const isActive = i === 0; // Passing selected
          return (
            <ModalRow
              key={opt.value}
              label={` ${isActive ? '>' : ' '} [${opt.checked ? '✓' : ' '}] ${opt.label}`}
              fg={opt.checked ? (isActive ? '#c0caf5' : '#7aa2f7') : (isActive ? '#a9b1d6' : '#565f89')}
              active={isActive}
            />
          );
        })}
      </Modal>
    </box>
  );
}

// ── Demo components for connect frames ──

function ConnectListDemo() {
  const providers = [
    { name: 'github', icon: CHECKMARK, text: 'connected (encrypted)', color: '#9ece6a' },
    { name: 'linear', icon: CROSSMARK, text: 'not configured', color: '#565f89' },
  ];
  const selectedIndex = 0;
  const nameCol = 12;

  return (
    <box flexDirection="column" style={{ width: '100%', height: '100%', padding: 1 }}>
      <box style={{ height: 1, width: '100%' }}>
        <text content=" Manage Connections" fg="#7aa2f7" />
      </box>
      <box style={{ height: 1 }} />
      {providers.map((provider, index) => {
        const isActive = index === selectedIndex;
        const cursor = isActive ? '>' : ' ';
        return (
          <box
            key={provider.name}
            style={{
              height: 1,
              width: '100%',
              backgroundColor: isActive ? '#292e42' : undefined,
            }}
          >
            <text>
              <span fg={isActive ? '#c0caf5' : '#a9b1d6'}>{` ${cursor} ${provider.name.padEnd(nameCol)}`}</span>
              <span fg={provider.color}>{`${provider.icon} ${provider.text}`}</span>
            </text>
          </box>
        );
      })}
      <box style={{ flexGrow: 1 }} />
      <box style={{ height: 1, width: '100%' }}>
        <text content={` [${UP_ARROW}${DOWN_ARROW}] Navigate | [${RETURN_SYMBOL}] Select | [q]uit`} fg="#565f89" />
      </box>
    </box>
  );
}

function ConnectDetailDemo() {
  return (
    <box flexDirection="column" style={{ width: '100%', height: '100%', padding: 1 }}>
      <box style={{ height: 1, width: '100%' }}>
        <text content=" github" fg="#7aa2f7" />
      </box>
      <box style={{ height: 1 }} />
      <box style={{ height: 1 }}>
        <text>
          <span fg="#565f89">{"  Status      "}</span>
          <span fg="#9ece6a">{`${CHECKMARK} connected (encrypted)`}</span>
        </text>
      </box>
      <box style={{ height: 1 }}>
        <text>
          <span fg="#565f89">{"  Identity    "}</span>
          <span fg="#9ece6a">{`${CHECKMARK} Authenticated as craigory`}</span>
        </text>
      </box>
      <box style={{ height: 1 }}>
        <text>
          <span fg="#565f89">{"  Settings    "}</span>
          <span fg="#7aa2f7">{"https://github.com/settings/tokens"}</span>
        </text>
      </box>
      <box style={{ flexGrow: 1 }} />
      <box style={{ height: 1, width: '100%' }}>
        <text content={` [s]etup | [d]isconnect | [${LEFT_ARROW}] Back | [q]uit`} fg="#565f89" />
      </box>
    </box>
  );
}

function ConnectSetupDemo() {
  const strategies = [
    { label: 'Environment variable', desc: 'Read token from an env var at launch' },
    { label: 'Encrypted (machine-locked)', desc: 'No password needed \u2014 tied to this machine' },
    { label: 'Encrypted (password-protected)', desc: 'Enter a password each launch' },
    { label: 'Shell command', desc: 'Run a command to fetch the token' },
  ];
  const selectedIndex = 1;

  return (
    <box flexDirection="column" style={{ width: '100%', height: '100%', padding: 1 }}>
      <box style={{ height: 1, width: '100%' }}>
        <text content=" Setup github" fg="#7aa2f7" />
      </box>
      <box style={{ height: 1 }} />
      <box style={{ height: 1 }}>
        <text content="  How would you like to store your token?" fg="#a9b1d6" />
      </box>
      <box style={{ height: 1 }} />
      {strategies.map((opt, i) => {
        const isActive = i === selectedIndex;
        return (
          <box
            key={opt.label}
            style={{
              height: 1,
              width: '100%',
              backgroundColor: isActive ? '#292e42' : undefined,
            }}
          >
            <text>
              <span fg={isActive ? '#c0caf5' : '#a9b1d6'}>{`  ${isActive ? '>' : ' '} ${opt.label.padEnd(32)}`}</span>
              <span fg="#565f89">{opt.desc}</span>
            </text>
          </box>
        );
      })}
      <box style={{ flexGrow: 1 }} />
      <box style={{ height: 1, width: '100%' }}>
        <text content={` [${UP_ARROW}${DOWN_ARROW}] Navigate | [${RETURN_SYMBOL}] Confirm | [Esc] Back | [q]uit`} fg="#565f89" />
      </box>
    </box>
  );
}

// ── Demo components for checkout flow frames ──

function WorktreeConflictDemo() {
  const branchName = 'feat/add-pr-dashboard';
  const worktreePath = '~/repos/worktrees/git-switchboard/pr-dashboard';
  const options = [
    `Open editor in ${worktreePath}`,
    `Checkout new branch from '${branchName}' here`,
    `Move worktree to new branch from '${branchName}'`,
    `Move worktree to a different branch`,
  ];
  const selectedIndex = 0;

  return (
    <box flexDirection="column" style={{ width: '100%', height: '100%', padding: 1 }}>
      <box style={{ height: 1, width: '100%' }}>
        <text content={` Branch '${branchName}' is checked out in another worktree`} fg="#e0af68" />
      </box>
      <box style={{ height: 1, width: '100%' }}>
        <text content={`  ${worktreePath}`} fg="#565f89" />
      </box>
      <box style={{ height: 1 }} />
      {options.map((label, i) => {
        const isSelected = i === selectedIndex;
        return (
          <box
            key={label}
            style={{ height: 1, width: '100%', backgroundColor: isSelected ? '#292e42' : undefined }}
          >
            <text
              content={`  ${isSelected ? '› ' : '  '}${label}`}
              fg={isSelected ? '#7aa2f7' : '#c0caf5'}
            />
          </box>
        );
      })}
      <box style={{ flexGrow: 1 }} />
      <box style={{ height: 1, width: '100%' }}>
        <text content={` [${UP_ARROW}${DOWN_ARROW}] Navigate | [${RETURN_SYMBOL}] Select | [${BACKSPACE_SYMBOL}] Back`} fg="#565f89" />
      </box>
    </box>
  );
}

function DirtyCheckoutDemo() {
  const dirtyFiles = ['src/app.tsx', 'src/types.ts', 'package.json'];
  const options = [
    { label: 'Stash changes and proceed', selected: true },
    { label: 'Proceed anyway', selected: false },
  ];

  return (
    <box flexDirection="column" style={{ width: '100%', height: '100%', padding: 1 }}>
      <box style={{ height: 1, width: '100%' }}>
        <text content={` Working tree has uncommitted changes (${dirtyFiles.length} files)`} fg="#e0af68" />
      </box>
      <box style={{ height: 1, width: '100%' }}>
        <text content="  Checking out: main" fg="#565f89" />
      </box>
      <box style={{ height: 1 }} />
      {dirtyFiles.map((f) => (
        <box key={f} style={{ height: 1, width: '100%' }}>
          <text content={`    ${f}`} fg="#565f89" />
        </box>
      ))}
      <box style={{ height: 1 }} />
      {options.map((opt) => (
        <box
          key={opt.label}
          style={{ height: 1, width: '100%', backgroundColor: opt.selected ? '#292e42' : undefined }}
        >
          <text
            content={`  ${opt.selected ? '› ' : '  '}${opt.label}`}
            fg={opt.selected ? '#7aa2f7' : '#c0caf5'}
          />
        </box>
      ))}
      <box style={{ flexGrow: 1 }} />
      <box style={{ height: 1, width: '100%' }}>
        <text content={` [${UP_ARROW}${DOWN_ARROW}] Navigate | [${RETURN_SYMBOL}] Select | [${BACKSPACE_SYMBOL}] Back`} fg="#565f89" />
      </box>
    </box>
  );
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

  const defaultCols = defaultColumns(PR_COLUMN_DEFS);

  // ── Frame dimensions for new captures ──
  // Modal frames: wider than the modal so the backdrop is visible and
  // the modal appears centered like it does in the real TUI.
  const sortModalW = 64;
  const sortModalH = 20;
  const columnModalW = 64;
  const columnModalH = 24;
  const filterFieldsW = 64;
  const filterFieldsH = 24;
  const filterMultiselectW = 64;
  const filterMultiselectH = 16;
  const connectListW = 60;
  const connectListH = 8;
  const connectDetailW = 60;
  const connectDetailH = 10;
  const connectSetupW = 80;
  const connectSetupH = 12;
  const worktreeConflictW = 80;
  const worktreeConflictH = 12;
  const dirtyCheckoutW = 72;
  const dirtyCheckoutH = 14;

  const [
    branchFrame,
    prFrame,
    prDetailFrame,
    clonePromptFrame,
    sortModalFrame,
    columnModalFrame,
    filterFieldsFrame,
    filterMultiselectFrame,
    connectListFrame,
    connectDetailFrame,
    connectSetupFrame,
    worktreeConflictFrame,
    dirtyCheckoutFrame,
  ] = await Promise.all([
    // ── Branch picker: App needs TuiRouter context ──
    captureFrame(
      <TuiRouter
        views={{
          'branch-picker': {
            keybinds: branchKeybinds,
            render: (_, keybinds) => (
              <App
                keybinds={keybinds}
                branches={MOCK_BRANCHES}
                currentUser="craigory"
                currentUserAliases={['craigory', 'Craigory Coppola']}
                authorList={[]}
                initialShowRemote={false}
                worktrees={[]}
                getWorkingTreeDirtyFiles={() => []}
                onSelect={() => {}}
                onExit={() => {}}
                fetchBranches={() => MOCK_BRANCHES}
              />
            ),
          },
        }}
        initialScreen={{ type: 'branch-picker' }}
      />,
      80,
      14
    ),
    // ── PR dashboard: PrApp needs DataLayer + enriched PR[] + state setters ──
    captureFrame(
      <TuiRouter
        views={{
          'pr-list': {
            keybinds: prListKeybinds,
            render: (_, keybinds) => (
              <PrApp
                keybinds={keybinds}
                prs={MOCK_ENRICHED_PRS}
                localRepos={[]}
                dataLayer={MOCK_DATA_LAYER}
                repoMode={null}
                refreshing={false}
                searchQuery=""
                setSearchQuery={() => {}}
                sortLayers={DEFAULT_SORT}
                setSortLayers={() => {}}
                columns={defaultCols}
                setColumns={() => {}}
                filters={EMPTY_FILTERS}
                setFilters={() => {}}
                selectedIndex={0}
                setSelectedIndex={() => {}}
                scrollOffset={0}
                setScrollOffset={() => {}}
                onFetchCI={() => {}}
                onPrefetchDetails={() => {}}
                onRetryChecks={async () => ''}
                onRefreshAll={() => {}}
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
    // ── PR detail view ──
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
                linearIssues={[]}
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
    // ── Clone prompt ──
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
    // ── Sort modal ──
    captureFrame(<SortModalDemo termWidth={sortModalW} termHeight={sortModalH} />, sortModalW, sortModalH),
    // ── Column config modal ──
    captureFrame(<ColumnModalDemo termWidth={columnModalW} termHeight={columnModalH} />, columnModalW, columnModalH),
    // ── Filter fields modal ──
    captureFrame(<FilterFieldsDemo termWidth={filterFieldsW} termHeight={filterFieldsH} />, filterFieldsW, filterFieldsH),
    // ── Filter multiselect modal ──
    captureFrame(<FilterMultiselectDemo termWidth={filterMultiselectW} termHeight={filterMultiselectH} />, filterMultiselectW, filterMultiselectH),
    // ── Connect: provider list ──
    captureFrame(<ConnectListDemo />, connectListW, connectListH),
    // ── Connect: provider detail ──
    captureFrame(<ConnectDetailDemo />, connectDetailW, connectDetailH),
    // ── Connect: setup ──
    captureFrame(<ConnectSetupDemo />, connectSetupW, connectSetupH),
    // ── Worktree conflict ──
    captureFrame(<WorktreeConflictDemo />, worktreeConflictW, worktreeConflictH),
    // ── Dirty checkout ──
    captureFrame(<DirtyCheckoutDemo />, dirtyCheckoutW, dirtyCheckoutH),
  ]);

  // Collect render failures and content validation errors
  const results = {
    branchPicker: { result: branchFrame, cols: 80, rows: 14 },
    prDashboard: { result: prFrame, cols: 96, rows: 14 },
    prDetail: { result: prDetailFrame, cols: 96, rows: 20 },
    clonePrompt: { result: clonePromptFrame, cols: 80, rows: 12 },
    sortModal: { result: sortModalFrame, cols: sortModalW, rows: sortModalH },
    columnModal: { result: columnModalFrame, cols: columnModalW, rows: columnModalH },
    filterFields: { result: filterFieldsFrame, cols: filterFieldsW, rows: filterFieldsH },
    filterMultiselect: { result: filterMultiselectFrame, cols: filterMultiselectW, rows: filterMultiselectH },
    connectList: { result: connectListFrame, cols: connectListW, rows: connectListH },
    connectDetail: { result: connectDetailFrame, cols: connectDetailW, rows: connectDetailH },
    connectSetup: { result: connectSetupFrame, cols: connectSetupW, rows: connectSetupH },
    worktreeConflict: { result: worktreeConflictFrame, cols: worktreeConflictW, rows: worktreeConflictH },
    dirtyCheckout: { result: dirtyCheckoutFrame, cols: dirtyCheckoutW, rows: dirtyCheckoutH },
  } as const;

  const validationErrors: string[] = [];
  for (const [name, { result, cols, rows }] of Object.entries(results)) {
    if (!result.ok) {
      validationErrors.push(`${name}: render crashed — ${result.error}`);
    } else {
      validationErrors.push(...validateFrame(result.frame, name, cols, rows));
    }
  }

  if (validationErrors.length > 0) {
    console.error('Frame validation failed:');
    for (const err of validationErrors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  type OkFrame = Extract<CaptureResult, { ok: true }>;

  const frames = {
    branchPicker: (branchFrame as OkFrame).frame,
    prDashboard: (prFrame as OkFrame).frame,
    prDetail: (prDetailFrame as OkFrame).frame,
    clonePrompt: (clonePromptFrame as OkFrame).frame,
    sortModal: (sortModalFrame as OkFrame).frame,
    columnModal: (columnModalFrame as OkFrame).frame,
    filterFields: (filterFieldsFrame as OkFrame).frame,
    filterMultiselect: (filterMultiselectFrame as OkFrame).frame,
    connectList: (connectListFrame as OkFrame).frame,
    connectDetail: (connectDetailFrame as OkFrame).frame,
    connectSetup: (connectSetupFrame as OkFrame).frame,
    worktreeConflict: (worktreeConflictFrame as OkFrame).frame,
    dirtyCheckout: (dirtyCheckoutFrame as OkFrame).frame,
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(frames, null, 2));
  console.log(`Wrote demo frames to ${outputPath}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

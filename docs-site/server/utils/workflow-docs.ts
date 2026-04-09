import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DocPage } from './docs';

interface TerminalSpan {
  text: string;
  fg: [number, number, number, number];
  bg: [number, number, number, number];
  width: number;
}

interface TerminalLine {
  spans: TerminalSpan[];
}

interface TerminalFrame {
  cols: number;
  rows: number;
  lines: TerminalLine[];
}

function rgba(components: [number, number, number, number]): string | null {
  const [r, g, b, a] = components;
  if (a === 0) return null;
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

function frameToHtml(frame: TerminalFrame, label: string): string {
  const lines = frame.lines.map((line) => {
    const spans = line.spans
      .map((span, spanIdx) => {
        if (!span.text.trim() && spanIdx === line.spans.length - 1) return '';
        const fg = rgba(span.fg);
        const bg = rgba(span.bg);
        const style = [
          fg ? `color:${fg}` : '',
          bg ? `background-color:${bg}` : '',
        ]
          .filter(Boolean)
          .join(';');
        const escaped = span.text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return style ? `<span style="${style}">${escaped}</span>` : escaped;
      })
      .join('');
    return `<div style="display:block;padding:0 6px;line-height:1.4;min-height:1.4em;white-space:pre">${spans}</div>`;
  });

  return `<div class="terminal-frame" aria-label="${label}" style="font-family:'JetBrains Mono',monospace;font-size:13px;background:#000;color:#c0caf5;white-space:pre;overflow-x:auto;border:1px solid #2a5070">${lines.join('')}</div>`;
}

interface FrameMap {
  branchPicker?: TerminalFrame;
  prDashboard?: TerminalFrame;
  prDetail?: TerminalFrame;
  clonePrompt?: TerminalFrame;
  sortModal?: TerminalFrame;
  columnModal?: TerminalFrame;
  filterFields?: TerminalFrame;
  filterMultiselect?: TerminalFrame;
  connectList?: TerminalFrame;
  connectDetail?: TerminalFrame;
  connectSetup?: TerminalFrame;
}

function generatePrWorkflowPage(frames: FrameMap): DocPage {
  const prDashboard = frames.prDashboard
    ? frameToHtml(frames.prDashboard, 'PR dashboard screenshot')
    : '';
  const prDetail = frames.prDetail
    ? frameToHtml(frames.prDetail, 'PR detail view screenshot')
    : '';
  const clonePrompt = frames.clonePrompt
    ? frameToHtml(frames.clonePrompt, 'Clone prompt screenshot')
    : '';

  const renderedHtml = `
<p>
  The <code>git-switchboard pr</code> command opens a full PR dashboard that lets you
  track open pull requests across all your GitHub repositories, inspect CI status and
  review state, and jump straight into a local worktree — all without leaving the
  terminal.
</p>

<h2 id="pr-dashboard">PR Dashboard</h2>

<p>
  Run <code>git-switchboard pr</code> to open the dashboard. Each row shows one open
  pull request with live CI and review badges. Rows are colour-coded: a green dot means
  all checks passed, amber is pending, and red signals a failure. The review badge
  shows whether the PR is approved, has changes requested, or is waiting for reviewers.
</p>

${prDashboard}

<p>
  Use <kbd>j</kbd>/<kbd>k</kbd> or the arrow keys to move between rows. Press
  <kbd>c</kbd> on any PR to fetch or refresh its CI status. Press <kbd>r</kbd> to
  retry failed checks (only shown when the selected PR has failures). Use <kbd>/</kbd>
  to filter by title or repo, and <kbd>s</kbd> to open the sort modal.
</p>

<h2 id="pr-detail">PR Detail View</h2>

<p>
  Press <kbd>Enter</kbd> on any PR to open its detail view. This shows all CI check
  runs with pass/fail icons, the time each check took, and the current review state.
  Checks are sorted so failures appear first.
</p>

${prDetail}

<p>
  From the detail view you can:
</p>
<ul>
  <li>Press <kbd>Enter</kbd> on a check run to open its logs in your browser, or
      press <kbd>Enter</kbd> at the top to open the PR in your editor.</li>
  <li>Press <kbd>c</kbd> to copy the logs of the selected check to your clipboard.</li>
  <li>Press <kbd>r</kbd> to re-run failed checks via the GitHub API.</li>
  <li>Press <kbd>w</kbd> to toggle watch mode — the view will auto-refresh CI until
      all checks complete.</li>
  <li>Press <kbd>Left</kbd>, <kbd>Backspace</kbd>, or <kbd>Esc</kbd> to return to
      the dashboard.</li>
</ul>

<h2 id="clone-prompt">Opening a PR in Your Editor</h2>

<p>
  When you press <kbd>Enter</kbd> at the top of the detail view (or on the PR row in
  the dashboard), git-switchboard scans your local filesystem for existing clones of
  the repository.  If it finds one or more, the clone prompt appears so you can choose
  where to open the PR.
</p>

${clonePrompt}

<p>
  The list shows every local clone, indicating whether it's a worktree, whether it's
  clean, and whether it already has the PR branch checked out. Select an existing clone
  and press <kbd>Enter</kbd> to check out the branch and open your editor there. Choose
  <strong>+ Create new worktree</strong> to type a path for a fresh worktree — the
  branch will be checked out automatically.
</p>
<p>
  If no local clone exists, git-switchboard will prompt you to clone the repository
  before opening it.
</p>
`.trim();

  return {
    slug: 'guide/pr-workflow',
    title: 'PR Workflow',
    description: 'How to navigate from the PR dashboard to CI details and open a PR in your editor.',
    order: 1.5,
    content: '',
    renderedHtml,
    headings: [
      { id: 'pr-dashboard', text: 'PR Dashboard', level: 2 },
      { id: 'pr-detail', text: 'PR Detail View', level: 2 },
      { id: 'clone-prompt', text: 'Opening a PR in Your Editor', level: 2 },
    ],
  };
}

function generateColumnsPage(frames: FrameMap): DocPage {
  const columnModal = frames.columnModal
    ? frameToHtml(frames.columnModal, 'Column configuration modal')
    : '';

  const renderedHtml = `
<p>
  The PR dashboard table is fully configurable. You can show, hide, and reorder
  columns to match your workflow. Press <kbd>C</kbd> (capital C) in the PR
  dashboard to open the column configuration modal.
</p>

${columnModal}

<h2 id="visibility">Column Visibility</h2>

<p>
  Each column has one of three visibility states:
</p>
<ul>
  <li><strong>Auto</strong> (<code>▣</code>) — the column is shown or hidden
      automatically based on context. For example, the <em>Repository</em> column
      auto-hides when you filter to a single repo, and the <em>Role</em> column
      hides when you filter by role.</li>
  <li><strong>Visible</strong> (<code>✓</code>) — the column is always shown.</li>
  <li><strong>Hidden</strong> (<code>✗</code>) — the column is always hidden.</li>
</ul>
<p>
  Press <kbd>Enter</kbd> or <kbd>Space</kbd> on a column to cycle through its
  visibility states. Columns that support <em>auto</em> mode cycle through all
  three; columns without auto mode toggle between visible and hidden.
</p>

<h3 id="auto-columns">Auto-Visibility Columns</h3>

<p>
  Four columns support auto mode:
</p>
<ul>
  <li><strong>Role</strong> — auto-hides when a role filter is applied or when
      running in single-repo mode.</li>
  <li><strong>Author</strong> — auto-hides when an exact author filter is active
      or when not in repo mode.</li>
  <li><strong>Repository</strong> — auto-hides when an exact repo filter is active
      or in single-repo mode.</li>
  <li><strong>Linear</strong> — auto-hides when no Linear issues are linked to any
      visible PRs.</li>
</ul>

<h2 id="reordering">Reordering Columns</h2>

<p>
  Press <kbd>r</kbd> inside the column modal to enter reorder mode. The hint bar
  changes to <code>↑↓ move | Enter/Esc done</code>. Use <kbd>j</kbd>/<kbd>k</kbd>
  or the arrow keys to move the selected column up or down in the list. Press
  <kbd>Enter</kbd> or <kbd>Esc</kbd> to exit reorder mode. The column order is
  saved automatically when you close the modal.
</p>

<h2 id="available-columns">Available Columns</h2>

<table style="--cols: 3">
  <thead>
    <tr><th>Column</th><th>Shows</th><th>Auto</th></tr>
  </thead>
  <tbody>
    <tr><td>Role</td><td>Whether you authored or are assigned to the PR</td><td>Yes</td></tr>
    <tr><td>Author</td><td>The PR author&rsquo;s GitHub login</td><td>Yes</td></tr>
    <tr><td>PR Number</td><td>The pull request number</td><td>No</td></tr>
    <tr><td>Title</td><td>PR title (fills remaining width)</td><td>No</td></tr>
    <tr><td>Repository</td><td>The <code>owner/repo</code> identifier</td><td>Yes</td></tr>
    <tr><td>Updated</td><td>Relative time since last update</td><td>No</td></tr>
    <tr><td>CI Status</td><td>Pass/fail/pending check counts</td><td>No</td></tr>
    <tr><td>Merge Status</td><td>Mergeable, conflicting, or unknown</td><td>No</td></tr>
    <tr><td>Diff</td><td>Lines added and removed</td><td>No</td></tr>
    <tr><td>Linear</td><td>Linked Linear issue identifier</td><td>Yes</td></tr>
    <tr><td>Review</td><td>Review state badge (approved, changes requested, etc.)</td><td>No</td></tr>
  </tbody>
</table>
`.trim();

  return {
    slug: 'guide/columns',
    title: 'Configuring Columns',
    description: 'Show, hide, and reorder PR dashboard columns with auto-visibility and manual overrides.',
    order: 1.6,
    content: '',
    renderedHtml,
    headings: [
      { id: 'visibility', text: 'Column Visibility', level: 2 },
      { id: 'auto-columns', text: 'Auto-Visibility Columns', level: 3 },
      { id: 'reordering', text: 'Reordering Columns', level: 2 },
      { id: 'available-columns', text: 'Available Columns', level: 2 },
    ],
  };
}

function generateSortingPage(frames: FrameMap): DocPage {
  const sortModal = frames.sortModal
    ? frameToHtml(frames.sortModal, 'Sort order modal')
    : '';

  const renderedHtml = `
<p>
  The PR dashboard supports multi-level sorting so you can prioritize
  the pull requests that need your attention most. Press <kbd>s</kbd> in the
  PR dashboard to open the sort modal.
</p>

${sortModal}

<h2 id="multi-level">Multi-Level Sorting</h2>

<p>
  Sort layers are applied in order. Each active layer shows a number and
  arrow in the modal — for example, <code>1↑</code> means "first sort
  layer, ascending" and <code>2↓</code> means "second layer, descending".
  The column headers in the PR table also show sort indicators so you can
  see the active sort at a glance.
</p>

<p>
  Toggling a sort field cycles through three states:
</p>
<ol>
  <li><strong>Add</strong> — the field is added as the next sort layer with
      its default direction.</li>
  <li><strong>Flip</strong> — the field's direction is reversed (ascending
      becomes descending, and vice versa).</li>
  <li><strong>Remove</strong> — the field is removed from the sort layers.</li>
</ol>

<p>
  Press <kbd>Enter</kbd> or <kbd>Space</kbd> on a field to cycle through
  these states. Press <kbd>Esc</kbd> to close the modal and apply the
  updated sort.
</p>

<h2 id="default-sort">Default Sort Order</h2>

<p>
  By default, PRs are sorted by:
</p>
<ol>
  <li><strong>Review Status</strong> (ascending) — approved PRs first,
      then changes requested, then needs review.</li>
  <li><strong>Updated</strong> (descending) — most recently updated first
      within each review group.</li>
</ol>

<h2 id="sort-fields">Available Sort Fields</h2>

<table style="--cols: 3">
  <thead>
    <tr><th>Field</th><th>Default Direction</th><th>Sort Order</th></tr>
  </thead>
  <tbody>
    <tr><td>Updated</td><td>Descending</td><td>Most recently updated first</td></tr>
    <tr><td>Review Status</td><td>Ascending</td><td>approved &rarr; changes-requested &rarr; re-review &rarr; commented &rarr; needs-review &rarr; dismissed</td></tr>
    <tr><td>CI Status</td><td>Ascending</td><td>failing &rarr; mixed &rarr; pending &rarr; passing &rarr; unknown</td></tr>
    <tr><td>Repository</td><td>Ascending</td><td>Alphabetical by <code>owner/repo</code></td></tr>
    <tr><td>Merge Status</td><td>Ascending</td><td>conflicting &rarr; unknown &rarr; mergeable</td></tr>
    <tr><td>Diff Size</td><td>Descending</td><td>Largest diffs first</td></tr>
    <tr><td>PR Number</td><td>Descending</td><td>Highest number first</td></tr>
  </tbody>
</table>
`.trim();

  return {
    slug: 'guide/sorting',
    title: 'Sorting',
    description: 'Multi-level sorting in the PR dashboard — add, flip, and remove sort layers.',
    order: 1.7,
    content: '',
    renderedHtml,
    headings: [
      { id: 'multi-level', text: 'Multi-Level Sorting', level: 2 },
      { id: 'default-sort', text: 'Default Sort Order', level: 2 },
      { id: 'sort-fields', text: 'Available Sort Fields', level: 2 },
    ],
  };
}

function generateFilteringPage(frames: FrameMap): DocPage {
  const filterFields = frames.filterFields
    ? frameToHtml(frames.filterFields, 'Filter modal screenshot')
    : '';
  const filterMultiselect = frames.filterMultiselect
    ? frameToHtml(frames.filterMultiselect, 'Filter multiselect picker screenshot')
    : '';
  const branchPicker = frames.branchPicker
    ? frameToHtml(frames.branchPicker, 'Branch picker screenshot')
    : '';

  const renderedHtml = `
<p>
  git-switchboard offers two ways to narrow what's shown: structured
  filters that target specific fields, and free-text search that matches
  across titles, repos, and branches.
</p>

<h2 id="structured-filters">Structured Filters</h2>

<p>
  Press <kbd>f</kbd> in the PR dashboard to open the filter modal. Each
  field can be set independently and all active filters are combined with
  AND logic — a PR must match every filter to appear.
</p>

${filterFields}

<h3 id="string-filters">String Filters</h3>

<p>
  String filter fields (Organization, Repository, Author, Linear Issue) open
  a text input with autocomplete suggestions drawn from your current PR list.
  Type to narrow the suggestions, then press <kbd>Enter</kbd> to confirm.
</p>
<p>
  Press <kbd>Tab</kbd> inside the string picker to toggle between
  <strong>fuzzy</strong> and <strong>exact</strong> matching:
</p>
<ul>
  <li><strong>Fuzzy</strong> — the value is matched as a substring
      (case-insensitive). Useful for partial matches like "backend" to
      find "acme/backend-api".</li>
  <li><strong>Exact</strong> — the value must match exactly. Shown with
      quotes in the filter summary (e.g. <code>"acme/backend-api"</code>).</li>
</ul>

<h3 id="multiselect-filters">Multi-Select Filters</h3>

<p>
  Multi-select fields (Role, Review Status, CI Status, Merge Status) open
  a checkbox list. Press <kbd>Enter</kbd> or <kbd>Space</kbd> to toggle
  each option. Press <kbd>Esc</kbd> to apply and return to the field list.
</p>

${filterMultiselect}

<h3 id="filter-presets">Filter Presets</h3>

<p>
  Once you have a useful filter combination, select <strong>+ Save as
  preset</strong> in the filter modal to name and save it. Saved presets
  appear at the top of the filter list with a <code>★</code> marker. Press
  <kbd>d</kbd> on a preset to delete it. Presets are stored per-view in
  your git-switchboard config file.
</p>

<h2 id="text-search">Text Search</h2>

<p>
  Press <kbd>/</kbd> in either the PR dashboard or the branch picker to
  enter search mode. Type your query — results filter in real time. The
  search matches against:
</p>
<ul>
  <li><strong>PR dashboard</strong> — PR title, repository ID, head branch,
      author, and linked Linear issue identifiers.</li>
  <li><strong>Branch picker</strong> — branch name and linked Linear issue
      identifiers.</li>
</ul>
<p>
  Press <kbd>Esc</kbd> to clear the search and exit search mode. Press
  <kbd>Enter</kbd>, <kbd>Tab</kbd>, or an arrow key to keep the filter
  active and return to normal navigation.
</p>

<h2 id="branch-author-filter">Branch Picker Author Filter</h2>

${branchPicker}

<p>
  The branch picker has a built-in author filter. Press <kbd>a</kbd> to
  cycle through:
</p>
<ul>
  <li><strong>All</strong> — show all branches.</li>
  <li><strong>Me</strong> — show only branches authored by the current Git user.</li>
  <li><strong>Team</strong> — show branches from a predefined author list
      (configured via <code>--author</code> flags).</li>
</ul>
`.trim();

  return {
    slug: 'guide/filtering',
    title: 'Filtering & Search',
    description: 'Structured filters, text search, filter presets, and branch author filtering.',
    order: 1.8,
    content: '',
    renderedHtml,
    headings: [
      { id: 'structured-filters', text: 'Structured Filters', level: 2 },
      { id: 'string-filters', text: 'String Filters', level: 3 },
      { id: 'multiselect-filters', text: 'Multi-Select Filters', level: 3 },
      { id: 'filter-presets', text: 'Filter Presets', level: 3 },
      { id: 'text-search', text: 'Text Search', level: 2 },
      { id: 'branch-author-filter', text: 'Branch Picker Author Filter', level: 2 },
    ],
  };
}

function generateProvidersPage(frames: FrameMap): DocPage {
  const connectList = frames.connectList
    ? frameToHtml(frames.connectList, 'Provider list screenshot')
    : '';
  const connectDetail = frames.connectDetail
    ? frameToHtml(frames.connectDetail, 'Provider detail screenshot')
    : '';
  const connectSetup = frames.connectSetup
    ? frameToHtml(frames.connectSetup, 'Provider setup screenshot')
    : '';

  const renderedHtml = `
<p>
  git-switchboard integrates with external services via <em>providers</em>.
  Run <code>git-switchboard connect</code> to view and manage your
  connections.
</p>

<h2 id="provider-list">Provider List</h2>

<p>
  The provider list shows all available integrations with their current
  connection status. A green <code>✓</code> means the token is configured;
  a red <code>✗</code> means it is not.
</p>

${connectList}

<p>
  Press <kbd>Enter</kbd> on a provider to view its details or set up a
  new token.
</p>

<h2 id="supported-providers">Supported Providers</h2>

<table style="--cols: 3">
  <thead>
    <tr><th>Provider</th><th>Used For</th><th>Env Variables</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>GitHub</td>
      <td>Fetching PRs, CI status, reviews, retrying checks</td>
      <td><code>GH_TOKEN</code>, <code>GITHUB_TOKEN</code></td>
    </tr>
    <tr>
      <td>Linear</td>
      <td>Linking Linear issues to branches and PRs</td>
      <td><code>LINEAR_TOKEN</code></td>
    </tr>
  </tbody>
</table>

<h2 id="provider-detail">Provider Detail</h2>

<p>
  The detail view shows the connection status, authenticated identity, and
  a link to the provider's token settings page. If the token was stored via
  git-switchboard (rather than an environment variable), you can press
  <kbd>d</kbd> to disconnect it.
</p>

${connectDetail}

<h2 id="token-setup">Setting Up a Token</h2>

<p>
  Press <kbd>s</kbd> from the provider detail view (or select a provider
  when running <code>git-switchboard connect &lt;provider&gt;</code>) to
  start the setup flow. You'll choose a storage strategy:
</p>

${connectSetup}

<h3 id="storage-strategies">Storage Strategies</h3>

<table style="--cols: 2">
  <thead>
    <tr><th>Strategy</th><th>Description</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Environment variable</strong></td>
      <td>Reads the token from an env var you specify (e.g.
          <code>GH_TOKEN</code>). The variable must be set in your
          shell profile. git-switchboard validates it on setup and reads
          it at each launch.</td>
    </tr>
    <tr>
      <td><strong>Encrypted (machine-locked)</strong></td>
      <td>The token is encrypted and stored in
          <code>~/.config/git-switchboard/</code>. Decryption is tied to
          your machine — no password needed, but the file can't be
          copied to another computer.</td>
    </tr>
    <tr>
      <td><strong>Encrypted (password-protected)</strong></td>
      <td>Like machine-locked, but also requires a password you choose.
          You'll be prompted for the password each time git-switchboard
          launches.</td>
    </tr>
    <tr>
      <td><strong>Shell command</strong></td>
      <td>Runs a shell command each launch to fetch the token. Useful
          for integrations with secret managers like <code>1password</code>,
          <code>vault</code>, or <code>pass</code>.</td>
    </tr>
  </tbody>
</table>

<h2 id="token-resolution">Token Resolution Order</h2>

<p>
  When git-switchboard needs a token, it checks sources in this order:
</p>
<ol>
  <li>CLI flag (e.g. <code>--github-token</code>)</li>
  <li>Configured strategy in <code>~/.config/git-switchboard/config.json</code></li>
  <li>Environment variables (e.g. <code>GH_TOKEN</code>, <code>GITHUB_TOKEN</code>)</li>
  <li>Fallback command (GitHub only: <code>gh auth token</code>)</li>
</ol>
<p>
  The first source that provides a non-empty value wins. Run
  <code>git-switchboard connect</code> and select a provider to see which
  source is currently active.
</p>
`.trim();

  return {
    slug: 'guide/providers',
    title: 'Provider Connections',
    description: 'Set up GitHub and Linear tokens using encrypted storage, env vars, or shell commands.',
    order: 1.9,
    content: '',
    renderedHtml,
    headings: [
      { id: 'provider-list', text: 'Provider List', level: 2 },
      { id: 'supported-providers', text: 'Supported Providers', level: 2 },
      { id: 'provider-detail', text: 'Provider Detail', level: 2 },
      { id: 'token-setup', text: 'Setting Up a Token', level: 2 },
      { id: 'storage-strategies', text: 'Storage Strategies', level: 3 },
      { id: 'token-resolution', text: 'Token Resolution Order', level: 2 },
    ],
  };
}

export async function generateWorkflowDocs(): Promise<DocPage[]> {
  try {
    const framePath = join(process.cwd(), 'generated', 'terminal-frame.json');
    const raw = await readFile(framePath, 'utf-8');
    const frames = JSON.parse(raw) as FrameMap;

    return [
      generatePrWorkflowPage(frames),
      generateColumnsPage(frames),
      generateSortingPage(frames),
      generateFilteringPage(frames),
      generateProvidersPage(frames),
    ];
  } catch (err) {
    console.warn(
      '[docs-site] Failed to generate workflow docs:',
      (err as Error).message
    );
    return [];
  }
}

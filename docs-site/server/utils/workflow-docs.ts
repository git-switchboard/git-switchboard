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

export async function generateWorkflowDocs(): Promise<DocPage[]> {
  try {
    const framePath = join(process.cwd(), 'generated', 'terminal-frame.json');
    const raw = await readFile(framePath, 'utf-8');
    const frames = JSON.parse(raw) as {
      branchPicker?: TerminalFrame;
      prDashboard?: TerminalFrame;
      prDetail?: TerminalFrame;
      clonePrompt?: TerminalFrame;
    };

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

    const headings = [
      { id: 'pr-dashboard', text: 'PR Dashboard', level: 2 },
      { id: 'pr-detail', text: 'PR Detail View', level: 2 },
      { id: 'clone-prompt', text: 'Opening a PR in Your Editor', level: 2 },
    ];

    return [
      {
        slug: 'guide/pr-workflow',
        title: 'PR Workflow',
        description: 'How to navigate from the PR dashboard to CI details and open a PR in your editor.',
        order: 1.5,
        content: '',
        renderedHtml,
        headings,
      },
    ];
  } catch (err) {
    console.warn(
      '[docs-site] Failed to generate workflow docs:',
      (err as Error).message
    );
    return [];
  }
}

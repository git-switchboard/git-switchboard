import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DocPage } from './docs';

interface CliOption {
  key: string;
  type: string;
  description?: string;
  default?: unknown;
  alias?: string[];
  items?: string;
}

interface CliDocumentation {
  name: string;
  description?: string;
  usage: string;
  options: Record<string, CliOption>;
  subcommands: CliDocumentation[];
}

/** Keyboard shortcuts — hardcoded since they live in the TUI, not the CLI definition. */
const BRANCH_PICKER_KEYS = [
  { key: 'Up/Down or j/k', action: 'Navigate' },
  { key: 'Enter', action: 'Checkout selected branch' },
  { key: '/', action: 'Search' },
  { key: 'r', action: 'Toggle remote branches' },
  { key: 'a', action: 'Cycle author filter' },
  { key: 'q or Esc', action: 'Quit' },
];

const PR_DASHBOARD_KEYS = [
  { key: 'Up/Down or j/k', action: 'Navigate' },
  { key: 'Enter', action: 'Select PR (clone, checkout, open in editor)' },
  { key: 'c', action: 'Fetch/refresh CI status' },
  { key: '/', action: 'Search' },
  { key: 'q or Esc', action: 'Quit' },
];

const PR_DETAIL_KEYS = [
  { key: 'Enter', action: 'Open in editor' },
  { key: 'c', action: 'Copy check logs' },
  { key: 'r', action: 'Refresh CI' },
  { key: 't', action: 'Retry failed checks' },
  { key: 'w', action: 'Toggle watch mode' },
  { key: 'Left or Esc', action: 'Back to list' },
];

function renderOptionsTable(options: Record<string, CliOption>): string {
  const userOptions = Object.values(options).filter(
    (o) => o.key !== 'help' && o.key !== 'version'
  );
  if (userOptions.length === 0) return '';

  const rows = userOptions.map((opt) => {
    const flags: string[] = [];
    if (opt.alias) {
      for (const a of opt.alias) {
        flags.push(`-${a}`);
      }
    }
    flags.push(`--${opt.key}`);
    if (opt.type === 'string') flags[flags.length - 1] += ' &lt;value&gt;';
    if (opt.type === 'array') flags[flags.length - 1] += ' &lt;value...&gt;';
    if (opt.type === 'number') flags[flags.length - 1] += ' &lt;n&gt;';

    const flagStr = flags.map((f) => `<code>${f}</code>`).join(', ');
    const desc = opt.description ?? '';
    const defaultVal =
      opt.default !== undefined
        ? ` <span class="text-xs text-switch-text-dim">(default: <code>${JSON.stringify(opt.default)}</code>)</span>`
        : '';

    return `<tr><td>${flagStr}</td><td>${desc}${defaultVal}</td></tr>`;
  });

  return `<table><thead><tr><th>Flag</th><th>Description</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function renderKeybindTable(
  keys: { key: string; action: string }[]
): string {
  const rows = keys
    .map(
      (k) =>
        `<tr><td><code>${k.key}</code></td><td>${k.action}</td></tr>`
    )
    .join('');
  return `<table><thead><tr><th>Key</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderCliDocsToHtml(doc: CliDocumentation): string {
  const parts: string[] = [];

  // Branch Picker (root command)
  parts.push(`<h2 id="branch-picker">Branch Picker (default)</h2>`);
  parts.push(`<p>${doc.description}</p>`);
  parts.push(
    `<pre><code class="language-sh">${doc.usage}</code></pre>`
  );
  parts.push(`<h3 id="branch-picker-options">Options</h3>`);
  parts.push(renderOptionsTable(doc.options));
  parts.push(`<h3 id="branch-picker-keyboard">Keyboard shortcuts</h3>`);
  parts.push(renderKeybindTable(BRANCH_PICKER_KEYS));

  // PR Dashboard subcommand
  const prCmd = doc.subcommands.find((s) => s.name === 'pr');
  if (prCmd) {
    parts.push(`<h2 id="pr-dashboard">PR Dashboard</h2>`);
    parts.push(`<p>${prCmd.description}</p>`);
    parts.push(
      `<pre><code class="language-sh">${prCmd.usage}</code></pre>`
    );
    parts.push(`<h3 id="pr-dashboard-options">Options</h3>`);
    parts.push(renderOptionsTable(prCmd.options));
    parts.push(`<h3 id="pr-dashboard-keyboard">Keyboard shortcuts</h3>`);
    parts.push(renderKeybindTable(PR_DASHBOARD_KEYS));
    parts.push(`<h3 id="pr-detail-view">PR Detail View</h3>`);
    parts.push(renderKeybindTable(PR_DETAIL_KEYS));
  }

  return parts.join('\n');
}

function extractHeadingsFromHtml(
  html: string
): { id: string; text: string; level: number }[] {
  const headings: { id: string; text: string; level: number }[] = [];
  const regex = /<h([23])\s[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/h\1>/gi;
  for (const match of html.matchAll(regex)) {
    headings.push({
      level: parseInt(match[1], 10),
      id: match[2],
      text: match[3].replace(/<[^>]+>/g, '').trim(),
    });
  }
  return headings;
}

/**
 * Load CLI docs JSON and produce a DocPage for the usage page.
 */
export async function generateUsageDoc(): Promise<DocPage | null> {
  try {
    const cliDocsPath = join(process.cwd(), 'generated', 'cli-docs.json');
    const raw = await readFile(cliDocsPath, 'utf-8');
    const doc: CliDocumentation = JSON.parse(raw);
    const renderedHtml = renderCliDocsToHtml(doc);
    return {
      slug: 'usage',
      title: 'Usage',
      description: 'Commands, options, and keyboard shortcuts.',
      order: 2,
      content: '',
      renderedHtml,
      headings: extractHeadingsFromHtml(renderedHtml),
    };
  } catch (err) {
    console.warn(
      '[docs-site] Failed to generate usage doc from CLI docs:',
      (err as Error).message
    );
    return null;
  }
}

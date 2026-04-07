import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyBaseUrl } from '../../utils/base-url';
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

interface KeybindingEntry {
  key: string;
  action: string;
}

type KeybindingsMap = Record<string, Record<string, KeybindingEntry[]>>;

function viewKeys(keybindings: KeybindingsMap, commandName: string, viewName: string): KeybindingEntry[] {
  return keybindings[commandName]?.[viewName] ?? [];
}

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

  return `<table style="--cols: 2"><thead><tr><th>Flag</th><th>Description</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
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
  return `<table style="--cols: 2"><thead><tr><th>Key</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`;
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

function renderRootCommandPage(doc: CliDocumentation, keybindings: KeybindingsMap): string {
  const parts: string[] = [];
  parts.push(`<p>${doc.description ?? ''}</p>`);
  parts.push(`<pre><code class="language-sh">${doc.usage}</code></pre>`);
  parts.push(`<h2 id="options">Options</h2>`);
  parts.push(renderOptionsTable(doc.options));
  parts.push(`<h2 id="keyboard-shortcuts">Keyboard shortcuts</h2>`);
  parts.push(renderKeybindTable(viewKeys(keybindings, 'default', 'branch-picker')));
  return parts.join('\n');
}

function renderPrCommandPage(prCmd: CliDocumentation, keybindings: KeybindingsMap): string {
  const parts: string[] = [];
  parts.push(`<p>${prCmd.description ?? ''}</p>`);
  parts.push(`<pre><code class="language-sh">${prCmd.usage}</code></pre>`);
  parts.push(`<h2 id="options">Options</h2>`);
  parts.push(renderOptionsTable(prCmd.options));
  parts.push(`<h2 id="pr-dashboard-keyboard">PR Dashboard keyboard shortcuts</h2>`);
  parts.push(renderKeybindTable(viewKeys(keybindings, 'pr', 'pr-list')));
  parts.push(`<h2 id="pr-detail-view">PR Detail View keyboard shortcuts</h2>`);
  parts.push(renderKeybindTable(viewKeys(keybindings, 'pr', 'pr-detail')));
  return parts.join('\n');
}

function renderUsageIndexPage(doc: CliDocumentation): string {
  const commands: { slug: string; name: string; description: string }[] = [
    {
      slug: 'usage/git-switchboard',
      name: 'git-switchboard',
      description: doc.description ?? 'Interactive branch picker TUI.',
    },
  ];

  for (const sub of doc.subcommands) {
    if (sub.name === 'pr') {
      commands.push({
        slug: 'usage/pr',
        name: 'git-switchboard pr',
        description: sub.description ?? 'PR dashboard TUI.',
      });
    }
  }

  const rows = commands
    .map((cmd) => {
      const href = applyBaseUrl(`/docs/${cmd.slug}`);
      return `<tr style="cursor:pointer" onclick="window.location.href='${href}'"><td><code>${cmd.name}</code></td><td>${cmd.description}</td></tr>`;
    })
    .join('');

  return `<p>Reference for all <code>git-switchboard</code> commands. Select a command below to view its options and keyboard shortcuts.</p>
<table class="cmd-index-table" style="--cols: 2"><thead><tr><th>Command</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table>
<style>.cmd-index-table tbody tr:hover td { background: rgba(212,146,10,0.07); }</style>`;
}

/**
 * Load CLI docs JSON and produce DocPages for each command.
 * Returns: usage (index), usage/git-switchboard, usage/pr (if present)
 */
export async function generateUsageDocs(): Promise<DocPage[]> {
  try {
    const generatedDir = join(process.cwd(), 'generated');
    const [cliRaw, keybindingsRaw] = await Promise.all([
      readFile(join(generatedDir, 'cli-docs.json'), 'utf-8'),
      readFile(join(generatedDir, 'keybindings.json'), 'utf-8'),
    ]);
    const doc: CliDocumentation = JSON.parse(cliRaw);
    const keybindings: KeybindingsMap = JSON.parse(keybindingsRaw);

    const pages: DocPage[] = [];

    // Index page
    const indexHtml = renderUsageIndexPage(doc);
    pages.push({
      slug: 'usage',
      title: 'CLI Reference',
      description: 'Commands, options, and keyboard shortcuts.',
      order: 2,
      content: '',
      renderedHtml: indexHtml,
      headings: extractHeadingsFromHtml(indexHtml),
    });

    // Root command page
    const rootHtml = renderRootCommandPage(doc, keybindings);
    pages.push({
      slug: 'usage/git-switchboard',
      title: 'git-switchboard',
      description: doc.description ?? 'Interactive branch picker TUI.',
      order: 2.1,
      content: '',
      renderedHtml: rootHtml,
      headings: extractHeadingsFromHtml(rootHtml),
    });

    // PR subcommand page
    const prCmd = doc.subcommands.find((s) => s.name === 'pr');
    if (prCmd) {
      const prHtml = renderPrCommandPage(prCmd, keybindings);
      pages.push({
        slug: 'usage/pr',
        title: 'git-switchboard pr',
        description: prCmd.description ?? 'PR dashboard TUI.',
        order: 2.2,
        content: '',
        renderedHtml: prHtml,
        headings: extractHeadingsFromHtml(prHtml),
      });
    }

    return pages;
  } catch (err) {
    console.warn(
      '[docs-site] Failed to generate usage docs from CLI docs:',
      (err as Error).message
    );
    return [];
  }
}

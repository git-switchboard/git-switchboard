import matter from 'gray-matter';
import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { renderMarkdown, stripH1 } from './markdown';

export interface TocEntry {
  id: string;
  text: string;
  level: number;
}

export interface DocPage {
  slug: string;
  title: string;
  description: string;
  order: number;
  content: string;
  renderedHtml: string;
  headings: TocEntry[];
}

export interface NavigationItem {
  title: string;
  path?: string;
  order?: number;
  children?: NavigationItem[];
}

/**
 * Extract h2 and h3 headings (with id attributes) from rendered HTML.
 */
export function extractHeadings(html: string): TocEntry[] {
  const headings: TocEntry[] = [];
  const regex = /<h([23])\s[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/h\1>/gi;
  for (const match of html.matchAll(regex)) {
    const level = parseInt(match[1], 10);
    const id = match[2];
    const text = match[3].replace(/<[^>]+>/g, '').trim();
    headings.push({ id, text, level });
  }
  return headings;
}

/**
 * Scan docs directory for markdown files, parse frontmatter, and render to HTML.
 */
export async function scanAndRenderDocs(
  docsDir: string
): Promise<DocPage[]> {
  let entries: string[];
  try {
    entries = (await readdir(docsDir)) as string[];
  } catch {
    console.warn('[docs-site] No docs directory found at', docsDir);
    return [];
  }

  const pages: DocPage[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;

    const filePath = join(docsDir, entry);
    const raw = await readFile(filePath, 'utf-8');
    const { data, content } = matter(raw);

    const slug = basename(entry, extname(entry));

    let renderedHtml = '';
    try {
      renderedHtml = stripH1(await renderMarkdown(content));
    } catch (err) {
      console.warn(
        `[docs-site] Markdown rendering failed for "${slug}":`,
        (err as Error).message
      );
    }

    pages.push({
      slug,
      title: (data.title as string) ?? slug,
      description: (data.description as string) ?? '',
      order: (data.order as number) ?? 999,
      content,
      renderedHtml,
      headings: extractHeadings(renderedHtml),
    });
  }

  return pages.sort((a, b) => a.order - b.order);
}

/**
 * Build sidebar navigation from scanned docs.
 * Pages with slugs matching `usage/*` are grouped under a "CLI Reference" section.
 */
export function buildNavigation(docs: DocPage[]): NavigationItem[] {
  const cliIndexDoc = docs.find((d) => d.slug === 'usage');
  const cliSubDocs = docs
    .filter((d) => d.slug.startsWith('usage/'))
    .sort((a, b) => a.order - b.order);

  const guideDocs = docs
    .filter((d) => d.slug.startsWith('guide/'))
    .sort((a, b) => a.order - b.order);

  const regularDocs = docs.filter(
    (d) =>
      d.slug !== 'usage' &&
      !d.slug.startsWith('usage/') &&
      !d.slug.startsWith('guide/')
  );

  const regularItems: NavigationItem[] = regularDocs.map((doc) => ({
    title: doc.title,
    path: `/docs/${doc.slug}`,
    order: doc.order,
  }));

  const nav: NavigationItem[] = [
    { title: 'Overview', path: '/docs', order: 0 },
    ...regularItems,
  ];

  if (guideDocs.length > 0) {
    const minOrder = Math.min(...guideDocs.map((d) => d.order));
    nav.push({
      title: 'Guides',
      order: minOrder,
      children: guideDocs.map((doc) => ({
        title: doc.title,
        path: `/docs/${doc.slug}`,
        order: doc.order,
      })),
    });
  }

  if (cliIndexDoc || cliSubDocs.length > 0) {
    nav.push({
      title: 'CLI Reference',
      order: cliIndexDoc?.order ?? 2,
      path: cliIndexDoc ? `/docs/${cliIndexDoc.slug}` : undefined,
      children: cliSubDocs.map((doc) => ({
        title: doc.title,
        path: `/docs/${doc.slug}`,
        order: doc.order,
      })),
    });
  }

  return nav.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

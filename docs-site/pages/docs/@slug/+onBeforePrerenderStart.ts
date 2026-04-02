import type { OnBeforePrerenderStartAsync } from 'vike/types';
import { join, basename, extname } from 'node:path';
import { readdir, access } from 'node:fs/promises';

const onBeforePrerenderStart: OnBeforePrerenderStartAsync = async () => {
  const docsDir = join(process.cwd(), '..', 'docs');
  const routes: string[] = [];

  // Markdown docs from the docs/ directory
  try {
    const entries = await readdir(docsDir);
    for (const entry of entries) {
      if (entry.endsWith('.md')) {
        routes.push(`/docs/${basename(entry, extname(entry))}`);
      }
    }
  } catch {
    // No docs directory
  }

  // Generated usage page from CLI docs JSON
  try {
    await access(join(process.cwd(), 'generated', 'cli-docs.json'));
    if (!routes.includes('/docs/usage')) {
      routes.push('/docs/usage');
    }
  } catch {
    // No CLI docs generated
  }

  return routes;
};

export default onBeforePrerenderStart;

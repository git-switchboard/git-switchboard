import type { OnBeforePrerenderStartAsync } from 'vike/types';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { basename, extname } from 'node:path';

const onBeforePrerenderStart: OnBeforePrerenderStartAsync = async () => {
  const docsDir = join(process.cwd(), 'docs');
  let entries: string[];
  try {
    entries = await readdir(docsDir);
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => `/docs/${basename(entry, extname(entry))}`);
};

export default onBeforePrerenderStart;

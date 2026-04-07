import type { OnBeforePrerenderStartAsync } from 'vike/types';
import { join, basename, extname } from 'node:path';
import { readdir, access, readFile } from 'node:fs/promises';
import { generateWorkflowDocs } from '../../../server/utils/workflow-docs';

interface CliSubcommand {
  name: string;
}

interface CliDocumentation {
  subcommands: CliSubcommand[];
}

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

  // Generated usage pages from CLI docs JSON
  try {
    const cliDocsPath = join(process.cwd(), 'generated', 'cli-docs.json');
    await access(cliDocsPath);
    const raw = await readFile(cliDocsPath, 'utf-8');
    const doc: CliDocumentation = JSON.parse(raw);

    routes.push('/docs/usage');
    routes.push('/docs/usage/git-switchboard');
    for (const sub of doc.subcommands ?? []) {
      routes.push(`/docs/usage/${sub.name}`);
    }
  } catch {
    // No CLI docs generated
  }

  // Generated workflow guide pages
  try {
    const workflowPages = await generateWorkflowDocs();
    for (const page of workflowPages) {
      routes.push(`/docs/${page.slug}`);
    }
  } catch {
    // No workflow docs generated
  }

  return routes;
};

export default onBeforePrerenderStart;

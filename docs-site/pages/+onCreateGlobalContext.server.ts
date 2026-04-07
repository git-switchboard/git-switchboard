import { join } from 'node:path';
import {
  buildNavigation,
  scanAndRenderDocs,
  type DocPage,
  type NavigationItem,
} from '../server/utils/docs';
import { generateUsageDocs } from '../server/utils/cli-docs';
import { generateWorkflowDocs } from '../server/utils/workflow-docs';

export async function onCreateGlobalContext(
  context: Partial<GlobalContextServer>
): Promise<void> {
  const docsDir = join(process.cwd(), '..', 'docs');
  const [scannedDocs, usageDocs, workflowDocs] = await Promise.all([
    scanAndRenderDocs(docsDir),
    generateUsageDocs(),
    generateWorkflowDocs(),
  ]);
  const docs = [...scannedDocs, ...usageDocs, ...workflowDocs].sort(
    (a, b) => a.order - b.order
  );
  const navigation = buildNavigation(docs);

  (context as Record<string, unknown>).docs = Object.fromEntries(
    docs.map((d) => [d.slug, d])
  );
  (context as Record<string, unknown>).navigation = navigation;
}

type GlobalContextServer = {
  docs: Record<string, DocPage>;
  navigation: NavigationItem[];
};

declare global {
  namespace Vike {
    interface GlobalContextServer {
      docs: Record<string, DocPage>;
      navigation: NavigationItem[];
    }
    interface GlobalContextClient {
      navigation: NavigationItem[];
    }
  }
}

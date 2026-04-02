import { join } from 'node:path';
import {
  buildNavigation,
  scanAndRenderDocs,
  type DocPage,
  type NavigationItem,
} from '../server/utils/docs';
import { generateUsageDoc } from '../server/utils/cli-docs';

export async function onCreateGlobalContext(
  context: Partial<GlobalContextServer>
): Promise<void> {
  const docsDir = join(process.cwd(), '..', 'docs');
  const [scannedDocs, usageDoc] = await Promise.all([
    scanAndRenderDocs(docsDir),
    generateUsageDoc(),
  ]);
  const docs = [...scannedDocs, ...(usageDoc ? [usageDoc] : [])].sort(
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

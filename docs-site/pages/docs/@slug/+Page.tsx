import { useData } from 'vike-react/useData';
import { Link } from '../../../components/Link';
import type { DocDetailData } from './+data';

export default function DocDetailPage() {
  const { doc } = useData<DocDetailData>();

  if (!doc) {
    return (
      <div className="text-center py-20">
        <h1 className="text-2xl font-bold text-switch-text-bright mb-2">
          Page Not Found
        </h1>
        <p className="text-switch-text-dim mb-4">
          The requested documentation page could not be found.
        </p>
        <Link
          href="/docs"
          className="text-switch-accent hover:text-switch-accent-bright underline"
        >
          Back to Documentation
        </Link>
      </div>
    );
  }

  return (
    <div className="flex gap-8">
      <div className="flex-1 min-w-0">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-switch-text-dim mb-6">
          <Link href="/docs" className="hover:text-switch-text">
            Docs
          </Link>
          <span>/</span>
          <span className="text-switch-text">{doc.title}</span>
        </nav>

        <h1 className="text-3xl font-bold text-switch-text-bright mb-6">
          {doc.title}
        </h1>

        <div
          className="prose-content"
          dangerouslySetInnerHTML={{ __html: doc.renderedHtml }}
        />
      </div>

      {doc.headings.length > 0 && (
        <aside className="hidden xl:block w-56 shrink-0">
          <div className="sticky top-20">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-switch-text-dim mb-3">
              On this page
            </h4>
            <nav className="space-y-1">
              {doc.headings.map((heading) => (
                <a
                  key={heading.id}
                  href={`#${heading.id}`}
                  className={`block text-sm text-switch-text-dim hover:text-switch-accent transition-colors ${
                    heading.level === 3 ? 'pl-3' : ''
                  }`}
                >
                  {heading.text}
                </a>
              ))}
            </nav>
          </div>
        </aside>
      )}
    </div>
  );
}

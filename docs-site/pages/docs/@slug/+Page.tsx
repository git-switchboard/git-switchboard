import { useData } from 'vike-react/useData';
import { Link } from '../../../components/Link';
import type { DocDetailData } from './+data';

export default function DocDetailPage() {
  const { doc } = useData<DocDetailData>();

  if (!doc) {
    return (
      <div className="text-center py-24 animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-switch-bg-raised border border-switch-border flex items-center justify-center mx-auto mb-6">
          <svg
            className="w-7 h-7 text-switch-text-dim"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-switch-text-bright mb-2">
          Page Not Found
        </h1>
        <p className="text-switch-text-dim mb-6 text-sm">
          The requested documentation page could not be found.
        </p>
        <Link
          href="/docs"
          className="inline-flex items-center gap-2 text-switch-accent hover:text-switch-accent-bright transition-colors text-sm"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 17l-5-5m0 0l5-5m-5 5h12"
            />
          </svg>
          Back to Documentation
        </Link>
      </div>
    );
  }

  return (
    <div className="flex gap-10 animate-fade-in">
      <article className="flex-1 min-w-0">
        {/* Breadcrumb */}
        <nav className="inline-flex items-center gap-2 text-xs text-switch-text-dim mb-8 px-3 py-1.5 rounded-full bg-switch-bg-raised/50 border border-switch-border">
          <svg
            className="w-3 h-3 text-switch-accent/50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <Link
            href="/docs"
            className="hover:text-switch-accent transition-colors"
          >
            Docs
          </Link>
          <svg
            className="w-3 h-3 text-switch-border-light"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          <span className="text-switch-text font-medium">{doc.title}</span>
        </nav>

        <h1 className="text-3xl md:text-4xl font-bold text-switch-text-bright mb-2 tracking-tight">
          {doc.title}
        </h1>

        {doc.description && (
          <p className="text-switch-text-dim text-sm mb-8 max-w-xl">
            {doc.description}
          </p>
        )}

        {/* Accent line separator */}
        <div className="h-px bg-gradient-to-r from-switch-accent/40 via-switch-accent/10 to-transparent mb-10" />

        <div
          className="prose-content"
          dangerouslySetInnerHTML={{ __html: doc.renderedHtml }}
        />

        {/* Bottom navigation hint */}
        <div className="mt-16 pt-8 border-t border-switch-border">
          <Link
            href="/docs"
            className="inline-flex items-center gap-2 text-sm text-switch-text-dim hover:text-switch-accent transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 17l-5-5m0 0l5-5m-5 5h12"
              />
            </svg>
            Back to all docs
          </Link>
        </div>
      </article>

      {doc.headings.length > 0 && (
        <aside className="hidden xl:block w-56 shrink-0">
          <div className="sticky top-20">
            <h4 className="text-[10px] font-semibold uppercase tracking-widest text-switch-text-dim/60 mb-4 flex items-center gap-2">
              <span className="w-4 h-px bg-switch-accent/30" />
              On this page
            </h4>
            <nav className="space-y-0.5">
              {doc.headings.map((heading) => (
                <a
                  key={heading.id}
                  href={`#${heading.id}`}
                  className={`toc-link block text-xs py-1 transition-colors ${
                    heading.level === 3
                      ? 'pl-5 text-switch-text-dim/70 hover:text-switch-accent'
                      : 'text-switch-text-dim hover:text-switch-accent'
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

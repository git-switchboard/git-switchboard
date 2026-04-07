import { useData } from 'vike-react/useData';
import { Link } from '../../components/Link';
import { StatusDot } from '../../components/ui';
import type { DocsData } from './+data';

export default function DocsPage() {
  const { docs } = useData<DocsData>();

  return (
    <div className="animate-fade-in-up">
      {/* Page header */}
      <div className="flex items-start gap-4 mb-10">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <StatusDot color="blue" />
            <span className="telem-key">Documentation</span>
          </div>
          <h1
            className="text-switch-text-bright mb-1"
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '2.5rem',
              letterSpacing: '0.08em',
            }}
          >
            Reference
          </h1>
          <p className="text-switch-text-dim text-sm leading-relaxed max-w-xl">
            Guides and references for installing and using git-switchboard.
          </p>
        </div>
        <div className="ml-auto hidden md:block">
          <div className="telem-cell text-right">
            <span className="telem-key">Modules</span>
            <span className="telem-val">{docs.length} LOADED</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 stagger-children">
        {docs.map((doc) => (
          <Link
            key={doc.slug}
            href={`/docs/${doc.slug}`}
            className="block no-underline"
          >
            <div className="card-glow border border-switch-border p-5 bg-switch-bg-raised/20 h-full transition-all">
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center gap-1 shrink-0 mt-0.5">
                  <span className="status-dot blue" />
                </div>
                <div>
                  <h3
                    className="text-sm font-semibold text-switch-text-bright mb-1 uppercase tracking-wider"
                    style={{ letterSpacing: '0.06em' }}
                  >
                    {doc.title}
                  </h3>
                  {doc.description && (
                    <p className="text-sm text-switch-text-dim leading-relaxed">
                      {doc.description}
                    </p>
                  )}
                </div>
                <svg
                  className="w-4 h-4 text-switch-text-dim/40 shrink-0 ml-auto mt-0.5"
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
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

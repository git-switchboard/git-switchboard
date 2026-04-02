import { useData } from 'vike-react/useData';
import { Link } from '../../components/Link';
import type { DocsData } from './+data';

export default function DocsPage() {
  const { docs } = useData<DocsData>();

  return (
    <div className="animate-fade-in-up">
      <h1 className="text-3xl font-bold text-switch-text-bright mb-2 tracking-tight">
        Documentation
      </h1>
      <p className="text-switch-text-dim mb-10 max-w-2xl text-sm leading-relaxed">
        Guides and references for installing and using git-switchboard.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 stagger-children">
        {docs.map((doc) => (
          <Link
            key={doc.slug}
            href={`/docs/${doc.slug}`}
            className="block no-underline"
          >
            <div className="card-glow border border-switch-border rounded-xl p-5 bg-switch-bg-raised/20 h-full">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-switch-accent/10 border border-switch-accent/20 flex items-center justify-center text-switch-accent shrink-0 mt-0.5">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-switch-text-bright mb-1">
                    {doc.title}
                  </h3>
                  {doc.description && (
                    <p className="text-sm text-switch-text-dim leading-relaxed">
                      {doc.description}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

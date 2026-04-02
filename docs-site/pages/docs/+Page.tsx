import { useData } from 'vike-react/useData';
import { Link } from '../../components/Link';
import type { DocsData } from './+data';

export default function DocsPage() {
  const { docs } = useData<DocsData>();

  return (
    <div>
      <h1 className="text-3xl font-bold text-switch-text-bright mb-3">
        Documentation
      </h1>
      <p className="text-switch-text-dim mb-8 max-w-2xl">
        Guides and references for git-switchboard.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {docs.map((doc) => (
          <Link
            key={doc.slug}
            href={`/docs/${doc.slug}`}
            className="block no-underline"
          >
            <div className="border border-switch-border rounded p-4 hover:bg-switch-bg-raised/50 transition-colors h-full">
              <h3 className="text-base font-semibold text-switch-accent-bright mb-1">
                {doc.title}
              </h3>
              {doc.description && (
                <p className="text-sm text-switch-text-dim leading-relaxed">
                  {doc.description}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

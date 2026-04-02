import { Link } from '../../components/Link';

export default function LandingPage() {
  return (
    <div>
      <HeroSection />
      <InstallSection />
      <FeatureHighlights />
    </div>
  );
}

function HeroSection() {
  return (
    <section className="py-20 md:py-32 text-center px-4">
      <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-switch-text-bright mb-4">
        git-switchboard
      </h1>
      <p className="text-lg md:text-xl text-switch-text-dim max-w-2xl mx-auto mb-8">
        An interactive TUI for browsing and checking out git branches, with
        GitHub PR integration.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Link
          href="/docs/installation"
          className="inline-block px-6 py-2.5 bg-switch-accent text-switch-bg font-medium rounded-lg hover:bg-switch-accent-bright transition-colors no-underline"
        >
          Get Started
        </Link>
        <a
          href="https://github.com/git-switchboard/git-switchboard"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block px-6 py-2.5 border border-switch-border text-switch-text-dim font-medium rounded-lg hover:border-switch-accent hover:text-switch-accent transition-colors no-underline"
        >
          View on GitHub
        </a>
      </div>
    </section>
  );
}

function InstallSection() {
  return (
    <section className="py-12 px-4 max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-switch-text-bright mb-6 text-center">
        Quick Install
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <InstallCard
          title="Homebrew"
          subtitle="macOS / Linux"
          command="brew tap git-switchboard/tap && brew install git-switchboard"
        />
        <InstallCard
          title="Chocolatey"
          subtitle="Windows"
          command="choco install git-switchboard"
        />
        <InstallCard
          title="Install Script"
          subtitle="macOS / Linux"
          command="curl -fsSL https://raw.githubusercontent.com/git-switchboard/git-switchboard/main/packaging/install.sh | sh"
        />
        <InstallCard
          title="npm"
          subtitle="Requires Bun runtime"
          command="npx git-switchboard"
        />
      </div>
    </section>
  );
}

function InstallCard({
  title,
  subtitle,
  command,
}: {
  title: string;
  subtitle: string;
  command: string;
}) {
  return (
    <div className="bg-switch-bg-raised border border-switch-border rounded-lg p-4">
      <div className="mb-2">
        <span className="text-sm font-semibold text-switch-text-bright">
          {title}
        </span>
        <span className="text-xs text-switch-text-dim ml-2">{subtitle}</span>
      </div>
      <pre className="text-xs bg-switch-bg rounded p-2 overflow-x-auto text-switch-accent">
        <code>{command}</code>
      </pre>
    </div>
  );
}

function FeatureHighlights() {
  const features = [
    {
      title: 'Interactive Branch Picker',
      description:
        'Fuzzy-search and navigate your branches with vim-style keybindings. Checkout in a single keystroke.',
    },
    {
      title: 'PR Dashboard',
      description:
        'Browse open pull requests across all your repos. View CI status, clone, checkout, or open in your editor.',
    },
    {
      title: 'GitHub Integration',
      description:
        'Enrich branch listings with PR titles, review status, and CI checks. Retry failed checks directly from the TUI.',
    },
    {
      title: 'Cross-Platform',
      description:
        'Native binaries for macOS, Linux, and Windows. Available via Homebrew, Chocolatey, npm, or direct download.',
    },
  ];

  return (
    <section className="py-16 px-4 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold text-switch-text-bright mb-8 text-center">
        Features
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="border border-switch-border rounded-lg p-5 hover:border-switch-accent/30 transition-colors"
          >
            <h3 className="text-base font-semibold text-switch-accent-bright mb-2">
              {feature.title}
            </h3>
            <p className="text-sm text-switch-text-dim leading-relaxed">
              {feature.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

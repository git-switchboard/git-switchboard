import { useState } from 'react';
import { useData } from 'vike-react/useData';
import { Link } from '../../components/Link';
import type { LandingData, TerminalFrame } from './+data';

export default function LandingPage() {
  const { branchPickerFrame, prDashboardFrame } = useData<LandingData>();

  return (
    <div className="bg-hero-glow">
      <HeroSection />
      <TerminalShowcase
        branchPickerFrame={branchPickerFrame}
        prDashboardFrame={prDashboardFrame}
      />
      <InstallSection />
      <FeatureHighlights />
      <Footer />
    </div>
  );
}

/* ═══════════════════════════════════════════════
   HERO
   ═══════════════════════════════════════════════ */

function HeroSection() {
  return (
    <section className="pt-24 md:pt-36 pb-12 text-center px-4 relative">
      {/* Subtle grid background */}
      <div className="absolute inset-0 bg-grid-pattern opacity-40 pointer-events-none" />

      <div className="relative">
        {/* Badge */}
        <div className="animate-fade-in-up inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-switch-border-accent bg-switch-accent-glow mb-8 text-xs font-medium text-switch-accent">
          <span className="w-1.5 h-1.5 rounded-full bg-switch-signal-green animate-pulse" />
          Open Source CLI Tool
        </div>

        <h1
          className="animate-fade-in-up text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-switch-text-bright mb-6 font-mono"
          style={{ animationDelay: '100ms' }}
        >
          git-
          <span className="text-switch-accent">switchboard</span>
        </h1>

        <p
          className="animate-fade-in-up text-base sm:text-lg md:text-xl text-switch-text-dim max-w-2xl mx-auto mb-10 leading-relaxed"
          style={{ animationDelay: '200ms' }}
        >
          An interactive TUI for browsing and checking out git branches,
          with built-in GitHub PR integration.
        </p>

        <div
          className="animate-fade-in-up flex flex-wrap items-center justify-center gap-4"
          style={{ animationDelay: '300ms' }}
        >
          <Link
            href="/docs/installation"
            className="group inline-flex items-center gap-2 px-7 py-3 bg-switch-accent text-switch-bg font-semibold rounded-lg hover:bg-switch-accent-bright transition-all duration-200 no-underline shadow-lg shadow-switch-accent/20 hover:shadow-switch-accent/30"
          >
            Get Started
            <svg
              className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 7l5 5m0 0l-5 5m5-5H6"
              />
            </svg>
          </Link>
          <a
            href="https://github.com/git-switchboard/git-switchboard"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-7 py-3 border border-switch-border-light text-switch-text font-medium rounded-lg hover:border-switch-accent hover:text-switch-accent transition-all duration-200 no-underline"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════
   TERMINAL SHOWCASE — Rendered from actual TUI
   ═══════════════════════════════════════════════ */

/**
 * Convert an RGBA tuple [r, g, b, a] (0-1 floats) to a CSS color string.
 * Returns undefined for fully transparent colors.
 */
function rgbaToCSS(
  rgba: [number, number, number, number]
): string | undefined {
  const [r, g, b, a] = rgba;
  if (a === 0) return undefined;
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

const DEMO_TABS = [
  { id: 'branches', label: 'Branch Picker', command: 'git switchboard' },
  { id: 'prs', label: 'PR Dashboard', command: 'git switchboard pr' },
] as const;

function TerminalShowcase({
  branchPickerFrame,
  prDashboardFrame,
}: {
  branchPickerFrame: TerminalFrame | null;
  prDashboardFrame: TerminalFrame | null;
}) {
  const [activeTab, setActiveTab] = useState<'branches' | 'prs'>('prs');
  const frame =
    activeTab === 'branches' ? branchPickerFrame : prDashboardFrame;
  const command = DEMO_TABS.find((t) => t.id === activeTab)!.command;

  return (
    <section className="px-4 pb-16 md:pb-24">
      <div
        className="animate-fade-in-up max-w-4xl mx-auto"
        style={{ animationDelay: '400ms' }}
      >
        {/* Tab bar */}
        <div className="flex items-center gap-1 mb-3 justify-center">
          {DEMO_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
                activeTab === tab.id
                  ? 'bg-switch-accent/15 text-switch-accent border border-switch-accent/25'
                  : 'text-switch-text-dim hover:text-switch-text border border-transparent hover:bg-switch-bg-raised'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Terminal window */}
        <div className="terminal-chrome shadow-2xl shadow-black/40">
          <div className="terminal-chrome-bar">
            <div className="terminal-dot bg-switch-signal-red/80" />
            <div className="terminal-dot bg-switch-signal-amber/80" />
            <div className="terminal-dot bg-switch-signal-green/80" />
            <span className="ml-2 text-xs text-switch-text-dim font-mono">
              ~/my-project —{' '}
              <span className="text-switch-text">{command}</span>
            </span>
          </div>
          <div className="px-1 py-2 font-mono text-[12px] md:text-[13px] leading-[1.45] overflow-x-auto">
            {frame ? (
              <CapturedFrameRenderer frame={frame} />
            ) : (
              <div className="p-4 text-switch-text-dim text-xs">
                Terminal preview unavailable
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function CapturedFrameRenderer({ frame }: { frame: TerminalFrame }) {
  return (
    <div>
      {frame.lines.map((line, lineIdx) => {
        const lineText = line.spans.map((s) => s.text).join('');
        if (
          !lineText.trim() &&
          (lineIdx === 0 || lineIdx === frame.lines.length - 1)
        ) {
          return <div key={lineIdx} className="h-[1.45em]" />;
        }

        return (
          <div key={lineIdx} className="whitespace-pre">
            {line.spans.map((span, spanIdx) => {
              const fg = rgbaToCSS(span.fg);
              const bg = rgbaToCSS(span.bg);
              if (!span.text.trim() && spanIdx === line.spans.length - 1) {
                return null;
              }
              return (
                <span
                  key={spanIdx}
                  style={{
                    color: fg,
                    backgroundColor: bg,
                  }}
                >
                  {span.text}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   INSTALL
   ═══════════════════════════════════════════════ */

const INSTALL_METHODS = [
  {
    id: 'brew',
    label: 'Homebrew',
    platform: 'macOS / Linux',
    command: 'brew tap git-switchboard/tap && brew install git-switchboard',
  },
  {
    id: 'choco',
    label: 'Chocolatey',
    platform: 'Windows',
    command: 'choco install git-switchboard',
  },
  {
    id: 'script',
    label: 'Script',
    platform: 'macOS / Linux',
    command:
      'curl -fsSL https://raw.githubusercontent.com/git-switchboard/git-switchboard/main/packaging/install.sh | sh',
  },
  {
    id: 'npm',
    label: 'npm',
    platform: 'Requires Bun',
    command: 'npx git-switchboard',
  },
] as const;

function InstallSection() {
  const [activeTab, setActiveTab] = useState(0);
  const method = INSTALL_METHODS[activeTab];

  return (
    <section className="py-16 md:py-24 px-4">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-bold text-switch-text-bright mb-2 text-center tracking-tight">
          Quick Install
        </h2>
        <p className="text-switch-text-dim text-center mb-8 text-sm">
          Pick your platform and get running in seconds.
        </p>

        <div className="border border-switch-border rounded-xl overflow-hidden bg-switch-bg-raised/50">
          {/* Tabs */}
          <div className="flex border-b border-switch-border overflow-x-auto">
            {INSTALL_METHODS.map((m, i) => (
              <button
                key={m.id}
                className="install-tab whitespace-nowrap"
                data-active={i === activeTab}
                onClick={() => setActiveTab(i)}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="p-5">
            <div className="text-xs text-switch-text-dim mb-3">
              {method.platform}
            </div>
            <div className="relative group">
              <pre className="bg-switch-bg rounded-lg p-4 overflow-x-auto text-sm font-mono text-switch-accent border border-switch-border">
                <code>{method.command}</code>
              </pre>
              <CopyButton text={method.command} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="absolute top-3 right-3 p-1.5 rounded-md bg-switch-bg-surface/80 text-switch-text-dim hover:text-switch-accent transition-colors opacity-0 group-hover:opacity-100"
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <svg
          className="w-4 h-4 text-switch-signal-green"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      ) : (
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
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
      )}
    </button>
  );
}

/* ═══════════════════════════════════════════════
   FEATURES
   ═══════════════════════════════════════════════ */

const FEATURES = [
  {
    title: 'Interactive Branch Picker',
    description:
      'Fuzzy-search and navigate your branches with vim-style keybindings. Checkout in a single keystroke.',
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    ),
  },
  {
    title: 'PR Dashboard',
    description:
      'Browse open pull requests across all your repos. View CI status, clone, checkout, or open in your editor.',
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
        />
      </svg>
    ),
  },
  {
    title: 'GitHub Integration',
    description:
      'Enrich branch listings with PR titles, review status, and CI checks. Retry failed checks from the TUI.',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
      </svg>
    ),
  },
  {
    title: 'Cross-Platform',
    description:
      'Native binaries for macOS, Linux, and Windows. Available via Homebrew, Chocolatey, npm, or direct download.',
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
        />
      </svg>
    ),
  },
];

function FeatureHighlights() {
  return (
    <section className="py-16 md:py-24 px-4">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-bold text-switch-text-bright mb-3 text-center tracking-tight">
          Built for developers who live in the terminal
        </h2>
        <p className="text-switch-text-dim text-center mb-12 text-sm max-w-xl mx-auto">
          Everything you need to navigate branches and PRs without leaving your
          workflow.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 stagger-children">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="card-glow border border-switch-border rounded-xl p-6 bg-switch-bg-raised/30"
            >
              <div className="w-10 h-10 rounded-lg bg-switch-accent/10 border border-switch-accent/20 flex items-center justify-center text-switch-accent mb-4">
                {feature.icon}
              </div>
              <h3 className="text-base font-semibold text-switch-text-bright mb-2">
                {feature.title}
              </h3>
              <p className="text-sm text-switch-text-dim leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════
   FOOTER
   ═══════════════════════════════════════════════ */

function Footer() {
  return (
    <footer className="border-t border-switch-border py-10 px-4">
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-switch-text-dim">
        <div className="flex items-center gap-2">
          <span className="font-mono text-switch-accent font-bold">
            git-switchboard
          </span>
          <span>· MIT Licensed</span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/docs" className="hover:text-switch-text transition-colors">
            Documentation
          </Link>
          <a
            href="https://github.com/git-switchboard/git-switchboard"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-switch-text transition-colors"
          >
            GitHub
          </a>
          <a
            href="https://github.com/git-switchboard/git-switchboard/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-switch-text transition-colors"
          >
            Releases
          </a>
        </div>
      </div>
    </footer>
  );
}

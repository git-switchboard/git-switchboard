import { useState } from 'react';
import { useData } from 'vike-react/useData';
import { Link } from '../../components/Link';
import {
  StatusDot,
  TelemCell,
  SectionHeader,
  InstallTabs,
} from '../../components/ui';
import type { InstallMethod } from '../../components/ui';
import type { LandingData, TerminalFrame } from './+data';

export default function LandingPage() {
  const { branchPickerFrame, prDashboardFrame } = useData<LandingData>();

  return (
    <div>
      <HeroSection
        branchPickerFrame={branchPickerFrame}
        prDashboardFrame={prDashboardFrame}
      />
      <SubsystemsSection />
      <InstallSection />
      <Footer />
    </div>
  );
}

/* ═══════════════════════════════════════════════
   HERO — two-column: text left, terminal right
   ═══════════════════════════════════════════════ */

function HeroSection({
  branchPickerFrame,
  prDashboardFrame,
}: {
  branchPickerFrame: TerminalFrame | null;
  prDashboardFrame: TerminalFrame | null;
}) {
  const [activeTab, setActiveTab] = useState<'branches' | 'prs'>('prs');
  const frame = activeTab === 'branches' ? branchPickerFrame : prDashboardFrame;
  const command =
    activeTab === 'branches' ? 'git switchboard' : 'git switchboard pr';

  return (
    <section
      className="hero-section"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '3rem',
        padding: '4rem 4rem 3.5rem',
        minHeight: 'calc(100vh - 54px - 44px)',
        alignItems: 'center',
      }}
    >
      {/* ── Left: text ── */}
      <div>
        {/* Telemetry strip */}
        <div
          className="flex gap-6 mb-8 pb-5"
          style={{ borderBottom: '1px solid #192838' }}
        >
          <TelemCell label="STATUS" value="NOMINAL" color="green" />
          <TelemCell label="LICENSE" value="MIT" />
          <TelemCell label="PLATFORM" value="ALL" />
          <TelemCell label="VERSION" value="v0.3.0" />
        </div>

        <h1
          className="animate-fade-in-up text-switch-text-bright"
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '4.5rem',
            letterSpacing: '0.08em',
            lineHeight: 1,
            marginBottom: '0.5rem',
          }}
        >
          git-<span style={{ color: '#d4920a' }}>switchboard</span>
        </h1>

        <div
          className="animate-fade-in-up"
          style={{
            fontSize: '0.78rem',
            fontWeight: 600,
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
            color: '#4a6878',
            marginBottom: '1.5rem',
            animationDelay: '80ms',
          }}
        >
          Branch Navigator · PR Dashboard · GitHub Integration
        </div>

        <p
          className="animate-fade-in-up"
          style={{
            color: '#b0c4d4',
            fontSize: '0.96rem',
            lineHeight: 1.75,
            marginBottom: '2rem',
            maxWidth: '480px',
            animationDelay: '160ms',
          }}
        >
          A terminal TUI for mission-critical branch operations. Browse, filter,
          and checkout git branches with live GitHub PR integration — all from
          your command line.
        </p>

        <div
          className="animate-fade-in-up flex gap-3 items-center"
          style={{ animationDelay: '240ms' }}
        >
          <Link
            href="/docs/installation"
            className="no-underline"
            style={{
              background: '#d4920a',
              color: '#06090e',
              padding: '0.65rem 1.75rem',
              fontSize: '0.88rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              display: 'inline-block',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = '#ecb030';
              (e.currentTarget as HTMLElement).style.boxShadow = '0 0 16px rgba(212,146,10,0.3)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = '#d4920a';
              (e.currentTarget as HTMLElement).style.boxShadow = '';
            }}
          >
            Get Started
          </Link>
          <a
            href="https://github.com/git-switchboard/git-switchboard"
            target="_blank"
            rel="noopener noreferrer"
            className="no-underline"
            style={{
              background: 'transparent',
              color: '#b0c4d4',
              border: '1px solid #243848',
              padding: '0.65rem 1.75rem',
              fontSize: '0.88rem',
              fontWeight: 500,
              letterSpacing: '0.06em',
              display: 'inline-block',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = '#2e80c0';
              (e.currentTarget as HTMLElement).style.color = '#50a0e0';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = '#243848';
              (e.currentTarget as HTMLElement).style.color = '#b0c4d4';
            }}
          >
            View on GitHub
          </a>
        </div>
      </div>

      {/* ── Right: terminal panel ── */}
      <div className="animate-fade-in-up" style={{ animationDelay: '200ms' }}>
        <TerminalPanel
          activeTab={activeTab}
          onTabChange={setActiveTab}
          frame={frame}
          command={command}
        />
      </div>

      <style>{`
        @media (max-width: 900px) {
          .hero-section {
            grid-template-columns: 1fr !important;
            padding: 2.5rem 1.5rem !important;
            min-height: auto !important;
          }
        }
      `}</style>
    </section>
  );
}

function TerminalPanel({
  activeTab,
  onTabChange,
  frame,
  command,
}: {
  activeTab: 'branches' | 'prs';
  onTabChange: (tab: 'branches' | 'prs') => void;
  frame: TerminalFrame | null;
  command: string;
}) {
  return (
    <div style={{ border: '1px solid #2a5070' }}>
      {/* Panel header */}
      <div
        style={{
          background: '#101820',
          borderBottom: '1px solid #192838',
          padding: '0.45rem 1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            fontSize: '0.6rem',
            fontWeight: 700,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: '#4a6878',
          }}
        >
          LIVE DISPLAY
        </span>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {(['branches', 'prs'] as const).map((id) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => onTabChange(id)}
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: isActive ? '#50a0e0' : '#4a6878',
                  cursor: 'pointer',
                  padding: '1px 0',
                  background: 'none',
                  border: 'none',
                  borderBottom: `1px solid ${isActive ? '#2e80c0' : 'transparent'}`,
                  transition: 'all 0.12s',
                  letterSpacing: '0.04em',
                }}
              >
                {id === 'branches' ? 'Branches' : 'Pull Requests'}
              </button>
            );
          })}
        </div>
      </div>
      {/* Terminal output */}
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '13px',
          background: '#000',
          color: '#c0caf5',
          whiteSpace: 'pre',
          overflowX: 'auto',
          minHeight: '260px',
        }}
      >
        {frame ? (
          <CapturedFrameRenderer frame={frame} />
        ) : (
          <div style={{ padding: '1rem', color: '#4a6878', fontSize: '12px' }}>
            <span style={{ color: '#4a6878' }}>$ </span>
            {command}
          </div>
        )}
      </div>
    </div>
  );
}

function CapturedFrameRenderer({ frame }: { frame: TerminalFrame }) {
  return (
    <div>
      {frame.lines.map((line, lineIdx) => (
        <div
          key={lineIdx}
          className="whitespace-pre"
          style={{ display: 'block', padding: '0 6px', lineHeight: 1.4, minHeight: '1.4em' }}
        >
          {line.spans.map((span, spanIdx) => {
            const fg = rgbaToCSS(span.fg);
            const bg = rgbaToCSS(span.bg);
            if (!span.text.trim() && spanIdx === line.spans.length - 1) {
              return null;
            }
            return (
              <span key={spanIdx} style={{ color: fg, backgroundColor: bg }}>
                {span.text}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function rgbaToCSS(rgba: [number, number, number, number]): string | undefined {
  const [r, g, b, a] = rgba;
  if (a === 0) return undefined;
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

/* ═══════════════════════════════════════════════
   SUBSYSTEMS (features)
   ═══════════════════════════════════════════════ */

const SUBSYSTEMS = [
  {
    id: '01',
    status: 'green' as const,
    title: 'Interactive Branch Picker',
    description:
      'Keyboard-driven TUI for listing, filtering, and checking out branches. Fuzzy search, vim keybindings, and real-time author filtering. Never type a branch name again.',
  },
  {
    id: '02',
    status: 'green' as const,
    title: 'PR Dashboard',
    description:
      'Full pull request overview across all your repos. Track CI status, review state, and open PRs without leaving the terminal.',
  },
  {
    id: '03',
    status: 'blue' as const,
    title: 'GitHub Integration',
    description:
      'Authenticate once with a GitHub token and get PR status, CI checks, and review states overlaid directly on the branch list.',
  },
  {
    id: '04',
    status: 'amber' as const,
    title: 'Cross-Platform',
    description:
      'Ships as a single binary for macOS, Linux, and Windows. Install via Homebrew, Chocolatey, or a shell script. Zero runtime dependencies.',
  },
];

function SubsystemsSection() {
  return (
    <section
      className="subsystems-section"
      style={{ padding: '3rem 4rem', borderTop: '1px solid #192838' }}
    >
      <SectionHeader title="Subsystems" right="4 modules online" />

      <div
        className="stagger-children"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '1rem',
        }}
      >
        {SUBSYSTEMS.map((sub) => (
          <div
            key={sub.id}
            className="card-glow"
            style={{
              background: '#0b1018',
              border: '1px solid #192838',
              padding: '1.5rem',
              transition: 'border-color 0.15s',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                marginBottom: '0.75rem',
              }}
            >
              <StatusDot color={sub.status} />
              <span
                style={{
                  fontSize: '0.58rem',
                  fontWeight: 700,
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: '#4a6878',
                }}
              >
                SUBSYSTEM {sub.id}
              </span>
            </div>
            <div
              style={{
                fontSize: '1rem',
                fontWeight: 700,
                color: '#d8eaf5',
                marginBottom: '0.5rem',
                letterSpacing: '0.02em',
              }}
            >
              {sub.title}
            </div>
            <p style={{ fontSize: '0.86rem', color: '#b0c4d4', lineHeight: 1.7, margin: 0 }}>
              {sub.description}
            </p>
          </div>
        ))}
      </div>

      <style>{`
        @media (max-width: 900px) {
          .subsystems-section { padding: 2rem 1.5rem !important; }
          .subsystems-section > div[style*="grid"] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}

/* ═══════════════════════════════════════════════
   INSTALL
   ═══════════════════════════════════════════════ */

const INSTALL_METHODS: readonly InstallMethod[] = [
  {
    id: 'brew',
    label: 'Homebrew',
    platform: 'macOS / Linux',
    requires: 'Homebrew ≥ 3.0',
    command: 'brew tap git-switchboard/tap && brew install git-switchboard',
  },
  {
    id: 'choco',
    label: 'Chocolatey',
    platform: 'Windows',
    requires: 'Chocolatey',
    command: 'choco install git-switchboard',
  },
  {
    id: 'script',
    label: 'Script',
    platform: 'macOS / Linux',
    requires: 'curl',
    command:
      'curl -fsSL https://raw.githubusercontent.com/git-switchboard/git-switchboard/main/packaging/install.sh | sh',
  },
  {
    id: 'npm',
    label: 'npm',
    platform: 'Any',
    requires: 'Node.js / Bun',
    command: 'npx git-switchboard',
  },
];

function InstallSection() {
  return (
    <section
      className="install-section"
      style={{ padding: '3rem 4rem', borderTop: '1px solid #192838' }}
    >
      <SectionHeader title="Installation" />
      <InstallTabs methods={INSTALL_METHODS} />

      <style>{`
        @media (max-width: 900px) {
          .install-section { padding: 2rem 1.5rem !important; }
        }
      `}</style>
    </section>
  );
}

/* ═══════════════════════════════════════════════
   FOOTER
   ═══════════════════════════════════════════════ */

function Footer() {
  return (
    <footer
      className="site-footer"
      style={{
        borderTop: '1px solid #192838',
        padding: '1.5rem 4rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        background: '#0b1018',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
        <span
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '1.1rem',
            letterSpacing: '0.08em',
            color: '#d4920a',
          }}
        >
          git-switchboard
        </span>
        <TelemCell label="License" value="MIT" />
      </div>

      <div
        style={{
          display: 'flex',
          gap: '1.5rem',
          fontSize: '0.8rem',
          color: '#4a6878',
        }}
      >
        <Link
          href="/docs"
          style={{ textDecoration: 'none', color: 'inherit', letterSpacing: '0.04em' }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#b0c4d4')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '')}
        >
          Documentation
        </Link>
        <a
          href="https://github.com/git-switchboard/git-switchboard"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'inherit', textDecoration: 'none', letterSpacing: '0.04em' }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#b0c4d4')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '')}
        >
          GitHub
        </a>
        <a
          href="https://github.com/git-switchboard/git-switchboard/releases"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'inherit', textDecoration: 'none', letterSpacing: '0.04em' }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#b0c4d4')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '')}
        >
          Releases
        </a>
      </div>

      <style>{`
        @media (max-width: 640px) {
          .site-footer {
            flex-direction: column !important;
            padding: 1.5rem !important;
            text-align: center;
          }
        }
      `}</style>
    </footer>
  );
}

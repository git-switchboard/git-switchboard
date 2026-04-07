import React, { useEffect, useState } from 'react';
import { usePageContext } from 'vike-react/usePageContext';
import { Link } from '../components/Link';
import { PagefindSearch } from '../components/PagefindSearch';
import type { NavigationItem } from '../server/utils/docs';

const GITHUB_URL = 'https://github.com/git-switchboard/git-switchboard';

export default function Layout({ children }: { children: React.ReactNode }) {
  const pageContext = usePageContext();
  const pathname = pageContext.urlPathname;
  const navigation: NavigationItem[] =
    ((pageContext as unknown as Record<string, unknown>)
      .navigation as NavigationItem[]) ?? [];

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isLandingPage = pathname === '/' || pathname === '';
  const showSidebar = !isLandingPage && navigation.length > 0;

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-switch-bg bg-grid-pattern text-switch-text" style={{ paddingBottom: '44px' }}>
      {/* ── Header ────────────────────────────────── */}
      <header
        className="sticky top-0 z-40 border-b border-switch-border"
        style={{ background: '#0d1520', height: '54px' }}
        data-pagefind-ignore
      >
        <div className="flex items-center h-full px-6 gap-5">
          {/* Telemetry cells */}
          <div className="hidden md:flex items-center gap-5 pr-5 border-r border-switch-border shrink-0">
            <div className="telem-cell">
              <span className="telem-key">STATUS</span>
              <span className="telem-val green flex items-center gap-1">
                <span className="status-dot green" />
                NOMINAL
              </span>
            </div>
            <div className="telem-cell">
              <span className="telem-key">PLATFORM</span>
              <span className="telem-val" style={{ color: '#50a0e0' }}>ALL</span>
            </div>
          </div>

          {/* Logo */}
          <Link
            href="/"
            className="flex items-center gap-2 no-underline shrink-0"
            style={{ marginRight: 'auto' }}
          >
            <span
              className="text-white font-bold"
              style={{
                background: '#2e80c0',
                fontSize: '0.55rem',
                letterSpacing: '0.1em',
                padding: '2px 6px',
              }}
            >
              OSS
            </span>
            <span
              className="text-switch-text-bright"
              style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '1.4rem',
                letterSpacing: '0.1em',
              }}
            >
              git-<span style={{ color: '#d4920a' }}>switchboard</span>
            </span>
          </Link>

          {/* Nav links — full-height with vertical border separators */}
          <nav className="hidden md:flex items-stretch h-full">
            {[
              { label: 'Docs', href: '/docs' },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                active={pathname.startsWith(link.href)}
                className="flex items-center px-4 text-sm font-medium transition-colors border-l border-switch-border hover:text-switch-text-bright"
                style={{
                  color: pathname.startsWith(link.href) ? '#d8eaf5' : '#4a6878',
                  letterSpacing: '0.04em',
                  height: '54px',
                }}
              >
                {link.label}
              </Link>
            ))}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center px-4 text-sm font-medium transition-colors border-l border-r border-switch-border hover:text-switch-text-bright"
              style={{ color: '#4a6878', letterSpacing: '0.04em', height: '54px' }}
            >
              GitHub
            </a>
          </nav>

          {/* Search */}
          <div className="hidden md:block" style={{ marginLeft: '0.5rem' }}>
            <PagefindSearch />
          </div>

          {/* GitHub star button */}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:inline-flex items-center gap-1.5 text-switch-text-dim transition-all"
            style={{
              fontSize: '0.8rem',
              fontWeight: 500,
              border: '1px solid #243848',
              padding: '0.35rem 0.9rem',
              marginLeft: '0.5rem',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = '#d4920a';
              (e.currentTarget as HTMLElement).style.borderColor = '#d4920a';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = '';
              (e.currentTarget as HTMLElement).style.borderColor = '#243848';
            }}
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            ★ Star
          </a>

          {/* Mobile menu toggle */}
          <button
            className="md:hidden p-1.5 text-switch-text-dim hover:text-switch-text transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* ── Mobile nav overlay ────────────────────── */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="absolute top-[54px] left-0 right-0 border-b border-switch-border animate-fade-in"
            style={{ background: '#0d1520' }}
            onClick={(e) => e.stopPropagation()}
          >
            <nav className="px-5 py-3 border-b border-switch-border space-y-1">
              <Link
                href="/docs"
                active={pathname.startsWith('/docs')}
                className="block py-2 px-3 text-sm font-medium text-switch-text-dim hover:text-switch-text hover:bg-switch-bg-raised transition-all"
              >
                Docs
              </Link>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="block py-2 px-3 text-sm font-medium text-switch-text-dim hover:text-switch-text hover:bg-switch-bg-raised transition-all"
              >
                GitHub
              </a>
            </nav>
            {navigation.length > 0 && (
              <div className="px-5 py-4">
                <SidebarContent navigation={navigation} pathname={pathname} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Body ────────────────────────────────────── */}
      {showSidebar ? (
        /* Doc layout — responsive: single col on mobile, sidebar+content on md+ */
        <div className="doc-layout">
          <aside
            className="hidden md:block border-r border-switch-border overflow-y-auto bg-switch-bg-raised/50"
            style={{
              position: 'sticky',
              top: '54px',
              height: 'calc(100vh - 54px - 44px)',
            }}
            data-pagefind-ignore
          >
            <SidebarContent navigation={navigation} pathname={pathname} />
          </aside>

          <main className="min-w-0 px-5 py-6 md:px-10 md:py-10">
            {children}
          </main>
        </div>
      ) : (
        /* Landing / full-width pages */
        <main>{children}</main>
      )}

      {/* ── Fixed bottom nav ────────────────────────── */}
      <BottomNav pathname={pathname} />
    </div>
  );
}

function BottomNav({ pathname }: { pathname: string }) {
  const isLanding = pathname === '/' || pathname === '';
  const isDocs = pathname.startsWith('/docs');

  return (
    <nav className="nav-bar-bottom" data-pagefind-ignore>
      <div className="nav-bar-section">
        <span className="nav-bar-label">Pages</span>
        <Link
          href="/"
          className={`nav-page-link${isLanding ? ' active' : ''}`}
        >
          Landing
        </Link>
        <Link
          href="/docs"
          className={`nav-page-link${isDocs ? ' active' : ''}`}
        >
          Docs
        </Link>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="nav-page-link hidden sm:inline"
        >
          GitHub
        </a>
      </div>

      <div className="nav-bar-section">
        <div className="telem-cell">
          <span className="telem-key">Project</span>
          <span className="telem-val" style={{ color: '#50a0e0' }}>git-switchboard</span>
        </div>
      </div>
    </nav>
  );
}

function SidebarContent({
  navigation,
  pathname,
}: {
  navigation: NavigationItem[];
  pathname: string;
}) {
  return (
    <nav style={{ padding: '1.5rem 0' }}>
      {navigation.map((item) => (
        <SidebarItem key={item.title} item={item} pathname={pathname} />
      ))}
    </nav>
  );
}

function SidebarItem({
  item,
  pathname,
}: {
  item: NavigationItem;
  pathname: string;
}) {
  const hasChildren = item.children && item.children.length > 0;
  const isActive = item.path ? pathname === item.path : false;
  const hasActiveChild = item.children?.some(
    (child) =>
      child.path &&
      (pathname === child.path || pathname.startsWith(child.path + '/'))
  );

  const [open, setOpen] = useState(isActive || !!hasActiveChild);

  if (!hasChildren) {
    return (
      <Link
        href={item.path ?? '#'}
        active={isActive}
        className="flex items-center gap-2.5 text-sm font-medium transition-all"
        style={{
          padding: '0.35rem 1.25rem',
          color: isActive ? '#d4920a' : '#4a6878',
          background: isActive ? 'rgba(212,146,10,0.12)' : 'transparent',
          borderLeft: isActive ? '2px solid #d4920a' : '2px solid transparent',
          paddingLeft: isActive ? 'calc(1.25rem - 2px)' : '1.25rem',
          textDecoration: 'none',
        }}
      >
        {item.title}
      </Link>
    );
  }

  const groupActive = isActive || !!hasActiveChild;

  return (
    <div>
      {/* Section header — full-row clickable; clicking toggles open/close.
          If the group has its own index page, the title is also a link. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.35rem 1rem 0.35rem 1.25rem',
          background: groupActive ? 'rgba(46,128,192,0.06)' : 'rgba(255,255,255,0.02)',
          borderLeft: groupActive ? '2px solid #2e80c0' : '2px solid #192838',
          cursor: 'pointer',
        }}
        onClick={() => setOpen(!open)}
        role="button"
        aria-expanded={open}
      >
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.55rem',
            fontWeight: 700,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: groupActive ? '#50a0e0' : '#4a6878',
            textDecoration: 'none',
          }}
        >
          <span className="status-dot blue" />
          {item.path ? (
            <a
              href={item.path}
              style={{ color: 'inherit', textDecoration: 'none' }}
              onClick={(e) => e.stopPropagation()}
            >
              {item.title}
            </a>
          ) : (
            item.title
          )}
        </span>
        <svg
          style={{
            width: '0.6rem',
            height: '0.6rem',
            flexShrink: 0,
            color: '#4a6878',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {open && (
        <div
          className="animate-fade-in"
          style={{
            borderLeft: '1px solid #192838',
            marginLeft: '1.25rem',
            paddingBottom: '0.25rem',
          }}
        >
          {item.children!.map((child) => {
            const childActive = child.path
              ? pathname === child.path || pathname.startsWith(child.path + '/')
              : false;
            return (
              <Link
                key={child.path ?? child.title}
                href={child.path ?? '#'}
                active={childActive}
                className="flex items-center text-sm font-medium transition-all"
                style={{
                  padding: '0.3rem 1rem',
                  color: childActive ? '#d4920a' : '#4a6878',
                  background: childActive ? 'rgba(212,146,10,0.10)' : 'transparent',
                  borderLeft: childActive ? '2px solid #d4920a' : '2px solid transparent',
                  paddingLeft: childActive ? 'calc(1rem - 2px)' : '1rem',
                  textDecoration: 'none',
                }}
                onMouseEnter={(e) => {
                  if (!childActive) {
                    (e.currentTarget as HTMLElement).style.color = '#d8eaf5';
                    (e.currentTarget as HTMLElement).style.background = 'rgba(46,128,192,0.05)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!childActive) {
                    (e.currentTarget as HTMLElement).style.color = '#4a6878';
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }
                }}
              >
                {child.title}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

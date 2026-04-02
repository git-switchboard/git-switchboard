import { useEffect, useState } from 'react';
import { usePageContext } from 'vike-react/usePageContext';
import { Link } from '../components/Link';
import type { NavigationItem } from '../server/utils/docs';

const GITHUB_URL = 'https://github.com/git-switchboard/git-switchboard';

const NAV_LINKS = [
  { label: 'Docs', href: '/docs' },
  { label: 'GitHub', href: GITHUB_URL, external: true },
];

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
    <div className="min-h-screen bg-switch-bg text-switch-text">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-switch-bg/90 backdrop-blur-md border-b border-switch-border">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between px-5 h-14">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5 no-underline group">
              {/* Logo mark */}
              <div className="w-7 h-7 rounded-md bg-switch-accent/10 border border-switch-accent/25 flex items-center justify-center group-hover:bg-switch-accent/15 transition-colors">
                <svg
                  className="w-4 h-4 text-switch-accent"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              <span className="font-mono text-sm font-bold tracking-wide text-switch-text-bright group-hover:text-switch-accent transition-colors">
                switchboard
              </span>
            </Link>

            <nav className="hidden md:flex items-center gap-1">
              {NAV_LINKS.map((link) =>
                'external' in link && link.external ? (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-xs font-medium tracking-wide text-switch-text-dim hover:text-switch-text hover:bg-switch-bg-raised rounded-md transition-all"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    key={link.href}
                    href={link.href}
                    active={pathname.startsWith(link.href)}
                    className="px-3 py-1.5 text-xs font-medium tracking-wide rounded-md hover:bg-switch-bg-raised transition-all"
                  >
                    {link.label}
                  </Link>
                )
              )}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {/* GitHub star button - desktop */}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-switch-text-dim hover:text-switch-text border border-switch-border rounded-md hover:border-switch-border-light transition-all"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              Star
            </a>

            {/* Mobile menu toggle */}
            <button
              className="md:hidden p-1.5 text-switch-text-dim hover:text-switch-accent-bright rounded-md hover:bg-switch-bg-raised transition-all"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              ) : (
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile nav overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="absolute top-14 left-0 right-0 bg-switch-bg/95 backdrop-blur-md border-b border-switch-border max-h-[calc(100vh-3.5rem)] overflow-y-auto animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <nav className="px-5 py-3 border-b border-switch-border space-y-1">
              {NAV_LINKS.map((link) =>
                'external' in link && link.external ? (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block py-2 px-3 text-sm font-medium text-switch-text-dim hover:text-switch-text hover:bg-switch-bg-raised rounded-md transition-all"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    key={link.href}
                    href={link.href}
                    active={pathname.startsWith(link.href)}
                    className="block py-2 px-3 text-sm font-medium rounded-md hover:bg-switch-bg-raised transition-all"
                  >
                    {link.label}
                  </Link>
                )
              )}
            </nav>
            {navigation.length > 0 && (
              <div className="px-5 py-4">
                <SidebarContent navigation={navigation} pathname={pathname} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="max-w-screen-2xl mx-auto flex relative z-10">
        {/* Desktop sidebar */}
        {showSidebar && (
          <aside className="hidden md:block w-64 shrink-0 border-r border-switch-border sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto py-6 px-4">
            <SidebarContent navigation={navigation} pathname={pathname} />
          </aside>
        )}

        {/* Main content */}
        <main
          className={`flex-1 min-w-0 p-6 md:p-10 ${
            showSidebar ? '' : 'max-w-7xl mx-auto'
          }`}
        >
          {children}
        </main>
      </div>
    </div>
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
    <nav className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-switch-text-dim/60 px-2 mb-3">
        Navigation
      </div>
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
        className={`block py-1.5 px-3 text-sm rounded-md transition-all ${
          isActive
            ? 'bg-switch-accent/10 text-switch-accent font-medium'
            : 'hover:bg-switch-bg-raised text-switch-text-dim hover:text-switch-text'
        }`}
      >
        {item.title}
      </Link>
    );
  }

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full py-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-switch-text-dim hover:text-switch-text transition-colors rounded-md hover:bg-switch-bg-raised/50"
      >
        <span>{item.title}</span>
        <svg
          className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {open && (
        <div className="ml-3 mt-1 border-l border-switch-border pl-3 space-y-0.5 animate-fade-in">
          {item.children!.map((child) => {
            const childActive = child.path
              ? pathname === child.path ||
                pathname.startsWith(child.path + '/')
              : false;
            return (
              <Link
                key={child.path ?? child.title}
                href={child.path ?? '#'}
                active={childActive}
                className={`block py-1.5 px-2 text-sm rounded-md transition-all ${
                  childActive
                    ? 'text-switch-accent font-medium'
                    : 'text-switch-text-dim hover:text-switch-text hover:bg-switch-bg-raised'
                }`}
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

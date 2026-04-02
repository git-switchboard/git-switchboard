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
      <header className="sticky top-0 z-40 bg-switch-bg/95 backdrop-blur-sm border-b border-switch-border">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 no-underline">
              <span className="text-sm font-semibold tracking-wider text-switch-accent-bright">
                git-switchboard
              </span>
            </Link>

            <nav className="hidden md:flex items-center gap-4">
              {NAV_LINKS.map((link) =>
                'external' in link && link.external ? (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium tracking-wider uppercase text-switch-text-dim hover:text-switch-text transition-colors"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    key={link.href}
                    href={link.href}
                    active={pathname.startsWith(link.href)}
                    className="text-xs font-medium tracking-wider uppercase"
                  >
                    {link.label}
                  </Link>
                )
              )}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <button
              className="md:hidden text-switch-text-dim hover:text-switch-accent-bright transition-colors"
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
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="absolute top-14 left-0 right-0 bg-switch-bg border-b border-switch-border max-h-[calc(100vh-3.5rem)] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <nav className="px-4 py-3 border-b border-switch-border">
              {NAV_LINKS.map((link) =>
                'external' in link && link.external ? (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block py-2 text-sm font-medium text-switch-text-dim hover:text-switch-text transition-colors"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    key={link.href}
                    href={link.href}
                    active={pathname.startsWith(link.href)}
                    className="block py-2 text-sm font-medium"
                  >
                    {link.label}
                  </Link>
                )
              )}
            </nav>
            {navigation.length > 0 && (
              <div className="px-4 py-3">
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
          <aside className="hidden md:block w-60 shrink-0 border-r border-switch-border sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto p-4">
            <SidebarContent navigation={navigation} pathname={pathname} />
          </aside>
        )}

        {/* Main content */}
        <main
          className={`flex-1 min-w-0 p-6 md:p-8 ${
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
  const isActive = item.path
    ? pathname === item.path || pathname.startsWith(item.path + '/')
    : false;
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
        className="block py-1.5 px-2 text-sm rounded hover:bg-switch-bg-raised transition-colors"
      >
        {item.title}
      </Link>
    );
  }

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full py-1.5 px-2 text-xs font-semibold uppercase tracking-wider text-switch-text-dim hover:text-switch-text transition-colors rounded hover:bg-switch-bg-raised/50"
      >
        <span>{item.title}</span>
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
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
        <div className="ml-2 mt-0.5 border-l border-switch-border pl-2 space-y-0.5">
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
                className="block py-1 px-2 text-sm rounded hover:bg-switch-bg-raised transition-colors"
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

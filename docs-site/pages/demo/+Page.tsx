import { useEffect, useRef, useState } from 'react';

/**
 * Interactive demo page — embeds the @git-switchboard/ui package in an
 * iframe and feeds it mock PR data via postMessage.
 */

type DemoView = 'pr-dashboard' | 'branch-picker';

const MOCK_PRS = [
  {
    nodeId: 'PR_1', number: 142, title: 'Add Electrobun desktop UI integration',
    state: 'open', draft: false,
    repoOwner: 'git-switchboard', repoName: 'git-switchboard',
    repoId: 'git-switchboard/git-switchboard', forkRepoId: null,
    headRef: 'feat/electrobun-ui', updatedAt: new Date(Date.now() - 1800_000).toISOString(),
    url: '#', author: 'craigory', role: 'author',
    ciLabel: '12\u2713', ciColor: '#9ece6a',
    reviewLabel: '\u2713 Approved', reviewColor: '#9ece6a',
    mergeLabel: '', mergeColor: '#565f89',
  },
  {
    nodeId: 'PR_2', number: 138, title: 'Fix rate limit tracking for GraphQL API',
    state: 'open', draft: false,
    repoOwner: 'git-switchboard', repoName: 'git-switchboard',
    repoId: 'git-switchboard/git-switchboard', forkRepoId: null,
    headRef: 'fix/rate-limit', updatedAt: new Date(Date.now() - 7200_000).toISOString(),
    url: '#', author: 'alice', role: 'assigned',
    ciLabel: '10\u2713 2\u2717', ciColor: '#f7768e',
    reviewLabel: '\u2717 Changes req', reviewColor: '#f7768e',
    mergeLabel: '', mergeColor: '#565f89',
  },
  {
    nodeId: 'PR_3', number: 135, title: 'Implement chunked PR refresh with viewport prefetching',
    state: 'open', draft: false,
    repoOwner: 'git-switchboard', repoName: 'git-switchboard',
    repoId: 'git-switchboard/git-switchboard', forkRepoId: null,
    headRef: 'feat/chunked-refresh', updatedAt: new Date(Date.now() - 14400_000).toISOString(),
    url: '#', author: 'craigory', role: 'author',
    ciLabel: '8\u2713 1\u231B', ciColor: '#e0af68',
    reviewLabel: 'Needs review', reviewColor: '#565f89',
    mergeLabel: '', mergeColor: '#565f89',
  },
  {
    nodeId: 'PR_4', number: 130, title: 'Add multi-editor support with auto-detection',
    state: 'open', draft: true,
    repoOwner: 'git-switchboard', repoName: 'git-switchboard',
    repoId: 'git-switchboard/git-switchboard', forkRepoId: null,
    headRef: 'feat/multi-editor', updatedAt: new Date(Date.now() - 86400_000).toISOString(),
    url: '#', author: 'bob', role: 'assigned',
    ciLabel: '?', ciColor: '#565f89',
    reviewLabel: '\u2026', reviewColor: '#565f89',
    mergeLabel: '\u2717 Conflict', mergeColor: '#f7768e',
  },
  {
    nodeId: 'PR_5', number: 127, title: 'Migrate to Zustand for PR dashboard state',
    state: 'open', draft: false,
    repoOwner: 'git-switchboard', repoName: 'git-switchboard',
    repoId: 'git-switchboard/git-switchboard', forkRepoId: null,
    headRef: 'refactor/zustand', updatedAt: new Date(Date.now() - 172800_000).toISOString(),
    url: '#', author: 'craigory', role: 'both',
    ciLabel: '15\u2713', ciColor: '#9ece6a',
    reviewLabel: '\u2713 Approved', reviewColor: '#9ece6a',
    mergeLabel: '', mergeColor: '#565f89',
  },
  {
    nodeId: 'PR_6', number: 122, title: 'Add clipboard and notification support',
    state: 'open', draft: false,
    repoOwner: 'git-switchboard', repoName: 'git-switchboard',
    repoId: 'git-switchboard/git-switchboard', forkRepoId: null,
    headRef: 'feat/clipboard', updatedAt: new Date(Date.now() - 259200_000).toISOString(),
    url: '#', author: 'charlie', role: 'assigned',
    ciLabel: '6\u2713', ciColor: '#9ece6a',
    reviewLabel: '~ Re-review', reviewColor: '#e0af68',
    mergeLabel: '', mergeColor: '#565f89',
  },
];

const MOCK_BRANCHES = [
  { name: 'main', author: 'craigory', date: '', isRemote: false, isCurrent: true, relativeDate: '1h ago', pr: undefined },
  { name: 'feat/pr-dashboard', author: 'craigory', date: '', isRemote: false, isCurrent: false, relativeDate: '2h ago', pr: { number: 42, title: 'PR dashboard', state: 'open', draft: false } },
  { name: 'fix/scroll-overflow', author: 'alice', date: '', isRemote: false, isCurrent: false, relativeDate: '1d ago', pr: { number: 38, title: 'Fix scroll', state: 'open', draft: false } },
  { name: 'feat/worktree-support', author: 'bob', date: '', isRemote: false, isCurrent: false, relativeDate: '2d ago', pr: { number: 35, title: 'Worktree', state: 'open', draft: true } },
  { name: 'refactor/cli-structure', author: 'craigory', date: '', isRemote: false, isCurrent: false, relativeDate: '3d ago', pr: undefined },
  { name: 'origin/feat/remote-branch', author: 'charlie', date: '', isRemote: true, isCurrent: false, relativeDate: '4d ago', pr: { number: 31, title: 'Remote branch', state: 'open', draft: false } },
  { name: 'feat/editor-detection', author: 'alice', date: '', isRemote: false, isCurrent: false, relativeDate: '5d ago', pr: { number: 29, title: 'Editor detection', state: 'open', draft: false } },
  { name: 'feat/cache-layer', author: 'craigory', date: '', isRemote: false, isCurrent: false, relativeDate: '10d ago', pr: { number: 24, title: 'Cache layer', state: 'open', draft: false } },
];

export default function DemoPage() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [view, setView] = useState<DemoView>('pr-dashboard');
  const [ready, setReady] = useState(false);

  // The UI package is built to /packages/ui/dist/ — in production it would
  // be deployed alongside the docs site.  For now we use a relative path.
  const uiBase = import.meta.env.BASE_URL + 'ui/';
  const iframeSrc = `${uiBase}index.html?bridge=iframe&docsUrl=${encodeURIComponent(import.meta.env.BASE_URL + 'demo')}`;

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!event.data || typeof event.data !== 'object') return;
      const msg = event.data as { type: string };

      if (msg.type === 'ready') {
        setReady(true);
        // Send init data for the current view
        sendInitData(view);
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  function sendInitData(v: DemoView) {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    if (v === 'pr-dashboard') {
      iframe.contentWindow.postMessage({
        type: 'init',
        data: { view: 'pr-dashboard', prs: MOCK_PRS, repoMode: null },
      }, '*');
    } else {
      iframe.contentWindow.postMessage({
        type: 'init',
        data: { view: 'branch-picker', branches: MOCK_BRANCHES, currentUser: 'craigory', showRemote: false },
      }, '*');
    }
  }

  function switchView(v: DemoView) {
    setView(v);
    setReady(false);
    // Force iframe reload to reset state
    const iframe = iframeRef.current;
    if (iframe) {
      iframe.src = iframe.src;
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* View switcher */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-switch-border shrink-0">
        <span className="text-sm font-medium text-switch-text-dim">View:</span>
        <button
          onClick={() => switchView('pr-dashboard')}
          className={`px-3 py-1 text-xs font-mono rounded-md border transition-all ${
            view === 'pr-dashboard'
              ? 'bg-switch-accent/15 border-switch-accent/40 text-switch-accent'
              : 'border-switch-border text-switch-text-dim hover:text-switch-text hover:border-switch-border-light'
          }`}
        >
          PR Dashboard
        </button>
        <button
          onClick={() => switchView('branch-picker')}
          className={`px-3 py-1 text-xs font-mono rounded-md border transition-all ${
            view === 'branch-picker'
              ? 'bg-switch-accent/15 border-switch-accent/40 text-switch-accent'
              : 'border-switch-border text-switch-text-dim hover:text-switch-text hover:border-switch-border-light'
          }`}
        >
          Branch Picker
        </button>
        {!ready && (
          <span className="text-xs text-switch-text-dim animate-pulse">Loading...</span>
        )}
      </div>

      {/* Iframe */}
      <div className="flex-1 min-h-0">
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          className="w-full h-full border-0"
          title="git-switchboard interactive demo"
          allow="clipboard-write"
        />
      </div>
    </div>
  );
}

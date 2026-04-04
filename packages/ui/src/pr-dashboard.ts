import type { Bridge } from './bridge.js';
import type { PRDashboardInitData, PRDisplayData, UserPullRequest } from './types.js';
import { showToast } from './toast.js';

function esc(s: string): string {
  const d = document.createElement('span');
  d.textContent = s || '';
  return d.innerHTML;
}

function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function roleIcon(role: string): string {
  switch (role) {
    case 'author': return '<span class="role-author">\u270E</span>';
    case 'assigned': return '<span class="role-assigned">\u2192</span>';
    case 'both': return '<span class="role-both">\u270E\u2192</span>';
    default: return '';
  }
}

export function mountPRDashboard(
  root: HTMLElement,
  bridge: Bridge,
  data: PRDashboardInitData,
  isDemo: boolean
): void {
  let prs = data.prs;
  let selectedIndex = 0;
  let searchQuery = '';
  const repoMode = data.repoMode;

  const headerCols = repoMode
    ? `<span class="col-author-pr">Author</span>
       <span class="col-title">PR</span>
       <span class="col-updated">Updated</span>
       <span class="col-ci">CI</span>
       <span class="col-merge">Merge</span>
       <span class="col-review">Review</span>`
    : `<span class="col-role"></span>
       <span class="col-title">PR</span>
       <span class="col-repo">Repo</span>
       <span class="col-updated">Updated</span>
       <span class="col-ci">CI</span>
       <span class="col-merge">Merge</span>
       <span class="col-review">Review</span>`;

  root.innerHTML = `
    <div class="header">
      <span>git-switchboard pr</span>
      <span class="badge" id="prCount"></span>
    </div>
    <div class="toolbar">
      <input type="text" id="search" placeholder="Search PRs..." autofocus>
    </div>
    <div class="table-header">${headerCols}</div>
    <div class="list" id="prList"></div>
    <div class="footer">
      <span><kbd>\u2191\u2193</kbd> Navigate</span>
      <span><kbd>Enter</kbd> / <kbd>dbl-click</kbd> Select</span>
      <span><kbd>Esc</kbd> Quit</span>
    </div>`;

  const listEl = root.querySelector<HTMLElement>('#prList')!;
  const searchEl = root.querySelector<HTMLInputElement>('#search')!;
  const countEl = root.querySelector<HTMLElement>('#prCount')!;

  function getFiltered(): PRDisplayData[] {
    if (!searchQuery) return prs;
    const q = searchQuery.toLowerCase();
    return prs.filter(pr =>
      pr.title.toLowerCase().includes(q) ||
      pr.repoId.includes(q) ||
      pr.headRef.toLowerCase().includes(q) ||
      pr.author.toLowerCase().includes(q)
    );
  }

  function render(): void {
    const filtered = getFiltered();
    if (selectedIndex >= filtered.length) selectedIndex = Math.max(0, filtered.length - 1);
    countEl.textContent = searchQuery
      ? `${filtered.length}/${prs.length} open PRs`
      : `${prs.length} open PRs`;

    listEl.innerHTML = '';
    filtered.forEach((pr, i) => {
      const row = document.createElement('div');
      row.className = 'row' + (i === selectedIndex ? ' selected' : '') + (pr.draft ? ' draft' : '');

      if (repoMode) {
        row.innerHTML =
          `<span class="col-author-pr">${esc(pr.author)}</span>` +
          `<span class="col-title">#${pr.number} ${esc(pr.title)}</span>` +
          `<span class="col-updated">${relativeTime(pr.updatedAt)}</span>` +
          `<span class="col-ci" style="color:${pr.ciColor}">${esc(pr.ciLabel)}</span>` +
          `<span class="col-merge" style="color:${pr.mergeColor}">${esc(pr.mergeLabel)}</span>` +
          `<span class="col-review" style="color:${pr.reviewColor}">${esc(pr.reviewLabel)}</span>`;
      } else {
        row.innerHTML =
          `<span class="col-role">${roleIcon(pr.role)}</span>` +
          `<span class="col-title">#${pr.number} ${esc(pr.title)}</span>` +
          `<span class="col-repo">${esc(pr.repoOwner + '/' + pr.repoName)}</span>` +
          `<span class="col-updated">${relativeTime(pr.updatedAt)}</span>` +
          `<span class="col-ci" style="color:${pr.ciColor}">${esc(pr.ciLabel)}</span>` +
          `<span class="col-merge" style="color:${pr.mergeColor}">${esc(pr.mergeLabel)}</span>` +
          `<span class="col-review" style="color:${pr.reviewColor}">${esc(pr.reviewLabel)}</span>`;
      }

      row.addEventListener('click', () => {
        if (i === selectedIndex) selectPR(filtered[i]);
        else { selectedIndex = i; render(); }
      });
      row.addEventListener('dblclick', () => {
        selectedIndex = i;
        selectPR(filtered[i]);
      });
      listEl.appendChild(row);
    });
    const sel = listEl.querySelector('.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function selectPR(pr: UserPullRequest): void {
    if (isDemo) {
      showToast(`Would open: ${pr.repoOwner}/${pr.repoName}#${pr.number}`);
      return;
    }
    bridge.send({ type: 'select-pr', data: pr });
  }

  searchEl.addEventListener('input', () => {
    searchQuery = searchEl.value;
    selectedIndex = 0;
    render();
  });

  document.addEventListener('keydown', (e) => {
    if (e.target === searchEl && !['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.key)) return;
    const filtered = getFiltered();
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = Math.max(0, selectedIndex - 1);
        render();
        break;
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = Math.min(filtered.length - 1, selectedIndex + 1);
        render();
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[selectedIndex]) selectPR(filtered[selectedIndex]);
        break;
      case 'Escape':
        if (document.activeElement === searchEl) {
          searchEl.blur();
          searchQuery = '';
          searchEl.value = '';
          render();
        } else if (!isDemo) {
          bridge.send({ type: 'exit' });
        }
        break;
    }
  });

  bridge.onMessage((msg) => {
    if (msg.type === 'update-prs') {
      prs = msg.data;
      render();
    }
  });

  render();
}

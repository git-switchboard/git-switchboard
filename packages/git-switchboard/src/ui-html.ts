import type { BranchWithPR, UserPullRequest, CIInfo, ReviewInfo, MergeableStatus, ReviewStatus, CIStatus } from './types.js';

// ─── Shared styles (Tokyo Night theme) ──────────────────────────

const THEME = {
  bg: '#1a1b26',
  surface: '#24283b',
  surfaceHover: '#292e42',
  text: '#c0caf5',
  textMuted: '#565f89',
  accent: '#7aa2f7',
  purple: '#bb9af7',
  green: '#9ece6a',
  orange: '#ff9e64',
  red: '#f7768e',
  yellow: '#e0af68',
  teal: '#73daca',
};

const BASE_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: ${THEME.bg};
    color: ${THEME.text};
    font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
    font-size: 13px;
    line-height: 1.5;
    overflow: hidden;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .header {
    padding: 12px 16px 8px;
    color: ${THEME.accent};
    font-weight: 600;
    font-size: 14px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    -webkit-app-region: drag;
  }
  .header .badge {
    background: ${THEME.surface};
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 400;
  }
  .toolbar {
    padding: 4px 16px 8px;
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  .toolbar input {
    background: ${THEME.surface};
    border: 1px solid ${THEME.surfaceHover};
    color: ${THEME.text};
    padding: 4px 10px;
    border-radius: 4px;
    font-family: inherit;
    font-size: 13px;
    outline: none;
    flex: 1;
    max-width: 300px;
  }
  .toolbar input:focus {
    border-color: ${THEME.accent};
  }
  .toolbar button, .toolbar select {
    background: ${THEME.surface};
    border: 1px solid ${THEME.surfaceHover};
    color: ${THEME.text};
    padding: 4px 12px;
    border-radius: 4px;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .toolbar button:hover, .toolbar select:hover {
    background: ${THEME.surfaceHover};
  }
  .toolbar button.active {
    background: ${THEME.accent};
    color: ${THEME.bg};
    border-color: ${THEME.accent};
  }
  .table-header {
    display: flex;
    padding: 4px 16px;
    color: ${THEME.purple};
    font-size: 12px;
    font-weight: 600;
    flex-shrink: 0;
    border-bottom: 1px solid ${THEME.surfaceHover};
    user-select: none;
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 0;
  }
  .list::-webkit-scrollbar { width: 6px; }
  .list::-webkit-scrollbar-track { background: ${THEME.bg}; }
  .list::-webkit-scrollbar-thumb { background: ${THEME.surfaceHover}; border-radius: 3px; }
  .row {
    display: flex;
    padding: 6px 16px;
    cursor: pointer;
    border-left: 2px solid transparent;
    transition: background 0.1s;
  }
  .row:hover { background: ${THEME.surfaceHover}; }
  .row.selected {
    background: ${THEME.surface};
    border-left-color: ${THEME.accent};
  }
  .footer {
    padding: 8px 16px;
    color: ${THEME.textMuted};
    font-size: 11px;
    flex-shrink: 0;
    border-top: 1px solid ${THEME.surfaceHover};
    display: flex;
    gap: 16px;
  }
  .footer kbd {
    background: ${THEME.surface};
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 11px;
  }
`;

/**
 * Signal an action back to the bun process by navigating to a gsb:// URL.
 * The bun process intercepts these via the will-navigate event.
 */
const SIGNAL_FN = `
function signal(action, data) {
  var payload = encodeURIComponent(JSON.stringify(data || {}));
  window.location.href = 'gsb://' + action + '?d=' + payload;
}
`;

// ─── Branch Picker HTML ───────────────────────────────────────

export interface BranchPickerData {
  branches: BranchWithPR[];
  currentUser: string;
  showRemote: boolean;
}

export function buildBranchPickerHTML(data: BranchPickerData): string {
  const json = JSON.stringify(data);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>git-switchboard</title>
<style>
${BASE_STYLES}
.col-branch { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-author { width: 140px; flex-shrink: 0; color: ${THEME.textMuted}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-date   { width: 120px; flex-shrink: 0; color: ${THEME.textMuted}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-pr     { width: 130px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.current    { color: ${THEME.teal}; }
.remote     { color: ${THEME.orange}; }
.pr-open    { color: ${THEME.green}; }
.pr-draft   { color: ${THEME.textMuted}; }
</style>
</head>
<body>
<div class="header">
  <span>git-switchboard</span>
</div>
<div class="toolbar">
  <input type="text" id="search" placeholder="Search branches..." autofocus>
  <button id="remoteToggle">Remote: OFF</button>
  <select id="authorFilter">
    <option value="all">All authors</option>
    <option value="me">My branches</option>
  </select>
</div>
<div class="table-header">
  <span class="col-branch">Branch</span>
  <span class="col-author">Author</span>
  <span class="col-date">Updated</span>
  <span class="col-pr">PR</span>
</div>
<div class="list" id="branchList"></div>
<div class="footer">
  <span><kbd>\u2191\u2193</kbd> Navigate</span>
  <span><kbd>Enter</kbd> / <kbd>dbl-click</kbd> Checkout</span>
  <span><kbd>Esc</kbd> Quit</span>
</div>
<script>
${SIGNAL_FN}
var DATA = ${json};
var branches = DATA.branches;
var selectedIndex = 0;
var showRemote = DATA.showRemote;
var authorFilter = 'all';
var searchQuery = '';

var listEl = document.getElementById('branchList');
var searchEl = document.getElementById('search');
var remoteBtn = document.getElementById('remoteToggle');
var authorSel = document.getElementById('authorFilter');

function getFiltered() {
  var result = branches;
  if (authorFilter === 'me') {
    var me = DATA.currentUser.toLowerCase();
    result = result.filter(function(b) { return b.author.toLowerCase() === me; });
  }
  if (searchQuery) {
    var q = searchQuery.toLowerCase();
    result = result.filter(function(b) { return b.name.toLowerCase().indexOf(q) !== -1; });
  }
  return result;
}

function esc(s) {
  var d = document.createElement('span');
  d.textContent = s || '';
  return d.innerHTML;
}

function render() {
  var filtered = getFiltered();
  if (selectedIndex >= filtered.length) selectedIndex = Math.max(0, filtered.length - 1);

  remoteBtn.textContent = 'Remote: ' + (showRemote ? 'ON' : 'OFF');
  if (showRemote) remoteBtn.classList.add('active');
  else remoteBtn.classList.remove('active');

  listEl.innerHTML = '';
  filtered.forEach(function(b, i) {
    var row = document.createElement('div');
    row.className = 'row' + (i === selectedIndex ? ' selected' : '');
    var branchClass = b.isCurrent ? 'current' : b.isRemote ? 'remote' : '';
    var marker = b.isCurrent ? '* ' : '';
    var prText = b.pr ? '#' + b.pr.number + ' ' + (b.pr.draft ? 'Draft' : 'Open') : '-';
    var prClass = b.pr ? (b.pr.draft ? 'pr-draft' : 'pr-open') : '';
    row.innerHTML =
      '<span class="col-branch ' + branchClass + '">' + marker + esc(b.name) + '</span>' +
      '<span class="col-author">' + esc(b.author) + '</span>' +
      '<span class="col-date">' + esc(b.relativeDate) + '</span>' +
      '<span class="col-pr ' + prClass + '">' + esc(prText) + '</span>';
    row.addEventListener('click', function() {
      if (i === selectedIndex) {
        signal('select-branch', filtered[i]);
      } else {
        selectedIndex = i;
        render();
      }
    });
    row.addEventListener('dblclick', function() {
      selectedIndex = i;
      signal('select-branch', filtered[i]);
    });
    listEl.appendChild(row);
  });
  var sel = listEl.querySelector('.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

searchEl.addEventListener('input', function(e) {
  searchQuery = e.target.value;
  selectedIndex = 0;
  render();
});

remoteBtn.addEventListener('click', function() {
  showRemote = !showRemote;
  signal('toggle-remote', { showRemote: showRemote });
});

authorSel.addEventListener('change', function(e) {
  authorFilter = e.target.value;
  selectedIndex = 0;
  render();
});

document.addEventListener('keydown', function(e) {
  if (e.target === searchEl && ['ArrowUp','ArrowDown','Enter','Escape'].indexOf(e.key) === -1) return;
  var filtered = getFiltered();
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
      if (filtered[selectedIndex]) signal('select-branch', filtered[selectedIndex]);
      break;
    case 'Escape':
      if (document.activeElement === searchEl) {
        searchEl.blur();
        searchQuery = '';
        searchEl.value = '';
        render();
      } else {
        signal('exit');
      }
      break;
  }
});

// Expose a global so the bun process can push updated branches via executeJavascript
window.__updateBranches = function(newBranches) {
  branches = newBranches;
  render();
};

render();
</script>
</body>
</html>`;
}

// ─── PR Dashboard HTML ────────────────────────────────────────

export interface PRDashboardData {
  prs: UserPullRequest[];
  ciCache: Record<string, CIInfo>;
  reviewCache: Record<string, ReviewInfo>;
  mergeableCache: Record<string, MergeableStatus>;
  repoMode: string | null;
}

function ciStatusColor(status: CIStatus): string {
  switch (status) {
    case 'passing': return THEME.green;
    case 'failing': return THEME.red;
    case 'mixed': return THEME.orange;
    case 'pending': return THEME.yellow;
    default: return THEME.textMuted;
  }
}

function reviewStatusColor(status: ReviewStatus): string {
  switch (status) {
    case 'approved': return THEME.green;
    case 'changes-requested': return THEME.red;
    case 're-review-needed': return THEME.yellow;
    default: return THEME.textMuted;
  }
}

function reviewStatusLabel(status: ReviewStatus | undefined): string {
  if (!status) return '\u2026';
  switch (status) {
    case 'approved': return '\u2713 Approved';
    case 'changes-requested': return '\u2717 Changes req';
    case 're-review-needed': return '~ Re-review';
    default: return 'Needs review';
  }
}

function ciStatusLabel(ci: CIInfo | undefined): string {
  if (!ci || ci.checks.length === 0) return '?';
  const pass = ci.checks.filter(c => c.status === 'completed' && ['success', 'skipped', 'neutral'].includes(c.conclusion ?? '')).length;
  const fail = ci.checks.filter(c => c.status === 'completed' && c.conclusion === 'failure').length;
  const pending = ci.checks.filter(c => c.status !== 'completed').length;
  const parts: string[] = [];
  if (pass > 0) parts.push(pass + '\u2713');
  if (fail > 0) parts.push(fail + '\u2717');
  if (pending > 0) parts.push(pending + '\u231B');
  return parts.join(' ');
}

export function buildPRDashboardHTML(data: PRDashboardData): string {
  const prDisplayData = data.prs.map(pr => {
    const key = `${pr.repoId}#${pr.number}`;
    const ci = data.ciCache[key];
    const review = data.reviewCache[key];
    const merge = data.mergeableCache[key];
    return {
      ...pr,
      ciLabel: ciStatusLabel(ci),
      ciColor: ci ? ciStatusColor(ci.status) : THEME.textMuted,
      reviewLabel: reviewStatusLabel(review?.status),
      reviewColor: review ? reviewStatusColor(review.status) : THEME.textMuted,
      mergeLabel: merge === 'CONFLICTING' ? '\u2717 Conflict' : '',
      mergeColor: merge === 'CONFLICTING' ? THEME.red : THEME.textMuted,
    };
  });

  const json = JSON.stringify({ prs: prDisplayData, repoMode: data.repoMode });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>git-switchboard pr</title>
<style>
${BASE_STYLES}
.col-role    { width: 30px; flex-shrink: 0; text-align: center; }
.col-pr      { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-repo    { width: 180px; flex-shrink: 0; color: ${THEME.textMuted}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-author  { width: 120px; flex-shrink: 0; color: ${THEME.purple}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-updated { width: 90px; flex-shrink: 0; color: ${THEME.textMuted}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-ci      { width: 90px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-merge   { width: 90px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-review  { width: 120px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.role-author   { color: ${THEME.accent}; }
.role-assigned { color: ${THEME.yellow}; }
.role-both     { color: ${THEME.purple}; }
.draft         { opacity: 0.7; }
</style>
</head>
<body>
<div class="header">
  <span>git-switchboard pr</span>
  <span class="badge" id="prCount"></span>
</div>
<div class="toolbar">
  <input type="text" id="search" placeholder="Search PRs..." autofocus>
</div>
<div class="table-header" id="tableHeader"></div>
<div class="list" id="prList"></div>
<div class="footer">
  <span><kbd>\u2191\u2193</kbd> Navigate</span>
  <span><kbd>Enter</kbd> / <kbd>dbl-click</kbd> Select</span>
  <span><kbd>Esc</kbd> Quit</span>
</div>
<script>
${SIGNAL_FN}
var DATA = ${json};
var prs = DATA.prs;
var selectedIndex = 0;
var searchQuery = '';
var repoMode = DATA.repoMode;

var listEl = document.getElementById('prList');
var searchEl = document.getElementById('search');
var countEl = document.getElementById('prCount');
var headerEl = document.getElementById('tableHeader');

function relativeTime(iso) {
  var seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return seconds + 's ago';
  var minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm ago';
  var hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h ago';
  var days = Math.floor(hours / 24);
  if (days < 30) return days + 'd ago';
  var months = Math.floor(days / 30);
  return months + 'mo ago';
}

function roleIcon(role) {
  switch (role) {
    case 'author': return '<span class="role-author">\u270E</span>';
    case 'assigned': return '<span class="role-assigned">\u2192</span>';
    case 'both': return '<span class="role-both">\u270E\u2192</span>';
    default: return '';
  }
}

function getFiltered() {
  if (!searchQuery) return prs;
  var q = searchQuery.toLowerCase();
  return prs.filter(function(pr) {
    return pr.title.toLowerCase().indexOf(q) !== -1 ||
      pr.repoId.indexOf(q) !== -1 ||
      pr.headRef.toLowerCase().indexOf(q) !== -1 ||
      pr.author.toLowerCase().indexOf(q) !== -1;
  });
}

function esc(s) {
  var d = document.createElement('span');
  d.textContent = s || '';
  return d.innerHTML;
}

function buildHeader() {
  if (repoMode) {
    headerEl.innerHTML =
      '<span class="col-author">Author</span>' +
      '<span class="col-pr">PR</span>' +
      '<span class="col-updated">Updated</span>' +
      '<span class="col-ci">CI</span>' +
      '<span class="col-merge">Merge</span>' +
      '<span class="col-review">Review</span>';
  } else {
    headerEl.innerHTML =
      '<span class="col-role"></span>' +
      '<span class="col-pr">PR</span>' +
      '<span class="col-repo">Repo</span>' +
      '<span class="col-updated">Updated</span>' +
      '<span class="col-ci">CI</span>' +
      '<span class="col-merge">Merge</span>' +
      '<span class="col-review">Review</span>';
  }
}

function render() {
  var filtered = getFiltered();
  if (selectedIndex >= filtered.length) selectedIndex = Math.max(0, filtered.length - 1);
  countEl.textContent = searchQuery
    ? filtered.length + '/' + prs.length + ' open PRs'
    : prs.length + ' open PRs';

  listEl.innerHTML = '';
  filtered.forEach(function(pr, i) {
    var row = document.createElement('div');
    row.className = 'row' + (i === selectedIndex ? ' selected' : '') + (pr.draft ? ' draft' : '');

    if (repoMode) {
      row.innerHTML =
        '<span class="col-author">' + esc(pr.author) + '</span>' +
        '<span class="col-pr">#' + pr.number + ' ' + esc(pr.title) + '</span>' +
        '<span class="col-updated">' + relativeTime(pr.updatedAt) + '</span>' +
        '<span class="col-ci" style="color:' + pr.ciColor + '">' + esc(pr.ciLabel) + '</span>' +
        '<span class="col-merge" style="color:' + pr.mergeColor + '">' + esc(pr.mergeLabel) + '</span>' +
        '<span class="col-review" style="color:' + pr.reviewColor + '">' + esc(pr.reviewLabel) + '</span>';
    } else {
      row.innerHTML =
        '<span class="col-role">' + roleIcon(pr.role) + '</span>' +
        '<span class="col-pr">#' + pr.number + ' ' + esc(pr.title) + '</span>' +
        '<span class="col-repo">' + esc(pr.repoOwner + '/' + pr.repoName) + '</span>' +
        '<span class="col-updated">' + relativeTime(pr.updatedAt) + '</span>' +
        '<span class="col-ci" style="color:' + pr.ciColor + '">' + esc(pr.ciLabel) + '</span>' +
        '<span class="col-merge" style="color:' + pr.mergeColor + '">' + esc(pr.mergeLabel) + '</span>' +
        '<span class="col-review" style="color:' + pr.reviewColor + '">' + esc(pr.reviewLabel) + '</span>';
    }

    row.addEventListener('click', function() {
      if (i === selectedIndex) {
        signal('select-pr', filtered[i]);
      } else {
        selectedIndex = i;
        render();
      }
    });
    row.addEventListener('dblclick', function() {
      selectedIndex = i;
      signal('select-pr', filtered[i]);
    });
    listEl.appendChild(row);
  });
  var sel = listEl.querySelector('.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

searchEl.addEventListener('input', function(e) {
  searchQuery = e.target.value;
  selectedIndex = 0;
  render();
});

document.addEventListener('keydown', function(e) {
  if (e.target === searchEl && ['ArrowUp','ArrowDown','Enter','Escape'].indexOf(e.key) === -1) return;
  var filtered = getFiltered();
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
      if (filtered[selectedIndex]) signal('select-pr', filtered[selectedIndex]);
      break;
    case 'Escape':
      if (document.activeElement === searchEl) {
        searchEl.blur();
        searchQuery = '';
        searchEl.value = '';
        render();
      } else {
        signal('exit');
      }
      break;
  }
});

// Expose a global so the bun process can push updated PR data via executeJavascript
window.__updatePRs = function(newPRs) {
  prs = newPRs;
  render();
};

buildHeader();
render();
</script>
</body>
</html>`;
}

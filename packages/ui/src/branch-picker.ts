import type { Bridge } from './bridge.js';
import type { BranchPickerInitData, BranchWithPR } from './types.js';
import { showToast } from './toast.js';

function esc(s: string): string {
  const d = document.createElement('span');
  d.textContent = s || '';
  return d.innerHTML;
}

export function mountBranchPicker(
  root: HTMLElement,
  bridge: Bridge,
  data: BranchPickerInitData,
  isDemo: boolean
): void {
  let branches = data.branches;
  let selectedIndex = 0;
  let showRemote = data.showRemote;
  let authorFilter = 'all';
  let searchQuery = '';

  root.innerHTML = `
    <div class="header"><span>git-switchboard</span></div>
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
    </div>`;

  const listEl = root.querySelector<HTMLElement>('#branchList')!;
  const searchEl = root.querySelector<HTMLInputElement>('#search')!;
  const remoteBtn = root.querySelector<HTMLButtonElement>('#remoteToggle')!;
  const authorSel = root.querySelector<HTMLSelectElement>('#authorFilter')!;

  function getFiltered(): BranchWithPR[] {
    let result = branches;
    if (authorFilter === 'me') {
      const me = data.currentUser.toLowerCase();
      result = result.filter(b => b.author.toLowerCase() === me);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(b => b.name.toLowerCase().includes(q));
    }
    return result;
  }

  function render(): void {
    const filtered = getFiltered();
    if (selectedIndex >= filtered.length) selectedIndex = Math.max(0, filtered.length - 1);

    remoteBtn.textContent = 'Remote: ' + (showRemote ? 'ON' : 'OFF');
    if (showRemote) remoteBtn.classList.add('active');
    else remoteBtn.classList.remove('active');

    listEl.innerHTML = '';
    filtered.forEach((b, i) => {
      const row = document.createElement('div');
      row.className = 'row' + (i === selectedIndex ? ' selected' : '');
      const branchClass = b.isCurrent ? 'current' : b.isRemote ? 'remote' : '';
      const marker = b.isCurrent ? '* ' : '';
      const prText = b.pr ? `#${b.pr.number} ${b.pr.draft ? 'Draft' : 'Open'}` : '-';
      const prClass = b.pr ? (b.pr.draft ? 'pr-draft' : 'pr-open') : '';
      row.innerHTML =
        `<span class="col-branch ${branchClass}">${marker}${esc(b.name)}</span>` +
        `<span class="col-author">${esc(b.author)}</span>` +
        `<span class="col-date">${esc(b.relativeDate)}</span>` +
        `<span class="col-pr ${prClass}">${esc(prText)}</span>`;
      row.addEventListener('click', () => {
        if (i === selectedIndex) selectBranch(filtered[i]);
        else { selectedIndex = i; render(); }
      });
      row.addEventListener('dblclick', () => {
        selectedIndex = i;
        selectBranch(filtered[i]);
      });
      listEl.appendChild(row);
    });
    const sel = listEl.querySelector('.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function selectBranch(branch: BranchWithPR): void {
    if (isDemo) {
      showToast(`Would checkout: ${branch.name}`);
      return;
    }
    bridge.send({ type: 'select-branch', data: branch });
  }

  searchEl.addEventListener('input', () => {
    searchQuery = searchEl.value;
    selectedIndex = 0;
    render();
  });

  remoteBtn.addEventListener('click', () => {
    showRemote = !showRemote;
    if (isDemo) {
      showToast(`Remote: ${showRemote ? 'ON' : 'OFF'} (demo mode)`);
    } else {
      bridge.send({ type: 'toggle-remote', data: { showRemote } });
    }
    render();
  });

  authorSel.addEventListener('change', () => {
    authorFilter = authorSel.value;
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
        if (filtered[selectedIndex]) selectBranch(filtered[selectedIndex]);
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

  // Listen for data updates from host
  bridge.onMessage((msg) => {
    if (msg.type === 'update-branches') {
      branches = msg.data;
      render();
    }
  });

  render();
}

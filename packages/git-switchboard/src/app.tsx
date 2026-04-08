import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useCallback, useMemo, useState } from 'react';
import { useKeybinds } from './use-keybinds.js';
import { muteColor } from './colors.js';
import { ScrollList, handleListKey } from './scroll-list.js';
import type { AuthorFilterMode, BranchWithPR, WorktreeInfo } from './types.js';
import { footerParts } from './view.js';
import { ELLIPSIS, RETURN_SYMBOL } from './unicode.js';
import type { ViewProps } from './view.js';
import { useExitOnCtrlC } from './use-exit-on-ctrl-c.js';
import { useNavigate } from './tui-router.js';

/** Truncate string to fit width, adding ellipsis if needed */
function fit(str: string, width: number): string {
  if (str.length <= width) return str.padEnd(width);
  return str.slice(0, width - 1) + ELLIPSIS;
}

interface AppProps extends ViewProps {
  branches: BranchWithPR[];
  currentUser: string;
  /** All names the current user goes by (for "me" filter) */
  currentUserAliases: string[];
  authorList: string[];
  initialShowRemote: boolean;
  worktrees: WorktreeInfo[];
  getWorkingTreeDirtyFiles: () => string[];
  onSelect: (branch: BranchWithPR) => void;
  onExit: () => void;
  fetchBranches: (includeRemote: boolean) => BranchWithPR[];
}

export function App({
  branches: initialBranches,
  currentUser,
  currentUserAliases,
  authorList,
  initialShowRemote,
  worktrees,
  getWorkingTreeDirtyFiles,
  onSelect,
  onExit,
  fetchBranches,
  keybinds,
}: AppProps) {
  useExitOnCtrlC();
  const navigate = useNavigate<
    | { type: 'branch-picker' }
    | { type: 'worktree-conflict'; branch: BranchWithPR; worktreePath: string }
    | { type: 'dirty-checkout'; branch: BranchWithPR; dirtyFiles: string[] }
  >();
  const { width, height } = useTerminalDimensions();
  const [branches, setBranches] = useState(initialBranches);
  const [showRemote, setShowRemote] = useState(initialShowRemote);
  const [authorFilter, setAuthorFilter] = useState<AuthorFilterMode>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const authorFilterModes: AuthorFilterMode[] = useMemo(() => {
    const modes: AuthorFilterMode[] = ['all', 'me'];
    if (authorList.length > 0) modes.push('list');
    return modes;
  }, [authorList]);

  // All lowercase aliases for "me" matching
  const meAliases = useMemo(
    () => currentUserAliases.map((a) => a.toLowerCase()),
    [currentUserAliases]
  );

  const filteredBranches = useMemo(() => {
    let result = branches;

    if (authorFilter === 'me') {
      result = result.filter((b) => meAliases.includes(b.author.toLowerCase()));
    } else if (authorFilter === 'list') {
      const lower = authorList.map((a) => a.toLowerCase());
      result = result.filter((b) => lower.includes(b.author.toLowerCase()));
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((b) => b.name.toLowerCase().includes(q));
    }

    return result;
  }, [branches, authorFilter, meAliases, authorList, searchQuery]);

  // Virtual scrolling: 4 chrome rows (header, spacer, column headers, footer) + 2 padding rows
  const listHeight = Math.max(1, height - 6);

  const moveTo = useCallback(
    (newIndex: number) => {
      const clamped = Math.max(
        0,
        Math.min(newIndex, filteredBranches.length - 1)
      );
      setSelectedIndex(clamped);
      setScrollOffset((prev) => {
        if (clamped < prev) return clamped;
        if (clamped >= prev + listHeight) return clamped - listHeight + 1;
        return prev;
      });
    },
    [filteredBranches.length, listHeight]
  );

  useKeybinds(keybinds, {
    navigate: (key) => {
      if (key.name === 'up' || key.name === 'k') moveTo(selectedIndex - 1);
      else moveTo(selectedIndex + 1);
    },
    select: () => {
      const branch = filteredBranches[selectedIndex];
      if (!branch) return;
      const resolvedName = branch.isRemote
        ? branch.name.replace(/^origin\//, '')
        : branch.name;
      const conflictWorktree = branch.isCurrent
        ? undefined
        : worktrees.find((wt) => wt.branch === resolvedName);
      if (conflictWorktree) {
        navigate({ type: 'worktree-conflict', branch, worktreePath: conflictWorktree.path });
      } else {
        const dirtyFiles = getWorkingTreeDirtyFiles();
        if (dirtyFiles.length > 0) {
          navigate({ type: 'dirty-checkout', branch, dirtyFiles });
        } else {
          onSelect(branch);
        }
      }
    },
    toggleRemote: () => {
      const newShowRemote = !showRemote;
      setShowRemote(newShowRemote);
      setBranches(fetchBranches(newShowRemote));
      setSelectedIndex(0);
      setScrollOffset(0);
    },
    cycleAuthor: () => {
      setAuthorFilter((current) => {
        const idx = authorFilterModes.indexOf(current);
        return authorFilterModes[(idx + 1) % authorFilterModes.length];
      });
      setSelectedIndex(0);
      setScrollOffset(0);
    },
    search: () => setSearchMode(true),
    quit: () => onExit(),
  });

  // Fires first (LIFO) — handles search text input and page/home/end navigation.
  useKeyboard((key) => {
    if (searchMode) {
      const shouldCommit =
        key.name === 'return' || key.name === 'tab' ||
        key.name === 'up' || key.name === 'down' || key.raw === '\t';
      if (key.name === 'escape') {
        setSearchMode(false);
        setSearchQuery('');
      } else if (shouldCommit) {
        setSearchMode(false);
      } else if (key.name === 'backspace') {
        setSearchQuery((q) => q.slice(0, -1));
      } else if (key.raw && key.raw.length === 1 && key.raw >= ' ') {
        setSearchQuery((q) => q + key.raw);
        setSelectedIndex(0);
        setScrollOffset(0);
      }
      return true;
    }
    if (handleListKey(key.name, selectedIndex, filteredBranches.length, listHeight, moveTo)) return true;
  });

  const authorLabel =
    authorFilter === 'all'
      ? 'All'
      : authorFilter === 'me'
      ? currentUser || 'Me'
      : `[${authorList.join(', ')}]`;

  // Column widths — fixed right columns, branch gets the remainder
  const prCol = 16;
  const authorCol = 18;
  const dateCol = 18;
  // 2 chars for marker, 3 chars for gaps between columns, 2 for leading space
  const branchCol = Math.max(12, width - prCol - authorCol - dateCol - 7);

  const visibleBranches = filteredBranches.slice(
    scrollOffset,
    scrollOffset + listHeight
  );
  const tableFocused = !searchMode;

  return (
    <box
      flexDirection="column"
      style={{ width: '100%', height: '100%', padding: 1 }}
    >
      {/* Header */}
      <box style={{ height: 1, width: '100%' }}>
        <text
          content={` git-switchboard  Remote: ${
            showRemote ? 'ON' : 'OFF'
          } | Author: ${authorLabel}${
            searchQuery ? ` | Search: ${searchQuery}` : ''
          }${
            searchMode
              ? ` | (type to search, [${RETURN_SYMBOL}] confirm)`
              : ''
          }`}
          fg="#7aa2f7"
        />
      </box>

      <box style={{ height: 1 }} />

      {/* Column headers */}
      <box style={{ height: 1, width: '100%' }}>
        <text
          content={`   ${fit('Branch', branchCol)} ${fit(
            'Author',
            authorCol
          )} ${fit('Updated', dateCol)} ${fit('PR', prCol)}`}
          fg={tableFocused ? '#bb9af7' : muteColor('#bb9af7')}
        />
      </box>

      {/* Branch list + scrollbar */}
      <ScrollList
        totalItems={filteredBranches.length}
        selectedIndex={selectedIndex}
        scrollOffset={scrollOffset}
        listHeight={listHeight}
        onMove={moveTo}
      >
        {visibleBranches.map((branch, i) => {
          const actualIndex = scrollOffset + i;
          const isSelected = actualIndex === selectedIndex;
          const bg = isSelected
            ? tableFocused
              ? '#292e42'
              : muteColor('#292e42', 0.35)
            : undefined;
          const marker = branch.isCurrent ? ' * ' : '   ';
          const rowColor = branch.isCurrent
            ? '#73daca'
            : branch.isRemote
            ? '#ff9e64'
            : '#c0caf5';

          const prText = branch.pr
            ? `#${branch.pr.number} ${branch.pr.draft ? 'Draft' : 'Open'}`
            : '-';

          const line =
            marker +
            fit(branch.name, branchCol) +
            ' ' +
            fit(branch.author, authorCol) +
            ' ' +
            fit(branch.relativeDate, dateCol) +
            ' ' +
            fit(prText, prCol);

          return (
            <box
              key={branch.name}
              style={{
                height: 1,
                width: '100%',
                backgroundColor: bg,
              }}
              onMouseDown={() => {
                if (actualIndex === selectedIndex) {
                  onSelect(branch);
                } else {
                  moveTo(actualIndex);
                }
              }}
            >
              <text
                content={line}
                fg={tableFocused ? rowColor : muteColor(rowColor)}
              />
            </box>
          );
        })}
      </ScrollList>

      {/* Footer */}
      <box style={{ height: 1, width: '100%' }}>
        <text
          content={` ${footerParts(keybinds).join(' | ')}`}
          fg={tableFocused ? '#565f89' : muteColor('#565f89', 0.3)}
        />
      </box>
    </box>
  );
}

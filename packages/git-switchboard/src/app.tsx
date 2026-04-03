import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useCallback, useMemo, useState } from 'react';
import { muteColor } from './colors.js';
import { ScrollList, handleListKey } from './scroll-list.js';
import type { AuthorFilterMode, BranchWithPR } from './types.js';
import { DOWN_ARROW, ELLIPSIS, RETURN_SYMBOL, UP_ARROW } from './unicode.js';
import { useExitOnCtrlC } from './use-exit-on-ctrl-c.js';

/** Truncate string to fit width, adding ellipsis if needed */
function fit(str: string, width: number): string {
  if (str.length <= width) return str.padEnd(width);
  return str.slice(0, width - 1) + ELLIPSIS;
}

interface AppProps {
  branches: BranchWithPR[];
  currentUser: string;
  /** All names the current user goes by (for "me" filter) */
  currentUserAliases: string[];
  authorList: string[];
  initialShowRemote: boolean;
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
  onSelect,
  onExit,
  fetchBranches,
}: AppProps) {
  useExitOnCtrlC();
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

  useKeyboard((key) => {
    if (searchMode) {
      const shouldCommitSearch =
        key.name === 'return' ||
        key.name === 'tab' ||
        key.name === 'up' ||
        key.name === 'down' ||
        key.raw === '\t';

      if (key.name === 'escape') {
        setSearchMode(false);
        setSearchQuery('');
      } else if (shouldCommitSearch) {
        setSearchMode(false);
      } else if (key.name === 'backspace') {
        setSearchQuery((q) => q.slice(0, -1));
      } else if (key.raw && key.raw.length === 1 && key.raw >= ' ') {
        setSearchQuery((q) => q + key.raw);
        setSelectedIndex(0);
        setScrollOffset(0);
      }
      return;
    }

    if (handleListKey(key.name, selectedIndex, filteredBranches.length, listHeight, moveTo)) return;

    switch (key.name) {
      case 'up':
      case 'k':
        moveTo(selectedIndex - 1);
        break;
      case 'down':
      case 'j':
        moveTo(selectedIndex + 1);
        break;
      case 'return': {
        const branch = filteredBranches[selectedIndex];
        if (branch) onSelect(branch);
        break;
      }
      case 'r': {
        const newShowRemote = !showRemote;
        setShowRemote(newShowRemote);
        const newBranches = fetchBranches(newShowRemote);
        setBranches(newBranches);
        setSelectedIndex(0);
        setScrollOffset(0);
        break;
      }
      case 'a': {
        setAuthorFilter((current) => {
          const idx = authorFilterModes.indexOf(current);
          return authorFilterModes[(idx + 1) % authorFilterModes.length];
        });
        setSelectedIndex(0);
        setScrollOffset(0);
        break;
      }
      case 'escape':
      case 'q':
        onExit();
        break;
      default:
        if (key.raw === '/') {
          setSearchMode(true);
        }
        break;
    }
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
          content={` [${UP_ARROW}\\${DOWN_ARROW}] Navigate | [${RETURN_SYMBOL}] Select | [r]emote | [a]uthor | [/] Search | [q]uit`}
          fg={tableFocused ? '#565f89' : muteColor('#565f89', 0.3)}
        />
      </box>
    </box>
  );
}

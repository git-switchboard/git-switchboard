import { useKeyboard } from '@opentui/react';
import { useState } from 'react';
import { useKeybinds } from './use-keybinds.js';
import type { LocalRepo } from './scanner.js';
import { useExitOnCtrlC } from './use-exit-on-ctrl-c.js';
import { footerParts } from './view.js';
import type { ViewProps } from './view.js';
import { useHistory } from './tui-router.js';

interface ClonePromptProps extends ViewProps {
  repoId: string;
  branchName: string;
  matches: LocalRepo[];
  /** Called when a clone is selected. After it resolves, navigation goes back. */
  onSelect: (repo: LocalRepo, alreadyCheckedOut: boolean) => Promise<void>;
  onCreateWorktree: (path: string) => void;
}

export function ClonePrompt({
  repoId,
  branchName,
  matches,
  onSelect,
  onCreateWorktree,
  keybinds,
}: ClonePromptProps) {
  useExitOnCtrlC();
  const { goBack } = useHistory();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inputMode, setInputMode] = useState(false);
  const [worktreePath, setWorktreePath] = useState('');

  // Items: existing clones + "Create new worktree" option
  const items = [
    ...matches.map((m) => {
      const onBranch = m.currentBranch === branchName;
      let status = m.isClean ? 'clean' : 'dirty';
      if (onBranch) status += ', on branch';
      const suffix = m.isWorktree ? ' [worktree]' : '';
      return {
        label: `${m.path} (${status})${suffix}`,
        type: 'clone' as const,
        repo: m,
        onBranch,
      };
    }),
    {
      label: '+ Create new worktree',
      type: 'new-worktree' as const,
      repo: undefined as LocalRepo | undefined,
      onBranch: false,
    },
  ];

  const clampIndex = (idx: number) =>
    Math.max(0, Math.min(idx, items.length - 1));

  useKeybinds(keybinds, {
    navigate: (key) => {
      if (key.name === 'up' || key.name === 'k') setSelectedIndex((i) => clampIndex(i - 1));
      else setSelectedIndex((i) => clampIndex(i + 1));
    },
    select: () => {
      const item = items[selectedIndex];
      if (item.type === 'clone' && item.repo) {
        void onSelect(item.repo, item.onBranch).then(() => goBack());
      } else if (item.type === 'new-worktree') {
        setInputMode(true);
      }
    },
    back: () => goBack(),
    confirmInput: () => {
      if (worktreePath) onCreateWorktree(worktreePath);
    },
    cancelInput: () => {
      setInputMode(false);
      setWorktreePath('');
    },
  }, { show: { confirmInput: inputMode, cancelInput: inputMode } });

  // Fires first (LIFO) — handles worktree path text input.
  useKeyboard((key) => {
    if (!inputMode) return;
    if (key.name === 'backspace') {
      setWorktreePath((p) => p.slice(0, -1));
      return true;
    }
    if (key.raw && key.raw.length === 1 && key.raw >= ' ') {
      setWorktreePath((p) => p + key.raw);
      return true;
    }
    // Non-printable keys fall through to let confirmInput/cancelInput fire.
  });

  return (
    <box
      flexDirection="column"
      style={{ width: '100%', height: '100%', padding: 1 }}
    >
      <box style={{ height: 1, width: '100%' }}>
        <text
          content={` Select clone for ${repoId} (branch: ${branchName})`}
          fg="#7aa2f7"
        />
      </box>

      <box style={{ height: 1 }} />

      {inputMode ? (
        <box
          style={{ height: 3, width: '100%', border: true }}
          title="Worktree path (relative to cwd or absolute)"
        >
          <text content={worktreePath || ' '} fg="#c0caf5" />
        </box>
      ) : (
        <box flexDirection="column" style={{ flexGrow: 1, width: '100%' }}>
          {items.map((item, i) => {
            const isSelected = i === selectedIndex;
            const bg = isSelected ? '#292e42' : undefined;
            const fg =
              item.type === 'new-worktree'
                ? '#7aa2f7'
                : item.onBranch
                ? '#73daca'
                : '#c0caf5';

            return (
              <box
                key={item.label}
                style={{ height: 1, width: '100%', backgroundColor: bg }}
              >
                <text
                  content={` ${item.onBranch ? '* ' : '  '}${item.label}`}
                  fg={fg}
                />
              </box>
            );
          })}
        </box>
      )}

      <box style={{ height: 1, width: '100%' }}>
        <text
          content={` ${footerParts(keybinds, { confirmInput: inputMode, cancelInput: inputMode, navigate: !inputMode, select: !inputMode, back: !inputMode }).join(' | ')}`}
          fg="#565f89"
        />
      </box>
    </box>
  );
}

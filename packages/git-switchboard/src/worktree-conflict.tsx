import { useState } from 'react';
import { useFocusedKeyboard, useFocusOwner } from './focus-stack.js';
import { useKeybinds } from './use-keybinds.js';
import { useHistory, useNavigate } from './tui-router.js';
import { useExitOnCtrlC } from './use-exit-on-ctrl-c.js';
import { footerParts } from './view.js';
import type { ViewProps } from './view.js';
import type { BranchWithPR, WorktreeConflictAction } from './types.js';

interface WorktreeConflictProps extends ViewProps {
  branch: BranchWithPR;
  worktreePath: string;
  onAction: (action: WorktreeConflictAction) => void;
  getWorkingTreeDirtyFiles: () => string[];
  getWorktreeDirtyFiles: (path: string) => string[];
  branchExists: (name: string) => boolean;
}

type InputTarget =
  | 'checkout-new-branch'
  | 'move-worktree-to-new-branch'
  | 'move-worktree-to-existing-branch';

interface Option {
  label: string;
  inputTarget: InputTarget | null;
}

function buildOptions(branchName: string, worktreePath: string): Option[] {
  return [
    {
      label: `Open editor in ${worktreePath}`,
      inputTarget: null,
    },
    {
      label: `Checkout new branch from '${branchName}' here`,
      inputTarget: 'checkout-new-branch',
    },
    {
      label: `Move worktree to new branch from '${branchName}'`,
      inputTarget: 'move-worktree-to-new-branch',
    },
    {
      label: `Move worktree to a different branch`,
      inputTarget: 'move-worktree-to-existing-branch',
    },
  ];
}

function inputLabel(target: InputTarget): string {
  if (target === 'checkout-new-branch') return 'New branch name';
  if (target === 'move-worktree-to-new-branch') return 'New branch name';
  return 'Branch to switch worktree to';
}

/** Any action that involves a checkout in the current worktree (and may need stash). */
type StashableAction = Extract<WorktreeConflictAction, { stashCurrentFirst: boolean }>;

// Inline screen types to avoid circular dependency with branch-router.tsx
type NavScreen =
  | {
      type: 'dirty-checkout';
      branch: BranchWithPR;
      dirtyFiles: string[];
      pendingWorktreeAction?: StashableAction;
    }
  | {
      type: 'other-dirty-checkout';
      branch: BranchWithPR;
      otherWorktreePath: string;
      dirtyFiles: string[];
      pendingAction: Extract<WorktreeConflictAction, { type: 'move-worktree-to-existing-branch' }>;
    };

export function WorktreeConflict({
  branch,
  worktreePath,
  onAction,
  getWorkingTreeDirtyFiles,
  getWorktreeDirtyFiles,
  branchExists,
  keybinds,
}: WorktreeConflictProps) {
  useExitOnCtrlC();
  const { goBack } = useHistory();
  const navigate = useNavigate<NavScreen>();
  const branchName = branch.isRemote
    ? branch.name.replace(/^origin\//, '')
    : branch.name;

  const options = buildOptions(branchName, worktreePath);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inputMode, setInputMode] = useState(false);
  useFocusOwner('wt-input', inputMode);
  const [inputTarget, setInputTarget] = useState<InputTarget | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState('');

  const clampIndex = (idx: number) =>
    Math.max(0, Math.min(idx, options.length - 1));

  // Default keybinds — fire when no focus is claimed.
  useKeybinds(
    keybinds,
    {
      navigate: (key) => {
        if (key.name === 'up' || key.name === 'k') setSelectedIndex((i) => clampIndex(i - 1));
        else setSelectedIndex((i) => clampIndex(i + 1));
      },
      select: () => {
        const option = options[selectedIndex];
        if (!option) return;
        if (option.inputTarget === null) {
          // Open editor — no input needed
          onAction({ type: 'open-editor', worktreePath });
        } else {
          setInputTarget(option.inputTarget);
          setInputMode(true);
          setInputValue('');
        }
      },
      back: () => goBack(),
    },
    { show: { navigate: !inputMode, select: !inputMode, back: !inputMode } }
  );

  // Input mode keybinds — fire when wt-input focus is active.
  useKeybinds(keybinds, {
    confirmInput: () => {
      if (!inputValue.trim()) return;
      const target = inputTarget!;
      const value = inputValue.trim();

      // ── Validate branch name ──────────────────────────────────
      if (target === 'checkout-new-branch' || target === 'move-worktree-to-new-branch') {
        if (branchExists(value)) {
          setInputError(`Branch '${value}' already exists`);
          return;
        }
      } else if (target === 'move-worktree-to-existing-branch') {
        if (!branchExists(value)) {
          setInputError(`Branch '${value}' does not exist`);
          return;
        }
      }

      // ── Helper: navigate to dirty-checkout or emit action ─────
      const emitOrDirtyCheck = (action: StashableAction) => {
        const currentDirty = getWorkingTreeDirtyFiles();
        if (currentDirty.length > 0) {
          navigate({ type: 'dirty-checkout', branch, dirtyFiles: currentDirty, pendingWorktreeAction: action });
        } else {
          onAction(action);
        }
      };

      if (target === 'checkout-new-branch') {
        emitOrDirtyCheck({
          type: 'checkout-new-branch',
          newBranchName: value,
          fromBranch: branchName,
          stashCurrentFirst: false,
        });
        return;
      }

      if (target === 'move-worktree-to-new-branch') {
        emitOrDirtyCheck({
          type: 'move-worktree-to-new-branch',
          worktreePath,
          newBranchName: value,
          fromBranch: branchName,
          thenCheckout: branchName,
          stashCurrentFirst: false,
        });
        return;
      }

      const moveAction: Extract<WorktreeConflictAction, { type: 'move-worktree-to-existing-branch' }> = {
        type: 'move-worktree-to-existing-branch',
        worktreePath,
        targetBranch: value,
        thenCheckout: branchName,
        stashOtherFirst: false,
        stashCurrentFirst: false,
      };
      const otherDirty = getWorktreeDirtyFiles(worktreePath);
      if (otherDirty.length > 0) {
        navigate({
          type: 'other-dirty-checkout',
          branch,
          otherWorktreePath: worktreePath,
          dirtyFiles: otherDirty,
          pendingAction: moveAction,
        });
        return;
      }
      emitOrDirtyCheck(moveAction);
    },
    cancelInput: () => {
      setInputMode(false);
      setInputTarget(null);
      setInputValue('');
      setInputError('');
    },
  }, { show: { confirmInput: inputMode, cancelInput: inputMode }, focusId: 'wt-input' });

  // Text input — only fires when wt-input focus is active.
  useFocusedKeyboard((key) => {
    if (key.name === 'backspace') {
      setInputValue((v) => v.slice(0, -1));
      setInputError('');
      return true;
    }
    if (key.raw && key.raw.length === 1 && key.raw >= ' ') {
      setInputValue((v) => v + key.raw);
      setInputError('');
      return true;
    }
    // return/escape fall through to keybinds (confirmInput / cancelInput)
  }, { focusId: 'wt-input' });

  const footerStr = footerParts(keybinds, {
    confirmInput: inputMode,
    cancelInput: inputMode,
    navigate: !inputMode,
    select: !inputMode,
    back: !inputMode,
  }).join(' | ');

  return (
    <box flexDirection="column" style={{ width: '100%', height: '100%', padding: 1 }}>
      <box style={{ height: 1, width: '100%' }}>
        <text
          content={` Branch '${branchName}' is checked out in another worktree`}
          fg="#e0af68"
        />
      </box>
      <box style={{ height: 1, width: '100%' }}>
        <text content={`  ${worktreePath}`} fg="#565f89" />
      </box>

      <box style={{ height: 1 }} />

      {inputMode && inputTarget ? (
        <box flexDirection="column" style={{ width: '100%' }}>
          <box
            style={{ height: 3, width: '100%', border: true }}
            title={inputLabel(inputTarget)}
          >
            <text content={inputValue || ' '} fg="#c0caf5" />
          </box>
          {inputError ? (
            <box style={{ height: 1, width: '100%' }}>
              <text content={`  ${inputError}`} fg="#f7768e" />
            </box>
          ) : null}
        </box>
      ) : (
        <box flexDirection="column" style={{ flexGrow: 1, width: '100%' }}>
          {options.map((option, i) => {
            const isSelected = i === selectedIndex;
            return (
              <box
                key={option.label}
                style={{ height: 1, width: '100%', backgroundColor: isSelected ? '#292e42' : undefined }}
              >
                <text
                  content={`  ${isSelected ? '› ' : '  '}${option.label}`}
                  fg={isSelected ? '#7aa2f7' : '#c0caf5'}
                />
              </box>
            );
          })}
        </box>
      )}

      <box style={{ height: 1, width: '100%' }}>
        <text content={` ${footerStr}`} fg="#565f89" />
      </box>
    </box>
  );
}

import { createContext, useContext, useState } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import { App } from './app.js';
import { WorktreeConflict } from './worktree-conflict.js';
import { DirtyCheckout } from './dirty-checkout.js';
import { ProviderStatusModal } from './provider-status.js';
import { TuiRouter, useNavigate } from './tui-router.js';
import { defineCommand, defineView } from './view.js';
import type { BranchWithPR, WorktreeConflictAction, WorktreeInfo } from './types.js';
import { BACKSPACE_SYMBOL, DOWN_ARROW, ESC_SYMBOL, RETURN_SYMBOL, UP_ARROW } from './unicode.js';

/** Any action that involves a checkout (and thus may need a stash). */
type StashableAction = Extract<WorktreeConflictAction, { stashCurrentFirst: boolean }>;

export type BranchScreen =
  | { type: 'branch-picker' }
  | { type: 'worktree-conflict'; branch: BranchWithPR; worktreePath: string }
  /**
   * Dirty-checkout for the CURRENT worktree.
   * If pendingWorktreeAction is set, confirming emits that action (with stash flags)
   * rather than a plain checkout.
   */
  | { type: 'dirty-checkout'; branch: BranchWithPR; dirtyFiles: string[]; pendingWorktreeAction?: StashableAction }
  /**
   * Dirty-checkout for the OTHER worktree (only applicable before move-to-existing-branch).
   * After the user decides, we chain into dirty-checkout for the current worktree (if needed).
   */
  | {
      type: 'other-dirty-checkout';
      branch: BranchWithPR;
      otherWorktreePath: string;
      dirtyFiles: string[];
      pendingAction: Extract<WorktreeConflictAction, { type: 'move-worktree-to-existing-branch' }>;
    };

// ─── Branch context ───────────────────────────────────────────────────────────

export interface BranchRouterProps {
  branches: BranchWithPR[];
  currentUser: string;
  currentUserAliases: string[];
  authorList: string[];
  initialShowRemote: boolean;
  worktrees: WorktreeInfo[];
  getWorkingTreeDirtyFiles: () => string[];
  getWorktreeDirtyFiles: (path: string) => string[];
  branchExists: (name: string) => boolean;
  onSelect: (branch: BranchWithPR) => void;
  onStashAndCheckout: (branch: BranchWithPR) => void;
  onWorktreeAction: (action: WorktreeConflictAction) => void;
  onExit: () => void;
  onProviderStatus?: () => void;
  fetchBranches: (includeRemote: boolean) => BranchWithPR[];
}

const BranchCtx = createContext<BranchRouterProps | null>(null);

function useBranchCtx(): BranchRouterProps {
  const ctx = useContext(BranchCtx);
  if (!ctx) throw new Error('useBranchCtx must be used inside BranchRouter');
  return ctx;
}

// ─── View screen components ────────────────────────────────────────────────────

function BranchPickerScreen() {
  const { keybinds } = BRANCH_COMMAND.views['branch-picker'];
  const ctx = useBranchCtx();
  return <App keybinds={keybinds} {...ctx} />;
}

function WorktreeConflictScreen({ screen }: { screen: Extract<BranchScreen, { type: 'worktree-conflict' }> }) {
  const { keybinds } = BRANCH_COMMAND.views['worktree-conflict'];
  const { onWorktreeAction, getWorkingTreeDirtyFiles, getWorktreeDirtyFiles, branchExists } = useBranchCtx();
  return (
    <WorktreeConflict
      keybinds={keybinds}
      branch={screen.branch}
      worktreePath={screen.worktreePath}
      onAction={onWorktreeAction}
      getWorkingTreeDirtyFiles={getWorkingTreeDirtyFiles}
      getWorktreeDirtyFiles={getWorktreeDirtyFiles}
      branchExists={branchExists}
    />
  );
}

function DirtyCheckoutScreen({ screen }: { screen: Extract<BranchScreen, { type: 'dirty-checkout' }> }) {
  const { keybinds } = BRANCH_COMMAND.views['dirty-checkout'];
  const { onSelect, onStashAndCheckout, onWorktreeAction } = useBranchCtx();
  const branchName = screen.branch.isRemote
    ? screen.branch.name.replace(/^origin\//, '')
    : screen.branch.name;

  if (screen.pendingWorktreeAction) {
    const pending = screen.pendingWorktreeAction;
    return (
      <DirtyCheckout
        keybinds={keybinds}
        heading={`Working tree has uncommitted changes (${screen.dirtyFiles.length} file${screen.dirtyFiles.length === 1 ? '' : 's'})`}
        context={`Checking out: ${branchName}`}
        dirtyFiles={screen.dirtyFiles}
        onCheckoutAnyway={() => onWorktreeAction({ ...pending, stashCurrentFirst: false })}
        onStashAndCheckout={() => onWorktreeAction({ ...pending, stashCurrentFirst: true })}
      />
    );
  }

  return (
    <DirtyCheckout
      keybinds={keybinds}
      heading={`Working tree has uncommitted changes (${screen.dirtyFiles.length} file${screen.dirtyFiles.length === 1 ? '' : 's'})`}
      context={`Checking out: ${branchName}`}
      dirtyFiles={screen.dirtyFiles}
      onCheckoutAnyway={() => onSelect(screen.branch)}
      onStashAndCheckout={() => onStashAndCheckout(screen.branch)}
    />
  );
}

function OtherDirtyCheckoutScreen({ screen }: { screen: Extract<BranchScreen, { type: 'other-dirty-checkout' }> }) {
  const { keybinds } = BRANCH_COMMAND.views['other-dirty-checkout'];
  const { getWorkingTreeDirtyFiles, onWorktreeAction } = useBranchCtx();
  const navigate = useNavigate<BranchScreen>();

  const proceed = (stashOtherFirst: boolean) => {
    const updatedAction = { ...screen.pendingAction, stashOtherFirst };
    const currentDirty = getWorkingTreeDirtyFiles();
    if (currentDirty.length > 0) {
      navigate({
        type: 'dirty-checkout',
        branch: screen.branch,
        dirtyFiles: currentDirty,
        pendingWorktreeAction: updatedAction,
      });
    } else {
      onWorktreeAction({ ...updatedAction, stashCurrentFirst: false });
    }
  };

  return (
    <DirtyCheckout
      keybinds={keybinds}
      heading={`Worktree has uncommitted changes (${screen.dirtyFiles.length} file${screen.dirtyFiles.length === 1 ? '' : 's'})`}
      context={`Moving: ${screen.otherWorktreePath}`}
      dirtyFiles={screen.dirtyFiles}
      onCheckoutAnyway={() => proceed(false)}
      onStashAndCheckout={() => proceed(true)}
    />
  );
}

// ─── Module-level BRANCH_COMMAND ──────────────────────────────────────────────

const dirtyCheckoutKeybinds = {
  navigate: {
    keys: ['up', 'k', 'down', 'j'] as const,
    label: 'j/k or Up/Down',
    description: 'Navigate',
    terminal: `[${UP_ARROW}\\${DOWN_ARROW}] Navigate`,
  },
  select: {
    keys: ['return'] as const,
    label: 'Enter',
    description: 'Select option',
    terminal: `[${RETURN_SYMBOL}] Select`,
  },
  back: {
    keys: ['backspace', 'q', 'escape'] as const,
    label: 'Backspace, q or Esc',
    description: 'Go back',
    terminal: `[${BACKSPACE_SYMBOL}] Back`,
  },
};

export const BRANCH_COMMAND = defineCommand<BranchScreen>()({
  name: 'default',
  description: 'Interactive branch picker TUI.',
  views: {
    'branch-picker': defineView<BranchScreen>()({
      keybinds: {
        navigate: {
          keys: ['up', 'k', 'down', 'j'],
          label: 'j/k or Up/Down',
          description: 'Navigate',
          terminal: `[${UP_ARROW}\\${DOWN_ARROW}] Navigate`,
        },
        select: {
          keys: ['return'],
          label: 'Enter',
          description: 'Checkout selected branch',
          terminal: `[${RETURN_SYMBOL}] Select`,
        },
        toggleRemote: {
          keys: ['r'],
          label: 'r',
          description: 'Toggle remote branches',
          terminal: '[r]emote',
        },
        cycleAuthor: {
          keys: ['a'],
          label: 'a',
          description: 'Cycle author filter',
          terminal: '[a]uthor',
        },
        providerStatus: { keys: ['p'], label: 'p', description: 'Provider status', terminal: '[p]roviders' },
        search: { keys: [{ raw: '/' }], label: '/', description: 'Search', terminal: '[/] Search' },
        quit: { keys: ['q', 'escape'], label: 'q or Esc', description: 'Quit', terminal: '[q]uit' },
      },
      render: () => <BranchPickerScreen />,
    }),

    'worktree-conflict': defineView<BranchScreen>()({
      keybinds: {
        // confirmInput and cancelInput must come first so they win on
        // 'return'/'escape' when inputMode is active (useKeybinds is FIFO within one call).
        confirmInput: {
          keys: ['return'],
          label: 'Enter',
          description: 'Confirm',
          terminal: `[${RETURN_SYMBOL}] Confirm`,
          conditional: true,
        },
        cancelInput: {
          keys: ['escape'],
          label: 'Esc',
          description: 'Cancel input',
          terminal: `[${ESC_SYMBOL}] Cancel`,
          conditional: true,
        },
        navigate: {
          keys: ['up', 'k', 'down', 'j'],
          label: 'j/k or Up/Down',
          description: 'Navigate',
          terminal: `[${UP_ARROW}\\${DOWN_ARROW}] Navigate`,
          conditional: true,
        },
        select: {
          keys: ['return'],
          label: 'Enter',
          description: 'Select option',
          terminal: `[${RETURN_SYMBOL}] Select`,
          conditional: true,
        },
        back: {
          keys: ['backspace', 'q', 'escape'],
          label: 'Backspace, q or Esc',
          description: 'Go back',
          terminal: `[${BACKSPACE_SYMBOL}] Back`,
          conditional: true,
        },
      },
      render: (s) => (
        <WorktreeConflictScreen screen={s as Extract<BranchScreen, { type: 'worktree-conflict' }>} />
      ),
    }),

    'dirty-checkout': defineView<BranchScreen>()({
      keybinds: dirtyCheckoutKeybinds,
      render: (s) => (
        <DirtyCheckoutScreen screen={s as Extract<BranchScreen, { type: 'dirty-checkout' }>} />
      ),
    }),

    'other-dirty-checkout': defineView<BranchScreen>()({
      keybinds: dirtyCheckoutKeybinds,
      render: (s) => (
        <OtherDirtyCheckoutScreen screen={s as Extract<BranchScreen, { type: 'other-dirty-checkout' }>} />
      ),
    }),
  },
});

// ─── BranchRouter ─────────────────────────────────────────────────────────────

export function BranchRouter(props: BranchRouterProps) {
  const [showProviderStatus, setShowProviderStatus] = useState(false);
  const { width, height } = useTerminalDimensions();

  const overlay = showProviderStatus ? (
    <ProviderStatusModal
      width={width}
      height={height}
      onClose={() => setShowProviderStatus(false)}
    />
  ) : undefined;

  const ctxValue = { ...props, onProviderStatus: () => setShowProviderStatus(true) };

  return (
    <BranchCtx.Provider value={ctxValue}>
      <TuiRouter<BranchScreen>
        views={BRANCH_COMMAND.views}
        initialScreen={{ type: 'branch-picker' }}
        overlay={overlay}
      />
    </BranchCtx.Provider>
  );
}

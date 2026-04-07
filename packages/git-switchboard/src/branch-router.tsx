import { createContext, useContext } from 'react';
import { App } from './app.js';
import { TuiRouter } from './tui-router.js';
import { defineCommand, defineView } from './view.js';
import type { BranchWithPR } from './types.js';
import { DOWN_ARROW, RETURN_SYMBOL, UP_ARROW } from './unicode.js';

export type BranchScreen = { type: 'branch-picker' };

// ─── Branch context ───────────────────────────────────────────────────────────

export interface BranchRouterProps {
  branches: BranchWithPR[];
  currentUser: string;
  currentUserAliases: string[];
  authorList: string[];
  initialShowRemote: boolean;
  onSelect: (branch: BranchWithPR) => void;
  onExit: () => void;
  fetchBranches: (includeRemote: boolean) => BranchWithPR[];
}

const BranchCtx = createContext<BranchRouterProps | null>(null);

function useBranchCtx(): BranchRouterProps {
  const ctx = useContext(BranchCtx);
  if (!ctx) throw new Error('useBranchCtx must be used inside BranchRouter');
  return ctx;
}

// ─── View screen component ────────────────────────────────────────────────────

function BranchPickerScreen() {
  const { keybinds } = BRANCH_COMMAND.views['branch-picker'];
  const ctx = useBranchCtx();
  return <App keybinds={keybinds} {...ctx} />;
}

// ─── Module-level BRANCH_COMMAND ──────────────────────────────────────────────

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
        search: { keys: [{ raw: '/' }], label: '/', description: 'Search', terminal: '[/] Search' },
        quit: { keys: ['q', 'escape'], label: 'q or Esc', description: 'Quit', terminal: '[q]uit' },
      },
      render: () => <BranchPickerScreen />,
    }),
  },
});

// ─── BranchRouter ─────────────────────────────────────────────────────────────

export function BranchRouter(props: BranchRouterProps) {
  return (
    <BranchCtx.Provider value={props}>
      <TuiRouter<BranchScreen>
        views={BRANCH_COMMAND.views}
        initialScreen={{ type: 'branch-picker' }}
      />
    </BranchCtx.Provider>
  );
}

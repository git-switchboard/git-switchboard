import { ConnectList } from './connect-list.js';
import { ConnectDetail } from './connect-detail.js';
import { ConnectSetup } from './connect-setup.js';
import { TuiRouter } from './tui-router.js';
import { defineCommand, defineView } from './view.js';
import { UP_ARROW, DOWN_ARROW, RETURN_SYMBOL, LEFT_ARROW } from './unicode.js';

export type ConnectScreen =
  | { type: 'provider-list' }
  | { type: 'provider-detail'; providerName: string }
  | { type: 'setup'; providerName: string };

export const CONNECT_COMMAND = defineCommand<ConnectScreen>()({
  name: 'connect',
  description: 'Manage provider tokens.',
  views: {
    'provider-list': defineView<ConnectScreen>()({
      keybinds: {
        navigate: {
          keys: ['up', 'k', 'down', 'j'],
          label: 'j/k or Up/Down',
          description: 'Navigate',
          terminal: `[${UP_ARROW}${DOWN_ARROW}] Navigate`,
        },
        select: {
          keys: ['return'],
          label: 'Enter',
          description: 'View provider',
          terminal: `[${RETURN_SYMBOL}] Select`,
        },
        quit: {
          keys: ['q', 'escape'],
          label: 'q or Esc',
          description: 'Quit',
          terminal: '[q]uit',
        },
      },
      render: (_, keybinds) => <ConnectList keybinds={keybinds} />,
    }),

    'provider-detail': defineView<ConnectScreen>()({
      keybinds: {
        setup: {
          keys: ['s'],
          label: 's',
          description: 'Setup new token',
          terminal: '[s]etup',
        },
        disconnect: {
          keys: ['d'],
          label: 'd',
          description: 'Disconnect',
          terminal: '[d]isconnect',
          conditional: true,
        },
        confirmDisconnect: {
          keys: ['y'],
          label: 'y',
          description: 'Confirm disconnect',
          terminal: '[y]es, remove',
          conditional: true,
        },
        cancelDisconnect: {
          keys: ['n', 'escape'],
          label: 'n or Esc',
          description: 'Cancel',
          terminal: '[n]o, cancel',
          conditional: true,
        },
        back: {
          keys: ['backspace', 'left'],
          label: 'Backspace',
          description: 'Back to list',
          terminal: `[${LEFT_ARROW}] Back`,
        },
        quit: {
          keys: ['q'],
          label: 'q',
          description: 'Quit',
          terminal: '[q]uit',
        },
      },
      render: (screen, keybinds) => (
        <ConnectDetail
          providerName={
            (screen as Extract<ConnectScreen, { type: 'provider-detail' }>).providerName
          }
          keybinds={keybinds}
        />
      ),
    }),

    setup: defineView<ConnectScreen>()({
      keybinds: {
        navigate: {
          keys: ['up', 'k', 'down', 'j'],
          label: 'j/k or Up/Down',
          description: 'Navigate options',
          terminal: `[${UP_ARROW}${DOWN_ARROW}] Navigate`,
        },
        select: {
          keys: ['return'],
          label: 'Enter',
          description: 'Confirm',
          terminal: `[${RETURN_SYMBOL}] Confirm`,
        },
        back: {
          keys: ['escape'],
          label: 'Esc',
          description: 'Back',
          terminal: `[Esc] Back`,
        },
        quit: {
          keys: ['q'],
          label: 'q',
          description: 'Quit',
          terminal: '[q]uit',
        },
      },
      render: (screen, keybinds) => (
        <ConnectSetup
          providerName={
            (screen as Extract<ConnectScreen, { type: 'setup' }>).providerName
          }
          keybinds={keybinds}
        />
      ),
    }),
  },
});

export function ConnectRouter({ initialProvider }: { initialProvider?: string }) {
  const initialScreen: ConnectScreen = initialProvider
    ? { type: 'setup', providerName: initialProvider }
    : { type: 'provider-list' };

  return (
    <TuiRouter<ConnectScreen>
      views={CONNECT_COMMAND.views}
      initialScreen={initialScreen}
    />
  );
}

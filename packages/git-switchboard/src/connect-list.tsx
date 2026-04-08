import { useState, useEffect } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import type { Keybind } from './view.js';
import { footerParts } from './view.js';
import { useKeybinds } from './use-keybinds.js';
import { buildFooterRows, FooterRows } from './footer.js';
import { useNavigate } from './tui-router.js';
import { isConfigured } from './token-store.js';
import { ALL_PROVIDERS } from './providers.js';
import { CHECKMARK, CROSSMARK } from './unicode.js';
import type { ConnectScreen } from './connect-types.js';

export function ConnectList({ keybinds }: { keybinds: Record<string, Keybind> }) {
  const { width } = useTerminalDimensions();
  const navigate = useNavigate<ConnectScreen>();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statuses, setStatuses] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    void (async () => {
      const entries = await Promise.all(
        ALL_PROVIDERS.map(async (p) => [p.name, await isConfigured(p.name)] as const)
      );
      setStatuses(new Map(entries));
    })();
  }, []);

  useKeybinds(keybinds, {
    navigate: (key) => {
      const dir = key.name === 'up' || key.name === 'k' ? -1 : 1;
      setSelectedIndex((i) => Math.max(0, Math.min(ALL_PROVIDERS.length - 1, i + dir)));
    },
    select: () => {
      const provider = ALL_PROVIDERS[selectedIndex];
      navigate({ type: 'provider-detail', providerName: provider.name });
    },
    quit: () => {
      process.exit(0);
    },
  });

  const parts = footerParts(keybinds);
  const rows = buildFooterRows(parts, width);

  return (
    <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
      <box style={{ height: 1, width: '100%' }}>
        <text content=" Manage Connections" fg="#7aa2f7" />
      </box>
      <box style={{ height: 1, width: '100%' }}>
        <text content={'\u2500'.repeat(width)} fg="#292e42" />
      </box>
      <box flexDirection="column" style={{ flexGrow: 1 }}>
        {ALL_PROVIDERS.map((provider, index) => {
          const isActive = index === selectedIndex;
          const configured = statuses.get(provider.name);
          const statusIcon = configured ? CHECKMARK : CROSSMARK;
          const statusColor = configured ? '#9ece6a' : '#565f89';
          const statusText = configured ? 'connected' : 'not configured';
          const label = `${isActive ? '>' : ' '} ${provider.name}`;

          return (
            <box
              key={provider.name}
              style={{
                height: 1,
                width: '100%',
                backgroundColor: isActive ? '#292e42' : undefined,
              }}
              onMouseDown={() => {
                if (isActive) {
                  navigate({ type: 'provider-detail', providerName: provider.name });
                } else {
                  setSelectedIndex(index);
                }
              }}
            >
              <text
                content={` ${label}`}
                fg={isActive ? '#c0caf5' : '#a9b1d6'}
              />
              <text content={`   ${statusIcon} ${statusText}`} fg={statusColor} />
            </box>
          );
        })}
      </box>
      <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
        <text content={'\u2500'.repeat(width)} fg="#292e42" />
      </box>
      <FooterRows rows={rows} fg="#565f89" />
    </box>
  );
}

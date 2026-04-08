import { useState, useEffect } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import type { Keybind } from './view.js';
import { footerParts } from './view.js';
import { useKeybinds } from './use-keybinds.js';
import { buildFooterRows, FooterRows } from './footer.js';
import { useNavigate } from './tui-router.js';
import { resolveTokenSource } from './token-store.js';
import type { TokenSource } from './token-store.js';
import { ALL_PROVIDERS } from './providers.js';
import { CHECKMARK, CROSSMARK } from './unicode.js';
import type { ConnectScreen } from './connect-types.js';
import { useConnectExit } from './connect-router.js';

function sourceLabel(source: TokenSource): { icon: string; text: string; color: string } {
  if (!source) return { icon: CROSSMARK, text: 'not configured', color: '#565f89' };
  switch (source.type) {
    case 'config':
      return { icon: CHECKMARK, text: `connected (${source.strategy})`, color: '#9ece6a' };
    case 'env':
      return { icon: CHECKMARK, text: `via ${source.envVar}`, color: '#9ece6a' };
    case 'fallback':
      return { icon: CHECKMARK, text: 'via fallback', color: '#9ece6a' };
  }
}

export function ConnectList({ keybinds }: { keybinds: Record<string, Keybind> }) {
  const { width } = useTerminalDimensions();
  const navigate = useNavigate<ConnectScreen>();
  const onExit = useConnectExit();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sources, setSources] = useState<Map<string, TokenSource>>(new Map());

  useEffect(() => {
    void (async () => {
      const entries = await Promise.all(
        ALL_PROVIDERS.map(async (p) => [p.name, await resolveTokenSource(p)] as const)
      );
      setSources(new Map(entries));
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
    quit: () => onExit(),
  });

  const parts = footerParts(keybinds);
  const rows = buildFooterRows(parts, width);

  return (
    <box flexDirection="column" style={{ width: '100%', height: '100%', padding: 1 }}>
      {/* Header */}
      <box style={{ height: 1, width: '100%' }}>
        <text content=" Manage Connections" fg="#7aa2f7" />
      </box>

      <box style={{ height: 1 }} />

      {/* Provider list */}
      {ALL_PROVIDERS.map((provider, index) => {
        const isActive = index === selectedIndex;
        const source = sources.get(provider.name) ?? null;
        const { icon, text, color } = sourceLabel(source);
        const nameCol = 12;
        const cursor = isActive ? '>' : ' ';

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
            <text>
              <span fg={isActive ? '#c0caf5' : '#a9b1d6'}>{` ${cursor} ${provider.name.padEnd(nameCol)}`}</span>
              <span fg={color}>{`${icon} ${text}`}</span>
            </text>
          </box>
        );
      })}

      {/* Fill remaining space */}
      <box style={{ flexGrow: 1 }} />

      {/* Footer */}
      <FooterRows rows={rows} fg="#565f89" />
    </box>
  );
}

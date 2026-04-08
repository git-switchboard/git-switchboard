import { useState, useEffect } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import type { Keybind } from './view.js';
import { footerParts } from './view.js';
import { useKeybinds } from './use-keybinds.js';
import { buildFooterRows, FooterRows } from './footer.js';
import { useNavigate, useHistory } from './tui-router.js';
import { removeToken, resolveToken, resolveTokenSource } from './token-store.js';
import type { TokenSource } from './token-store.js';
import { ALL_PROVIDERS } from './providers.js';
import { CHECKMARK, CROSSMARK } from './unicode.js';
import type { ConnectScreen } from './connect-types.js';
import { useConnectExit } from './connect-router.js';

function sourceDescription(source: TokenSource): { icon: string; text: string; color: string; canDisconnect: boolean } {
  if (!source) return { icon: CROSSMARK, text: 'not configured', color: '#f7768e', canDisconnect: false };
  switch (source.type) {
    case 'config':
      return { icon: CHECKMARK, text: `connected (${source.strategy})`, color: '#9ece6a', canDisconnect: true };
    case 'env':
      return { icon: CHECKMARK, text: `via env (${source.envVar})`, color: '#9ece6a', canDisconnect: false };
    case 'fallback':
      return { icon: CHECKMARK, text: 'via fallback (e.g., gh auth token)', color: '#9ece6a', canDisconnect: false };
  }
}

export function ConnectDetail({
  providerName,
  keybinds,
}: {
  providerName: string;
  keybinds: Record<string, Keybind>;
}) {
  const { width } = useTerminalDimensions();
  const navigate = useNavigate<ConnectScreen>();
  const { goBack } = useHistory();
  const onExit = useConnectExit();
  const [source, setSource] = useState<TokenSource>(null);
  const [whoami, setWhoami] = useState<string | null>(null);
  const [whoamiError, setWhoamiError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const provider = ALL_PROVIDERS.find((p) => p.name === providerName);

  useEffect(() => {
    void (async () => {
      if (!provider) return;
      const resolved = await resolveTokenSource(provider);
      setSource(resolved);

      // Validate the token if one resolved
      if (resolved) {
        try {
          const token = await resolveToken(provider);
          if (token) {
            const displayName = await provider.validate(token);
            setWhoami(displayName);
          }
        } catch (err) {
          setWhoamiError(err instanceof Error ? err.message : 'validation failed');
        }
      }
    })();
  }, [providerName]);

  const { icon, text, color, canDisconnect } = sourceDescription(source);

  useKeybinds(
    keybinds,
    {
      setup: () => {
        navigate({ type: 'setup', providerName });
      },
      disconnect: () => {
        if (!canDisconnect) return;
        setConfirming(true);
      },
      confirmDisconnect: () => {
        void (async () => {
          await removeToken(providerName);
          setSource(null);
          setWhoami(null);
          setWhoamiError(null);
          setConfirming(false);
        })();
      },
      cancelDisconnect: () => {
        setConfirming(false);
      },
      back: () => {
        goBack();
      },
      quit: () => onExit(),
    },
    {
      show: {
        disconnect: canDisconnect && !confirming,
        confirmDisconnect: confirming,
        cancelDisconnect: confirming,
      },
    }
  );

  const parts = footerParts(keybinds, {
    disconnect: canDisconnect && !confirming,
    confirmDisconnect: confirming,
    cancelDisconnect: confirming,
  });
  const rows = buildFooterRows(parts, width);

  const displayName = provider?.name ?? providerName;
  const whoamiLine = whoami
    ? `${CHECKMARK} Authenticated as ${whoami}`
    : whoamiError
      ? `${CROSSMARK} ${whoamiError}`
      : source
        ? 'Validating...'
        : null;

  const settingsUrl = provider?.settingsUrl ?? '';

  return (
    <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
      {/* Push content to vertical center */}
      <box style={{ flexGrow: 1 }} />

      {/* Provider card */}
      <box flexDirection="column" style={{ width: '100%' }}>
        <box style={{ height: 1, width: '100%' }}>
          <text content={` ${displayName}`} fg="#7aa2f7" />
        </box>
        <box style={{ height: 1, width: '100%' }}>
          <text content={'\u2500'.repeat(width)} fg="#292e42" />
        </box>

        {/* Status */}
        <box style={{ height: 1 }}>
          <text>
            <span fg="#565f89">{"  Status      "}</span>
            <span fg={color}>{`${icon} ${text}`}</span>
          </text>
        </box>

        {/* Identity */}
        <box style={{ height: 1 }}>
          <text>
            <span fg="#565f89">{"  Identity    "}</span>
            <span fg={whoami ? '#9ece6a' : whoamiError ? '#f7768e' : '#565f89'}>
              {whoamiLine ?? 'unknown'}
            </span>
          </text>
        </box>

        {/* Settings URL */}
        <box style={{ height: 1 }}>
          <text>
            <span fg="#565f89">{"  Settings    "}</span>
            <span fg="#7aa2f7">{settingsUrl}</span>
          </text>
        </box>

        {/* Disconnect confirmation */}
        {confirming && (
          <>
            <box style={{ height: 1 }} />
            <box style={{ height: 1 }}>
              <text content={`  Remove ${displayName} token?  [y]es / [n]o`} fg="#f7768e" />
            </box>
          </>
        )}

        <box style={{ height: 1, width: '100%' }}>
          <text content={'\u2500'.repeat(width)} fg="#292e42" />
        </box>
      </box>

      {/* Push footer to bottom */}
      <box style={{ flexGrow: 1 }} />

      <box style={{ height: 1, width: '100%' }}>
        <text content={'\u2500'.repeat(width)} fg="#292e42" />
      </box>
      <FooterRows rows={rows} fg="#565f89" />
    </box>
  );
}

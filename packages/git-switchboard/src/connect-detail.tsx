import { useState, useEffect } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import type { Keybind } from './view.js';
import { footerParts } from './view.js';
import { useKeybinds } from './use-keybinds.js';
import { buildFooterRows, FooterRows } from './footer.js';
import { useNavigate, useHistory } from './tui-router.js';
import { removeToken } from './token-store.js';
import { getTokenConfig } from './config.js';
import { ALL_PROVIDERS } from './providers.js';
import { CHECKMARK, CROSSMARK } from './unicode.js';
import type { ConnectScreen } from './connect-types.js';
import type { TokenStrategy } from './config.js';

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
  const [configured, setConfigured] = useState(false);
  const [strategy, setStrategy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const provider = ALL_PROVIDERS.find((p) => p.name === providerName);

  useEffect(() => {
    void (async () => {
      const cfg = await getTokenConfig(providerName);
      const strategies = Object.keys(cfg) as TokenStrategy[];
      setConfigured(strategies.length > 0);
      setStrategy(strategies[0] ?? null);
    })();
  }, [providerName]);

  useKeybinds(
    keybinds,
    {
      setup: () => {
        navigate({ type: 'setup', providerName });
      },
      disconnect: () => {
        if (!configured) return;
        setConfirming(true);
      },
      confirmDisconnect: () => {
        void (async () => {
          await removeToken(providerName);
          setConfigured(false);
          setStrategy(null);
          setConfirming(false);
        })();
      },
      cancelDisconnect: () => {
        setConfirming(false);
      },
      back: () => {
        goBack();
      },
      quit: () => {
        process.exit(0);
      },
    },
    {
      show: {
        disconnect: configured && !confirming,
        confirmDisconnect: confirming,
        cancelDisconnect: confirming,
      },
    }
  );

  const parts = footerParts(keybinds, {
    disconnect: configured && !confirming,
    confirmDisconnect: confirming,
    cancelDisconnect: confirming,
  });
  const rows = buildFooterRows(parts, width);

  const displayName = provider?.name ?? providerName;
  const statusIcon = configured ? CHECKMARK : CROSSMARK;
  const statusColor = configured ? '#9ece6a' : '#f7768e';
  const statusText = configured
    ? `connected (${strategy})`
    : 'not configured';

  return (
    <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
      <box style={{ height: 1, width: '100%' }}>
        <text content={` ${displayName}`} fg="#7aa2f7" />
      </box>
      <box style={{ height: 1, width: '100%' }}>
        <text content={'\u2500'.repeat(width)} fg="#292e42" />
      </box>
      <box flexDirection="column" style={{ flexGrow: 1, paddingLeft: 2 }}>
        <box style={{ height: 1 }}>
          <text>
            <span fg="#a9b1d6">{"  Status: "}</span>
            <span fg={statusColor}>{`${statusIcon} ${statusText}`}</span>
          </text>
        </box>
        <box style={{ height: 1 }}>
          <text content={`  Settings: ${provider?.settingsUrl ?? ''}`} fg="#565f89" />
        </box>
        {confirming && (
          <box style={{ height: 2, marginTop: 1 }}>
            <text content={`  Remove ${displayName} token?`} fg="#f7768e" />
          </box>
        )}
      </box>
      <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
        <text content={'\u2500'.repeat(width)} fg="#292e42" />
      </box>
      <FooterRows rows={rows} fg="#565f89" />
    </box>
  );
}

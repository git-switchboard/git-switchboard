import { useFocusedKeyboard, useFocusOwner } from './focus-stack.js';
import { rateLimit as githubRateLimit } from './github.js';
import { linearRateLimit } from './linear.js';
import type { ProviderRateLimit } from './types.js';

function relativeReset(resetAt: Date): string {
  const ms = resetAt.getTime() - Date.now();
  if (ms <= 0) return 'now';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatLimit(rl: ProviderRateLimit | null, name: string): string {
  if (!rl) return `  ${name.padEnd(10)} no data`;
  return `  ${name.padEnd(10)} ${String(rl.used).padStart(5)}/${rl.limit} used   resets in ${relativeReset(rl.resetAt)}`;
}

export function ProviderStatusModal({
  width,
  height,
  onClose,
}: {
  width: number;
  height: number;
  onClose: () => void;
}) {
  useFocusOwner('provider-status', true);
  useFocusedKeyboard((key) => {
    key.stopPropagation();
    if (
      key.name === 'escape' ||
      key.raw === 'p' ||
      key.name === 'q'
    ) {
      onClose();
    }
  }, { focusId: 'provider-status' });

  const modalWidth = Math.min(50, width - 4);
  const modalHeight = 7;

  return (
    <box
      style={{
        position: 'absolute',
        top: Math.floor(height / 2) - Math.floor(modalHeight / 2),
        left: Math.floor(width / 2) - Math.floor(modalWidth / 2),
        width: modalWidth,
        height: modalHeight,
      }}
    >
      <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
        <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
          <text content=" Provider Status" fg="#7aa2f7" />
        </box>
        <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
          <text content={'─'.repeat(modalWidth)} fg="#292e42" />
        </box>
        <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
          <text content={formatLimit(githubRateLimit.current, 'GitHub')} fg="#a9b1d6" />
        </box>
        <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
          <text content={formatLimit(linearRateLimit.current, 'Linear')} fg="#a9b1d6" />
        </box>
        <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
          <text content={'─'.repeat(modalWidth)} fg="#292e42" />
        </box>
        <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
          <text content=" [Esc] or [p] close" fg="#565f89" />
        </box>
      </box>
    </box>
  );
}

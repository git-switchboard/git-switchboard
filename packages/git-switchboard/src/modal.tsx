import type { ReactNode } from 'react';

const MODAL_BG = '#1a1b26';
const MODAL_BORDER = '#292e42';

interface ModalProps {
  title: string;
  hint?: string;
  width: number;
  height: number;
  /** Terminal width for centering */
  termWidth: number;
  /** Terminal height for centering */
  termHeight: number;
  children: ReactNode;
}

/**
 * Centered modal with title, divider, padding, and optional footer hint.
 *
 * Handles:
 * - Absolute centering on screen
 * - Dark background that covers content behind it
 * - Title bar with accent color
 * - Divider after title
 * - 1-row spacer after divider (breathing room)
 * - 1-col left/right padding on the outer box
 * - Footer hint line (if provided)
 *
 * The `height` prop should be the number of content rows (children)
 * — the modal adds chrome rows automatically.
 */
export function Modal({
  title,
  hint,
  width: modalWidth,
  height: contentRows,
  termWidth,
  termHeight,
  children,
}: ModalProps) {
  // Chrome: title(1) + divider(1) + spacer(1) + hint(0|1) + top/bottom padding(2)
  const chromeRows = hint ? 6 : 5;
  const totalHeight = contentRows + chromeRows;
  const totalWidth = modalWidth + 2; // +2 for left/right padding

  return (
    <box
      style={{
        position: 'absolute',
        top: Math.max(0, Math.floor(termHeight / 2) - Math.floor(totalHeight / 2)),
        left: Math.max(0, Math.floor(termWidth / 2) - Math.floor(totalWidth / 2)),
        width: totalWidth,
        height: totalHeight,
        backgroundColor: MODAL_BG,
      }}
    >
      <box
        flexDirection="column"
        style={{ width: '100%', height: '100%', padding: 1 }}
      >
        {/* Title */}
        <box style={{ height: 1, width: '100%' }}>
          <text content={` ${title}`} fg="#7aa2f7" />
        </box>
        {/* Divider */}
        <box style={{ height: 1, width: '100%' }}>
          <text content={'─'.repeat(modalWidth)} fg={MODAL_BORDER} />
        </box>
        {/* Spacer */}
        <box style={{ height: 1, width: '100%' }} />

        {/* Content */}
        {children}

        {/* Footer hint */}
        {hint && (
          <>
            <box style={{ height: 1, width: '100%' }} />
            <box style={{ height: 1, width: '100%' }}>
              <text content={` ${hint}`} fg="#565f89" />
            </box>
          </>
        )}
      </box>
    </box>
  );
}

// ─── Reusable row components ────────────────────────────────────────────────

interface ModalRowProps {
  label: string;
  fg: string;
  active?: boolean;
  onMouseDown?: () => void;
}

export function ModalRow({ label, fg, active, onMouseDown }: ModalRowProps) {
  return (
    <box
      style={{
        height: 1,
        width: '100%',
        backgroundColor: active ? '#292e42' : undefined,
      }}
      onMouseDown={onMouseDown}
    >
      <text content={label} fg={fg} />
    </box>
  );
}

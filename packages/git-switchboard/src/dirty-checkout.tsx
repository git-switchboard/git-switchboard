import { useState } from 'react';
import { useKeybinds } from './use-keybinds.js';
import { useHistory } from './tui-router.js';
import { useExitOnCtrlC } from './use-exit-on-ctrl-c.js';
import { footerParts } from './view.js';
import type { ViewProps } from './view.js';

const MAX_FILES_SHOWN = 12;

export interface DirtyCheckoutProps extends ViewProps {
  /** Orange header line, e.g. "Working tree has uncommitted changes (3 files)" */
  heading: string;
  /** Grey context line, e.g. "Checking out: main" or "Moving: /path/to/worktree" */
  context: string;
  dirtyFiles: string[];
  onCheckoutAnyway: () => void;
  onStashAndCheckout: () => void;
}

const OPTIONS = [
  { label: 'Stash changes and proceed', key: 'stash' as const },
  { label: 'Proceed anyway', key: 'anyway' as const },
];

export function DirtyCheckout({
  heading,
  context,
  dirtyFiles,
  onCheckoutAnyway,
  onStashAndCheckout,
  keybinds,
}: DirtyCheckoutProps) {
  useExitOnCtrlC();
  const { goBack } = useHistory();
  const [selectedIndex, setSelectedIndex] = useState(0);

  useKeybinds(keybinds, {
    navigate: (key) => {
      if (key.name === 'up' || key.name === 'k')
        setSelectedIndex((i) => Math.max(0, i - 1));
      else setSelectedIndex((i) => Math.min(OPTIONS.length - 1, i + 1));
    },
    select: () => {
      if (OPTIONS[selectedIndex].key === 'stash') onStashAndCheckout();
      else onCheckoutAnyway();
    },
    back: () => goBack(),
  });

  const visibleFiles = dirtyFiles.slice(0, MAX_FILES_SHOWN);
  const hiddenCount = dirtyFiles.length - visibleFiles.length;

  return (
    <box flexDirection="column" style={{ width: '100%', height: '100%', padding: 1 }}>
      <box style={{ height: 1, width: '100%' }}>
        <text content={` ${heading}`} fg="#e0af68" />
      </box>
      <box style={{ height: 1, width: '100%' }}>
        <text content={`  ${context}`} fg="#565f89" />
      </box>

      <box style={{ height: 1 }} />

      <box flexDirection="column" style={{ flexGrow: 0 }}>
        {visibleFiles.map((f) => (
          <box key={f} style={{ height: 1, width: '100%' }}>
            <text content={`    ${f}`} fg="#565f89" />
          </box>
        ))}
        {hiddenCount > 0 && (
          <box style={{ height: 1, width: '100%' }}>
            <text content={`    … and ${hiddenCount} more`} fg="#565f89" />
          </box>
        )}
      </box>

      <box style={{ height: 1 }} />

      <box flexDirection="column" style={{ flexGrow: 1, width: '100%' }}>
        {OPTIONS.map((opt, i) => {
          const isSelected = i === selectedIndex;
          return (
            <box
              key={opt.key}
              style={{ height: 1, width: '100%', backgroundColor: isSelected ? '#292e42' : undefined }}
            >
              <text
                content={`  ${isSelected ? '› ' : '  '}${opt.label}`}
                fg={isSelected ? '#7aa2f7' : '#c0caf5'}
              />
            </box>
          );
        })}
      </box>

      <box style={{ height: 1, width: '100%' }}>
        <text content={` ${footerParts(keybinds).join(' | ')}`} fg="#565f89" />
      </box>
    </box>
  );
}

import { useCallback } from 'react';
import { Scrollbar } from './scrollbar.js';

interface ScrollListProps {
  /** Total number of items in the list */
  totalItems: number;
  /** Currently selected index */
  selectedIndex: number;
  /** First visible item index */
  scrollOffset: number;
  /** Number of visible rows */
  listHeight: number;
  /** Called when selection or scroll changes */
  onMove: (newIndex: number) => void;
  /** Content to render (the row elements) */
  children: React.ReactNode;
}

/**
 * A scrollable list container with a scrollbar on the right.
 * Handles mouse scroll events and renders the scrollbar indicator.
 */
export function ScrollList({
  totalItems,
  selectedIndex,
  scrollOffset,
  listHeight,
  onMove,
  children,
}: ScrollListProps) {
  const handleScroll = useCallback(
    (e: { scroll?: { direction: string } }) => {
      if (e.scroll?.direction === 'up') onMove(selectedIndex - 3);
      else if (e.scroll?.direction === 'down') onMove(selectedIndex + 3);
    },
    [selectedIndex, onMove]
  );

  return (
    <box flexDirection="row" style={{ flexGrow: 1, width: '100%' }}>
      <box
        flexDirection="column"
        style={{ flexGrow: 1 }}
        onMouseScroll={handleScroll}
      >
        {children}
      </box>
      <Scrollbar
        height={listHeight}
        totalItems={totalItems}
        visibleStart={scrollOffset}
        visibleEnd={scrollOffset + listHeight}
      />
    </box>
  );
}

/**
 * Handle Home/End/PageUp/PageDown keys for a scroll list.
 * Returns true if the key was handled.
 */
export function handleListKey(
  keyName: string,
  selectedIndex: number,
  totalItems: number,
  listHeight: number,
  moveTo: (index: number) => void
): boolean {
  switch (keyName) {
    case 'home':
      moveTo(0);
      return true;
    case 'end':
      moveTo(totalItems - 1);
      return true;
    case 'pageup':
      moveTo(selectedIndex - listHeight);
      return true;
    case 'pagedown':
      moveTo(selectedIndex + listHeight);
      return true;
    default:
      return false;
  }
}

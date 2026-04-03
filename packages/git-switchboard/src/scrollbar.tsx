/**
 * A minimal vertical scrollbar indicator.
 *
 * Renders a 1-char-wide column of track (`│`) and thumb (`█`) characters
 * based on the visible window within the total item count.
 */
export function Scrollbar({
  height,
  totalItems,
  visibleStart,
  visibleEnd,
}: {
  /** Height of the scrollbar in rows */
  height: number;
  /** Total number of items in the list */
  totalItems: number;
  /** Index of the first visible item */
  visibleStart: number;
  /** Index past the last visible item (exclusive) */
  visibleEnd: number;
}) {
  if (totalItems <= 0 || height <= 0 || visibleEnd - visibleStart >= totalItems) {
    return null;
  }

  const thumbStart = Math.floor((visibleStart / totalItems) * height);
  const thumbEnd = Math.max(
    thumbStart + 1,
    Math.ceil((visibleEnd / totalItems) * height)
  );

  const chars: string[] = [];
  for (let i = 0; i < height; i++) {
    chars.push(i >= thumbStart && i < thumbEnd ? '█' : '│');
  }

  return (
    <box style={{ width: 2, height }}>
      <text content={chars.map((c) => ` ${c}`).join('\n')} fg="#334155" />
    </box>
  );
}

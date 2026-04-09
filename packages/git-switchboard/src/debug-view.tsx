import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useCallback, useMemo, useState } from 'react';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleListKey, ScrollList } from './scroll-list.js';
import type { HistoryEntry } from './data/index.js';

const ELLIPSIS = '\u2026';
const TREE_PIPE = '\u2502'; // │
const TREE_BRANCH = '\u251c'; // ├
const TREE_LAST = '\u2514'; // └
const TREE_DASH = '\u2500'; // ─

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function fit(str: string, width: number): string {
  if (str.length <= width) return str.padEnd(width);
  return str.slice(0, width - 1) + ELLIPSIS;
}

function eventColor(event: string): string {
  if (event === 'error') return '#f7768e';
  if (event.startsWith('pr:discover') || event.startsWith('branch:')) return '#73daca';
  if (event.startsWith('pr:enriched')) return '#7aa2f7';
  if (event.startsWith('linear:issue:discover') || event.startsWith('linear:attachment')) return '#e0af68';
  if (event.startsWith('checkout:discover')) return '#7dcfff';
  if (event.includes(':fetch') || event.includes(':scan')) return '#bb9af7';
  if (event === 'relation:created') return '#565f89';
  return '#a9b1d6';
}

function formatPayload(payload: unknown, indent = 2): string {
  try {
    return JSON.stringify(payload, null, indent);
  } catch {
    return String(payload);
  }
}

function wrapLines(text: string, maxWidth: number): string[] {
  const rawLines = text.split('\n');
  const wrapped: string[] = [];
  for (const line of rawLines) {
    if (line.length <= maxWidth) {
      wrapped.push(line);
    } else {
      const lineIndent = line.match(/^\s*/)?.[0] ?? '';
      const continuation = lineIndent + '  ';
      let remaining = line;
      let first = true;
      while (remaining.length > 0) {
        const w = first ? maxWidth : maxWidth - continuation.length;
        const chunk = remaining.slice(0, w);
        remaining = remaining.slice(w);
        wrapped.push(first ? chunk : continuation + chunk);
        first = false;
      }
    }
  }
  return wrapped;
}

/** Build tree prefix for an event based on its position among siblings */
function treePrefix(entry: HistoryEntry, history: HistoryEntry[]): string {
  if (entry.depth === 0) return '';

  // For each depth level, determine if the ancestor still has more siblings after this point
  let currentId: number | null = entry.causeId;
  const depthChars: string[] = [];

  for (let d = entry.depth - 1; d >= 0; d--) {
    if (d === entry.depth - 1) {
      // Direct parent level — are we the last child?
      const isLastChild = !history.some(
        (e) => e.causeId === entry.causeId && e.id > entry.id && e.depth === entry.depth
      );
      depthChars.unshift(isLastChild ? `${TREE_LAST}${TREE_DASH}` : `${TREE_BRANCH}${TREE_DASH}`);
    } else {
      // Ancestor level — does the ancestor have more siblings after our branch?
      const hasMoreSiblings = history.some(
        (e) => e.causeId === currentId && e.id > entry.id
      );
      depthChars.unshift(hasMoreSiblings ? `${TREE_PIPE} ` : '  ');
    }
    // Walk up the cause chain
    if (currentId != null) {
      const causeEntry = history.find((e) => e.id === currentId);
      currentId = causeEntry?.causeId ?? null;
    }
  }

  return depthChars.join('');
}

/** Get the causal chain from root to this entry */
function getCausalChain(entry: HistoryEntry, history: HistoryEntry[]): HistoryEntry[] {
  const chain: HistoryEntry[] = [entry];
  let current = entry;
  while (current.causeId != null) {
    const cause = history.find((e) => e.id === current.causeId);
    if (!cause) break;
    chain.unshift(cause);
    current = cause;
  }
  return chain;
}

/** Get direct children of an event */
function getChildren(entry: HistoryEntry, history: HistoryEntry[]): HistoryEntry[] {
  return history.filter((e) => e.causeId === entry.id);
}

interface DebugViewProps {
  history: HistoryEntry[];
  onExit: () => void;
  copyToClipboard?: (text: string) => Promise<boolean>;
}

export function DebugView({ history, onExit, copyToClipboard }: DebugViewProps) {
  const { width, height } = useTerminalDimensions();
  const listHeight = Math.max(1, height - 5);
  const initialIndex = Math.max(0, history.length - 1);
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [scrollOffset, setScrollOffset] = useState(
    Math.max(0, history.length - listHeight)
  );
  const [detailEntry, setDetailEntry] = useState<HistoryEntry | null>(null);
  const [detailScrollOffset, setDetailScrollOffset] = useState(0);
  const [footerMessage, setFooterMessage] = useState('');

  // Precompute tree prefixes
  const treePrefixes = useMemo(
    () => history.map((entry) => treePrefix(entry, history)),
    [history]
  );

  const moveTo = useCallback(
    (newIndex: number) => {
      const clamped = Math.max(0, Math.min(newIndex, history.length - 1));
      setSelectedIndex(clamped);
      setScrollOffset((prev) => {
        if (clamped < prev) return clamped;
        if (clamped >= prev + listHeight) return clamped - listHeight + 1;
        return prev;
      });
    },
    [history.length, listHeight]
  );

  const exportLog = useCallback(async () => {
    const logPath = join(tmpdir(), `git-switchboard-events-${Date.now()}.json`);
    const data = history.map((e) => ({
      id: e.id,
      timestamp: new Date(e.timestamp).toISOString(),
      event: e.event,
      causeId: e.causeId,
      depth: e.depth,
      payload: e.payload,
    }));
    await writeFile(logPath, JSON.stringify(data, null, 2));
    if (copyToClipboard) await copyToClipboard(logPath);
    setFooterMessage(`Exported to ${logPath} (copied to clipboard)`);
    setTimeout(() => setFooterMessage(''), 5000);
  }, [history, copyToClipboard]);

  useKeyboard((key) => {
    key.stopPropagation();

    // Detail view mode
    if (detailEntry) {
      if (key.name === 'escape' || key.name === 'backspace' || key.name === 'left' || key.raw === 'q') {
        setDetailEntry(null);
        setDetailScrollOffset(0);
        return;
      }
      // Build detail content lines for scrolling calculation
      const detailLines = buildDetailLines(detailEntry, history, width - 4);
      const maxScroll = Math.max(0, detailLines.length - (height - 5));
      if (key.name === 'up' || key.raw === 'k') {
        setDetailScrollOffset((s) => Math.max(0, s - 1));
      } else if (key.name === 'down' || key.raw === 'j') {
        setDetailScrollOffset((s) => Math.min(maxScroll, s + 1));
      } else if (key.name === 'pageup') {
        setDetailScrollOffset((s) => Math.max(0, s - (height - 5)));
      } else if (key.name === 'pagedown') {
        setDetailScrollOffset((s) => Math.min(maxScroll, s + (height - 5)));
      }
      return;
    }

    // List view mode
    if (key.raw === '~' || key.name === 'escape' || key.raw === 'q') {
      onExit();
      return;
    }
    if (key.name === 'return') {
      const entry = history[selectedIndex];
      if (entry) {
        setDetailEntry(entry);
        setDetailScrollOffset(0);
      }
      return;
    }
    if (key.raw === 'e') {
      void exportLog();
      return;
    }
    if (key.name === 'up' || key.raw === 'k') moveTo(selectedIndex - 1);
    else if (key.name === 'down' || key.raw === 'j') moveTo(selectedIndex + 1);
    else handleListKey(key.name, selectedIndex, history.length, listHeight, moveTo);
  });

  // ─── Detail view ────────────────────────────────────────────────
  if (detailEntry) {
    const contentWidth = width - 4;
    const detailLines = buildDetailLines(detailEntry, history, contentWidth);
    const viewHeight = Math.max(1, height - 5);
    const visibleLines = detailLines.slice(detailScrollOffset, detailScrollOffset + viewHeight);

    return (
      <box flexDirection="column" style={{ width: '100%', height: '100%', padding: 1 }}>
        <box style={{ height: 1, width: '100%' }}>
          <text
            content={` #${detailEntry.id}  ${formatTime(detailEntry.timestamp)}  ${detailEntry.event}`}
            fg={eventColor(detailEntry.event)}
          />
        </box>
        <box style={{ height: 1, width: '100%' }}>
          <text content={'─'.repeat(width - 2)} fg="#292e42" />
        </box>
        {visibleLines.map((line, i) => (
          <box key={i} style={{ height: 1, width: '100%' }}>
            <text content={`  ${line.text}`} fg={line.color} />
          </box>
        ))}
        {visibleLines.length < viewHeight && (
          <box style={{ flexGrow: 1 }} />
        )}
        <box style={{ height: 1, width: '100%' }}>
          <text content=" [Esc] back  [j/k] scroll" fg="#565f89" />
        </box>
      </box>
    );
  }

  // ─── List view ──────────────────────────────────────────────────
  const timeCol = 14;
  const treeCol = 12; // max tree indent
  const eventCol = 28;
  const summaryCol = Math.max(10, width - timeCol - treeCol - eventCol - 4);

  const visible = history.slice(scrollOffset, scrollOffset + listHeight);

  return (
    <box flexDirection="column" style={{ width: '100%', height: '100%', padding: 1 }}>
      <box style={{ height: 1, width: '100%' }}>
        <text
          content={` Event Bus History  (${history.length} events)`}
          fg="#7aa2f7"
        />
      </box>

      <box style={{ height: 1, width: '100%' }}>
        <text
          content={`  ${fit('Time', timeCol)}${''.padEnd(treeCol)}${fit('Event', eventCol)}Payload`}
          fg="#bb9af7"
        />
      </box>

      <ScrollList
        totalItems={history.length}
        selectedIndex={selectedIndex}
        scrollOffset={scrollOffset}
        listHeight={listHeight}
        onMove={moveTo}
      >
        {visible.map((entry, i) => {
          const actualIndex = scrollOffset + i;
          const isSelected = actualIndex === selectedIndex;
          const bg = isSelected ? '#292e42' : undefined;
          const color = eventColor(entry.event);
          const prefix = treePrefixes[actualIndex] ?? '';
          const treePart = fit(prefix, treeCol);

          const line =
            '  ' +
            fit(formatTime(entry.timestamp), timeCol) +
            treePart +
            fit(entry.event, eventCol) +
            fit(entry.summary, summaryCol);

          return (
            <box
              key={`${actualIndex}`}
              style={{ height: 1, width: '100%', backgroundColor: bg }}
            >
              <text content={line} fg={color} />
            </box>
          );
        })}
      </ScrollList>

      <box style={{ height: 1, width: '100%' }}>
        <text
          content={footerMessage
            ? ` ${footerMessage}`
            : ' [~|Esc] close  [Enter] detail  [e]xport  [j/k] navigate  [PgUp/PgDn] page'
          }
          fg={footerMessage ? '#73daca' : '#565f89'}
        />
      </box>
    </box>
  );
}

// ─── Detail content builder ───────────────────────────────────────

interface DetailLine {
  text: string;
  color: string;
}

function buildDetailLines(
  entry: HistoryEntry,
  history: HistoryEntry[],
  maxWidth: number,
): DetailLine[] {
  const lines: DetailLine[] = [];

  // Causal chain
  const chain = getCausalChain(entry, history);
  if (chain.length > 1) {
    lines.push({ text: 'Caused by:', color: '#7aa2f7' });
    for (let i = 0; i < chain.length; i++) {
      const e = chain[i];
      const indent = '  '.repeat(i);
      const arrow = i > 0 ? `${TREE_LAST}${TREE_DASH} ` : '';
      const label = `${indent}${arrow}#${e.id} ${e.event}  ${e.summary}`;
      lines.push({
        text: label.length > maxWidth ? label.slice(0, maxWidth - 1) + ELLIPSIS : label,
        color: e.id === entry.id ? eventColor(e.event) : '#565f89',
      });
    }
    lines.push({ text: '', color: '#565f89' });
  }

  // Direct children
  const children = getChildren(entry, history);
  if (children.length > 0) {
    lines.push({ text: `Triggered (${children.length}):`, color: '#7aa2f7' });
    for (const child of children) {
      const label = `  #${child.id} ${child.event}  ${child.summary}`;
      lines.push({
        text: label.length > maxWidth ? label.slice(0, maxWidth - 1) + ELLIPSIS : label,
        color: eventColor(child.event),
      });
    }
    lines.push({ text: '', color: '#565f89' });
  }

  // Payload
  lines.push({ text: 'Payload:', color: '#7aa2f7' });
  for (const line of wrapLines(formatPayload(entry.payload), maxWidth)) {
    lines.push({ text: line, color: '#a9b1d6' });
  }

  return lines;
}

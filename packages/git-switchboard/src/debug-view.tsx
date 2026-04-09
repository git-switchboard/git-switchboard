import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useCallback, useState } from 'react';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleListKey, ScrollList } from './scroll-list.js';
import type { HistoryEntry } from './data/index.js';

const ELLIPSIS = '\u2026';

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

/** Wrap a string into lines that fit within maxWidth, preserving leading indent */
function wrapLines(text: string, maxWidth: number): string[] {
  const rawLines = text.split('\n');
  const wrapped: string[] = [];
  for (const line of rawLines) {
    if (line.length <= maxWidth) {
      wrapped.push(line);
    } else {
      // Preserve leading whitespace
      const indent = line.match(/^\s*/)?.[0] ?? '';
      const continuation = indent + '  ';
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

interface DebugViewProps {
  history: HistoryEntry[];
  onExit: () => void;
}

export function DebugView({ history, onExit }: DebugViewProps) {
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
      timestamp: new Date(e.timestamp).toISOString(),
      event: e.event,
      payload: e.payload,
    }));
    await writeFile(logPath, JSON.stringify(data, null, 2));
    setFooterMessage(`Exported to ${logPath}`);
    setTimeout(() => setFooterMessage(''), 5000);
  }, [history]);

  useKeyboard((key) => {
    key.stopPropagation();

    // Detail view mode
    if (detailEntry) {
      if (key.name === 'escape' || key.name === 'backspace' || key.name === 'left' || key.raw === 'q') {
        setDetailEntry(null);
        setDetailScrollOffset(0);
        return;
      }
      const lines = wrapLines(formatPayload(detailEntry.payload), width - 4);
      const maxScroll = Math.max(0, lines.length - (height - 7));
      if (key.name === 'up' || key.raw === 'k') {
        setDetailScrollOffset((s) => Math.max(0, s - 1));
      } else if (key.name === 'down' || key.raw === 'j') {
        setDetailScrollOffset((s) => Math.min(maxScroll, s + 1));
      } else if (key.name === 'pageup') {
        setDetailScrollOffset((s) => Math.max(0, s - (height - 7)));
      } else if (key.name === 'pagedown') {
        setDetailScrollOffset((s) => Math.min(maxScroll, s + (height - 7)));
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
    const lines = wrapLines(formatPayload(detailEntry.payload), width - 4);
    const viewHeight = Math.max(1, height - 7);
    const visibleLines = lines.slice(detailScrollOffset, detailScrollOffset + viewHeight);

    return (
      <box flexDirection="column" style={{ width: '100%', height: '100%', padding: 1 }}>
        <box style={{ height: 1, width: '100%' }}>
          <text
            content={` ${formatTime(detailEntry.timestamp)}  ${detailEntry.event}`}
            fg={eventColor(detailEntry.event)}
          />
        </box>
        <box style={{ height: 1, width: '100%' }}>
          <text content={'─'.repeat(width - 2)} fg="#292e42" />
        </box>
        {visibleLines.map((line, i) => (
          <box key={i} style={{ height: 1, width: '100%' }}>
            <text content={`  ${line}`} fg="#a9b1d6" />
          </box>
        ))}
        {/* Pad remaining space */}
        {visibleLines.length < viewHeight && (
          <box style={{ flexGrow: 1 }} />
        )}
        <box style={{ height: 1, width: '100%' }}>
          <text content={'─'.repeat(width - 2)} fg="#292e42" />
        </box>
        <box style={{ height: 1, width: '100%' }}>
          <text content=" [Esc] back  [j/k] scroll" fg="#565f89" />
        </box>
      </box>
    );
  }

  // ─── List view ──────────────────────────────────────────────────
  const timeCol = 14;
  const eventCol = 30;
  const summaryCol = Math.max(10, width - timeCol - eventCol - 4);

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
          content={`  ${fit('Time', timeCol)}${fit('Event', eventCol)}Payload`}
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

          const line =
            '  ' +
            fit(formatTime(entry.timestamp), timeCol) +
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

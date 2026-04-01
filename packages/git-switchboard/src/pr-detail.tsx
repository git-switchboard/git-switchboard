import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalRepo } from './scanner.js';
import type { CIInfo, CheckRun, ReviewInfo, ReviewerState, UserPullRequest } from './types.js';
import { CHECKMARK, LEFT_ARROW, RETURN_SYMBOL } from './unicode.js';

function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

function duration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  if (minutes < 60) return remSec > 0 ? `${minutes}m ${remSec}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
}

function fit(str: string, width: number): string {
  if (str.length <= width) return str.padEnd(width);
  return str.slice(0, width - 1) + '~';
}

/** Sort priority: failure=0, in_progress/queued=1, neutral/skipped=2, success=3 */
function checkSortOrder(check: CheckRun): number {
  if (check.status === 'completed' && check.conclusion === 'failure') return 0;
  if (check.status !== 'completed') return 1;
  if (check.conclusion === 'skipped' || check.conclusion === 'neutral') return 2;
  return 3;
}

const SPINNER_FRAMES = ['|', '/', '-', '\\'];

/** Returns icon char, row foreground color, and whether to use spinner */
function checkStyle(
  check: CheckRun
): { icon: string; fg: string; spinner: boolean } {
  if (check.status !== 'completed') {
    return { icon: '', fg: '#e0af68', spinner: true }; // yellow, animated
  }
  switch (check.conclusion) {
    case 'success':
      return { icon: CHECKMARK, fg: '#9ece6a', spinner: false }; // green checkmark ✓
    case 'failure':
      return { icon: 'x', fg: '#f7768e', spinner: false }; // red x
    case 'skipped':
    case 'neutral':
      return { icon: '-', fg: '#565f89', spinner: false }; // grey/muted
    default:
      return { icon: '?', fg: '#565f89', spinner: false };
  }
}

function checkTimeLabel(check: CheckRun): string {
  if (check.startedAt && check.completedAt) {
    const dur = duration(check.startedAt, check.completedAt);
    const ago = relativeTime(check.completedAt);
    return `Completed in ${dur}, ${ago}`;
  }
  if (check.startedAt) {
    return `Started ${relativeTime(check.startedAt)}`;
  }
  return '';
}

interface PrDetailProps {
  pr: UserPullRequest;
  ci: CIInfo | null;
  review: ReviewInfo | null;
  ciLoading: boolean;
  matches: LocalRepo[];
  watched: boolean;
  onOpenInEditor: () => void;
  onBack: () => void;
  onWatch: () => void;
  onRefreshCI: () => void;
  onOpenUrl: (url: string) => void;
  /** Fetch and copy logs for a check run. Returns status message. */
  onCopyLogs: (check: CheckRun) => Promise<string>;
  onExit: () => void;
}

export function PrDetail({
  pr,
  ci,
  review,
  ciLoading,
  matches,
  watched,
  onOpenInEditor,
  onBack,
  onWatch,
  onRefreshCI,
  onOpenUrl,
  onCopyLogs,
  onExit,
}: PrDetailProps) {
  const { width, height } = useTerminalDimensions();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [statusText, setStatusText] = useState('');
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  // Animate spinner for in-progress checks and loading state
  useEffect(() => {
    const hasSpinner =
      ciLoading || (ci?.checks ?? []).some((c) => c.status !== 'completed');
    if (!hasSpinner) return;
    const interval = setInterval(() => {
      setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 100);
    return () => clearInterval(interval);
  }, [ciLoading, ci]);

  const rawChecks = ci?.checks ?? [];
  // Sort: failure → in progress → neutral → success
  const checks = [...rawChecks].sort(
    (a, b) => checkSortOrder(a) - checkSortOrder(b)
  );

  const ACTION_COUNT = 2;
  const totalItems = ACTION_COUNT + checks.length;

  const reviewRowCount = review ? Math.max(1, review.reviewers.length) : 1;
  // Chrome: header(1) + meta(1) + spacer(1) + actions-header(1) + 2 actions(2) + spacer(1) +
  //         ci-header(1) + checks-header(1) + spacer(1) + reviews-header(1) + reviewRows + spacer(1) + footer(1) + padding(2) = 15 + reviewRows
  const checkListHeight = Math.max(1, height - 15 - reviewRowCount);

  const moveTo = useCallback(
    (newIndex: number) => {
      const clamped = Math.max(0, Math.min(newIndex, totalItems - 1));
      setSelectedIndex(clamped);
      if (clamped >= ACTION_COUNT) {
        const checkIdx = clamped - ACTION_COUNT;
        setScrollOffset((prev) => {
          if (checkIdx < prev) return checkIdx;
          if (checkIdx >= prev + checkListHeight)
            return checkIdx - checkListHeight + 1;
          return prev;
        });
      }
      if (statusText) {
        setStatusText('');
        if (statusTimerRef.current) {
          clearTimeout(statusTimerRef.current);
          statusTimerRef.current = null;
        }
      }
    },
    [totalItems, checkListHeight, statusText]
  );

  const showStatus = useCallback((text: string) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatusText(text);
    statusTimerRef.current = setTimeout(() => {
      setStatusText('');
      statusTimerRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  useKeyboard((key) => {
    if (statusText && key.name !== 'c') {
      setStatusText('');
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current);
        statusTimerRef.current = null;
      }
    }

    switch (key.name) {
      case 'up':
      case 'k':
        moveTo(selectedIndex - 1);
        break;
      case 'down':
      case 'j':
        moveTo(selectedIndex + 1);
        break;
      case 'return': {
        if (selectedIndex === 0) {
          onOpenInEditor();
        } else if (selectedIndex === 1) {
          onOpenUrl(pr.url);
        } else {
          const check = checks[selectedIndex - ACTION_COUNT];
          if (check?.detailsUrl) {
            onOpenUrl(check.detailsUrl);
          }
        }
        break;
      }
      case 'backspace':
      case 'escape':
        onBack();
        break;
      case 'q':
        onExit();
        break;
      default:
        if (key.raw === 'w') {
          onWatch();
        } else if (key.raw === 'r') {
          onRefreshCI();
        } else if (key.raw === 'c' && selectedIndex >= ACTION_COUNT) {
          const check = checks[selectedIndex - ACTION_COUNT];
          if (check) {
            showStatus('Fetching logs...');
            onCopyLogs(check).then((msg) => showStatus(msg));
          }
        }
        break;
    }
  });

  // Header
  const titleStr = `#${pr.number} ${pr.title}`;
  const header = fit(titleStr, width - 4);

  // Meta line
  const repoLabel = `${pr.repoOwner}/${pr.repoName}`;
  const metaParts = [
    repoLabel,
    `Branch: ${pr.headRef}`,
    pr.draft ? 'Draft' : 'Open',
    `Updated: ${relativeTime(pr.updatedAt)}`,
  ];
  if (watched) metaParts.push('W');
  const metaLine = metaParts.join('  |  ');

  // CI section header
  let ciHeader: string;
  if (ciLoading) {
    ciHeader = `CI Checks ${SPINNER_FRAMES[spinnerFrame]} refreshing...`;
  } else if (ci === null) {
    ciHeader = 'CI Checks (loading...)';
  } else if (checks.length === 0) {
    ciHeader = 'No checks found';
  } else {
    const fetchedAgo = relativeTime(new Date(ci.fetchedAt).toISOString());
    ciHeader = `CI Checks (${checks.length}) - fetched ${fetchedAgo}`;
  }

  // Column layout for checks
  const iconCol = 3;
  const openCol = 8;
  const conclusionCol = 12;
  const timeCol = 30;
  const nameCol = Math.max(
    10,
    width - iconCol - conclusionCol - timeCol - openCol - 6
  );

  // Footer text
  const footerText = statusText
    ? ` ${statusText}`
    : ` [${RETURN_SYMBOL}] Select | [c]opy logs | [r]efresh CI | [w]atch | [${LEFT_ARROW}] Back | [q]uit`;
  const footerFg = statusText ? '#9ece6a' : '#565f89';

  return (
    <box
      flexDirection="column"
      style={{ width: '100%', height: '100%', padding: 1 }}
    >
      {/* Header */}
      <box style={{ height: 1, width: '100%' }}>
        <text content={` ${header}`} fg="#7aa2f7" />
      </box>

      {/* Meta line */}
      <box style={{ height: 1, width: '100%' }}>
        <text content={` ${fit(metaLine, width - 4)}`} fg="#a9b1d6" />
      </box>

      {/* Spacer */}
      <box style={{ height: 1 }} />

      {/* Actions header */}
      <box style={{ height: 1, width: '100%' }}>
        <text content=" Actions" fg="#bb9af7" />
      </box>

      {/* Action rows (fixed) */}
      <box
        style={{
          height: 1,
          width: '100%',
          backgroundColor: selectedIndex === 0 ? '#292e42' : undefined,
        }}
      >
        <text
          content="   > Open in editor"
          fg={selectedIndex === 0 ? '#7aa2f7' : '#c0caf5'}
        />
      </box>
      <box
        style={{
          height: 1,
          width: '100%',
          backgroundColor: selectedIndex === 1 ? '#292e42' : undefined,
        }}
      >
        <text
          content="   > Open PR in browser"
          fg={selectedIndex === 1 ? '#7aa2f7' : '#c0caf5'}
        />
      </box>

      {/* Spacer */}
      <box style={{ height: 1 }} />

      {/* CI Section Header */}
      <box style={{ height: 1, width: '100%' }}>
        <text content={` ${ciHeader}`} fg="#bb9af7" />
      </box>

      {/* Check table header */}
      <box style={{ height: 1, width: '100%' }}>
        <text
          content={`   ${''.padEnd(iconCol)}${fit('Check', nameCol)} ${fit('Result', conclusionCol)}${fit('Time', timeCol)}${''.padEnd(openCol)}`}
          fg="#565f89"
        />
      </box>

      {/* Check rows (scrollable) */}
      <box flexDirection="column" style={{ flexGrow: 1, width: '100%' }}>
        {checks
          .slice(scrollOffset, scrollOffset + checkListHeight)
          .map((check, i) => {
            const actualCheckIndex = scrollOffset + i;
            const actualIndex = actualCheckIndex + ACTION_COUNT;
            const isSelected = actualIndex === selectedIndex;
            const bg = isSelected ? '#292e42' : undefined;
            const style = checkStyle(check);
            const icon = style.spinner
              ? SPINNER_FRAMES[spinnerFrame]
              : style.icon;
            const rowFg = isSelected ? '#c0caf5' : style.fg;

            const conclusionLabel =
              check.status === 'completed'
                ? (check.conclusion ?? 'unknown')
                : check.status;
            const openLabel = check.detailsUrl ? '[open]' : '';
            const timeLabel = checkTimeLabel(check);

            const line =
              `  ${icon} ` +
              fit(check.name, nameCol) +
              ' ' +
              fit(conclusionLabel, conclusionCol) +
              fit(timeLabel, timeCol) +
              openLabel.padEnd(openCol);

            return (
              <box
                key={`${check.name}-${actualCheckIndex}`}
                style={{ height: 1, width: '100%', backgroundColor: bg }}
              >
                <text content={line} fg={rowFg} />
              </box>
            );
          })}
      </box>

      {/* Spacer */}
      <box style={{ height: 1 }} />

      {/* Reviews section */}
      <box style={{ height: 1, width: '100%' }}>
        <text content={` Reviews${review ? ` (${review.reviewers.length})` : ''}`} fg="#bb9af7" />
      </box>
      {review && review.reviewers.length > 0 ? (
        review.reviewers.map((r) => {
          const icon =
            r.state === 'APPROVED'
              ? { char: CHECKMARK, fg: '#9ece6a' }
              : r.state === 'CHANGES_REQUESTED'
                ? { char: 'x', fg: '#f7768e' }
                : r.state === 'DISMISSED'
                  ? { char: '-', fg: '#565f89' }
                  : { char: '~', fg: '#e0af68' };
          const stateLabel = r.state.toLowerCase().replace(/_/g, ' ');
          return (
            <box key={r.login} style={{ height: 1, width: '100%' }}>
              <text
                content={`  ${icon.char} ${r.login} — ${stateLabel} (${relativeTime(r.submittedAt)})`}
                fg={icon.fg}
              />
            </box>
          );
        })
      ) : (
        <box style={{ height: 1, width: '100%' }}>
          <text content="  No reviews yet" fg="#565f89" />
        </box>
      )}

      {/* Spacer */}
      <box style={{ height: 1 }} />

      {/* Footer / Status */}
      <box style={{ height: 1, width: '100%' }}>
        <text content={footerText} fg={footerFg} />
      </box>
    </box>
  );
}

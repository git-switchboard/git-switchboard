import { useTerminalDimensions } from '@opentui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusedKeyboard, useFocusOwner } from './focus-stack.js';
import { useKeybinds } from './use-keybinds.js';
import { buildFooterRows, FooterRows } from './footer.js';
import { footerParts } from './view.js';
import type { ViewProps } from './view.js';
import { ScrollList, handleListKey } from './scroll-list.js';
import type { LocalRepo } from './scanner.js';
import type { CIInfo, CheckRun, LinearIssue, ReviewInfo, UserPullRequest } from './types.js';
import { CHECKMARK, CROSSMARK, EN_DASH } from './unicode.js';
import { useExitOnCtrlC } from './use-exit-on-ctrl-c.js';
import { useHistory, useNavigate } from './tui-router.js';
import type { PrScreen } from './store.js';

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
      return { icon: CROSSMARK, fg: '#f7768e', spinner: false }; // red x
    case 'skipped':
    case 'neutral':
      return { icon: EN_DASH, fg: '#565f89', spinner: false }; // grey/muted
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

interface CheckAction {
  label: string;
  id: 'open' | 'rerun' | 'copy-logs' | 'open-logs';
}

function getCheckActions(check: CheckRun): CheckAction[] {
  const actions: CheckAction[] = [];
  if (check.detailsUrl) {
    actions.push({ label: 'Open in browser', id: 'open' });
  }
  const canRetry =
    check.id > 0 &&
    check.status === 'completed' &&
    (check.conclusion === 'failure' || check.conclusion === 'cancelled');
  if (canRetry) {
    actions.push({ label: 'Rerun this check', id: 'rerun' });
  }
  // Logs are available for any GitHub Actions job with an ID
  if (check.id > 0) {
    actions.push({ label: 'Copy logs to clipboard', id: 'copy-logs' });
  }
  if (check.detailsUrl) {
    const logsUrl = check.detailsUrl.replace(/\/?$/, '/logs');
    actions.push({ label: `Open raw logs (${logsUrl})`, id: 'open-logs' });
  }
  return actions;
}

interface PrDetailProps extends ViewProps {
  pr: UserPullRequest;
  ci: CIInfo | null;
  review: ReviewInfo | null;
  linearIssues: LinearIssue[];
  ciLoading: boolean;
  matches: LocalRepo[];
  watched: boolean;
  /**
   * Handles editor-opening logic. Returns `null` when fully handled (editor
   * opened or picker shown), or a `LocalRepo[]` when the clone-prompt screen
   * is needed — the component will navigate there itself.
   */
  onPrepareEditorOpen: (pr: UserPullRequest, matches: LocalRepo[]) => Promise<LocalRepo[] | null>;
  onWatch: () => void;
  onRefreshCI: () => void;
  onRetryChecks: () => Promise<string>;
  onRetryCheck: (check: CheckRun) => Promise<string>;
  onOpenUrl: (url: string) => void;
  /** Fetch and copy logs for a check run. Returns status message. */
  onCopyLogs: (check: CheckRun) => Promise<string>;
  onExit: () => void;
}

export function PrDetail({
  pr,
  ci,
  review,
  linearIssues,
  ciLoading,
  matches,
  watched,
  onPrepareEditorOpen,
  onWatch,
  onRefreshCI,
  onRetryChecks,
  onRetryCheck,
  onOpenUrl,
  onCopyLogs,
  onExit,
  keybinds,
}: PrDetailProps) {
  useExitOnCtrlC();
  const navigate = useNavigate<PrScreen>();
  const { goBack } = useHistory();

  const handleOpenInEditor = useCallback(async () => {
    const cloneMatches = await onPrepareEditorOpen(pr, matches);
    if (cloneMatches) navigate({ type: 'clone-prompt', pr, matches: cloneMatches });
  }, [onPrepareEditorOpen, pr, matches, navigate]);
  const { width, height } = useTerminalDimensions();
  const prIdentity = `${pr.repoId}#${pr.number}`;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [statusText, setStatusText] = useState('');
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [modal, setModal] = useState<{ check: CheckRun; selectedOption: number } | null>(null);
  useFocusOwner('check-action', !!modal);
  const initialLoadRequestedRef = useRef<string | null>(null);

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

  const hasReviewers = review && review.reviewers.length > 0;
  // With reviewers: header(1) + reviewer rows. Without: just "No reviews yet"(1)
  const reviewRowCount = hasReviewers ? 1 + review.reviewers.length : 1;

  // Compute wrapped footer rows
  const footerKeyParts = footerParts(keybinds);
  const footerRows = buildFooterRows(footerKeyParts, width);
  const footerHeight = statusText ? 1 : footerRows.length;

  // Chrome: header(1) + meta(1) + spacer(1) + actions-header(1) + 2 actions(2) + spacer(1) +
  //         ci-header(1) + checks-header(1) + spacer(1) + reviewRows + spacer(1) + footer + padding(2) = 13 + reviewRows + footerHeight
  // Each linear issue: header(1) + title(1) + status(1). Plus spacer(1) if any exist.
  const linearRowCount = linearIssues.length > 0 ? 1 + linearIssues.length * 3 : 0;
  const checkListHeight = Math.max(1, height - 13 - reviewRowCount - linearRowCount - footerHeight);

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

  useEffect(() => {
    initialLoadRequestedRef.current = null;
  }, [prIdentity]);

  useEffect(() => {
    if (ciLoading || (ci != null && review != null)) return;
    if (initialLoadRequestedRef.current === prIdentity) return;
    initialLoadRequestedRef.current = prIdentity;
    void onRefreshCI();
  }, [prIdentity, ci, review, ciLoading, onRefreshCI]);

  const executeModalAction = useCallback(
    (check: CheckRun, action: CheckAction) => {
      setModal(null);
      switch (action.id) {
        case 'open':
          if (check.detailsUrl) onOpenUrl(check.detailsUrl);
          break;
        case 'rerun':
          showStatus(`Retrying ${check.name}...`);
          onRetryCheck(check).then((msg) => showStatus(msg));
          break;
        case 'copy-logs':
          showStatus('Fetching logs...');
          onCopyLogs(check).then((msg) => showStatus(msg));
          break;
        case 'open-logs':
          if (check.detailsUrl) {
            onOpenUrl(check.detailsUrl.replace(/\/?$/, '/logs'));
          }
          break;
      }
    },
    [onOpenUrl, onRetryCheck, onCopyLogs, showStatus]
  );

  useKeybinds(keybinds, {
    navigate: (key) => {
      if (key.name === 'up' || key.name === 'k') moveTo(selectedIndex - 1);
      else moveTo(selectedIndex + 1);
    },
    select: () => {
      if (selectedIndex === 0) {
        void handleOpenInEditor();
      } else if (selectedIndex === 1) {
        onOpenUrl(pr.url);
      } else {
        const check = checks[selectedIndex - ACTION_COUNT];
        if (check) {
          const actions = getCheckActions(check);
          if (actions.length > 0) setModal({ check, selectedOption: 0 });
        }
      }
    },
    copyLogs: () => {
      if (selectedIndex >= ACTION_COUNT) {
        const check = checks[selectedIndex - ACTION_COUNT];
        if (check) {
          showStatus('Fetching logs...');
          onCopyLogs(check).then((msg) => showStatus(msg));
        }
      }
    },
    refresh: () => onRefreshCI(),
    retry: () => {
      showStatus('Retrying failed checks...');
      onRetryChecks().then((msg) => showStatus(msg));
    },
    watch: () => onWatch(),
    debug: () => navigate({ type: 'debug' }),
    back: () => goBack(),
    quit: () => onExit(),
  });

  // Check action modal — only fires when check-action focus is active.
  useFocusedKeyboard((key) => {
    if (!modal) return;
    key.stopPropagation();
    const actions = getCheckActions(modal.check);
    switch (key.name) {
      case 'up':
      case 'k':
        setModal((m) => m ? { ...m, selectedOption: Math.max(0, m.selectedOption - 1) } : m);
        break;
      case 'down':
      case 'j':
        setModal((m) =>
          m ? { ...m, selectedOption: Math.min(actions.length - 1, m.selectedOption + 1) } : m
        );
        break;
      case 'return': {
        const action = actions[modal.selectedOption];
        if (action) executeModalAction(modal.check, action);
        break;
      }
      case 'escape':
      case 'q':
        setModal(null);
        break;
    }
    return true;
  }, { focusId: 'check-action' });

  // Status text dismiss and page/home/end — only fires when no focus is claimed.
  useFocusedKeyboard((key) => {
    if (statusText && key.name !== 'c') {
      setStatusText('');
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current);
        statusTimerRef.current = null;
      }
    }

    if (handleListKey(key.name, selectedIndex, totalItems, checkListHeight, moveTo)) return true;
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

  // Footer: status message or wrapped keybindings
  const statusIsError = statusText ? /^(Failed|No |Cannot )/i.test(statusText) : false;

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
        onMouseDown={() => {
          if (selectedIndex === 0) void handleOpenInEditor();
          else moveTo(0);
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
        onMouseDown={() => {
          if (selectedIndex === 1) onOpenUrl(pr.url);
          else moveTo(1);
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
          content={`    ${fit('Check', nameCol)} ${fit('Result', conclusionCol)}${fit('Time', timeCol)}${''.padEnd(openCol)}`}
          fg="#565f89"
        />
      </box>

      {/* Check rows (scrollable) */}
      <ScrollList
        totalItems={checks.length}
        selectedIndex={selectedIndex}
        scrollOffset={scrollOffset}
        listHeight={checkListHeight}
        onMove={moveTo}
      >
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
                onMouseDown={() => {
                  if (actualIndex === selectedIndex && check.detailsUrl) {
                    onOpenUrl(check.detailsUrl);
                  } else {
                    moveTo(actualIndex);
                  }
                }}
              >
                <text content={line} fg={rowFg} />
              </box>
            );
          })}
      </ScrollList>

      {/* Spacer */}
      <box style={{ height: 1 }} />

      {/* Reviews section */}
      {review === null ? (
        <box style={{ height: 1, width: '100%' }}>
          <text content="  Loading review status..." fg="#565f89" />
        </box>
      ) : review.reviewers.length > 0 ? (
        <>
          <box style={{ height: 1, width: '100%' }}>
            <text content={` Reviews (${review.reviewers.length})`} fg="#bb9af7" />
          </box>
          {review.reviewers.map((r) => {
            const icon =
              r.state === 'APPROVED'
                ? { char: CHECKMARK, fg: '#9ece6a' }
                : r.state === 'CHANGES_REQUESTED'
                  ? { char: CROSSMARK, fg: '#f7768e' }
                  : r.state === 'DISMISSED'
                    ? { char: EN_DASH, fg: '#565f89' }
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
          })}
        </>
      ) : (
        <box style={{ height: 1, width: '100%' }}>
          <text content="  No reviews yet" fg="#565f89" />
        </box>
      )}

      {/* Linear tickets */}
      {linearIssues.length > 0 && (
        <>
          <box style={{ height: 1 }} />
          {linearIssues.map((issue) => (
            <box key={issue.identifier} flexDirection="column">
              <box style={{ height: 1, width: '100%' }}>
                <text content={` Linear ${issue.identifier}: ${issue.title}`} fg="#bb9af7" />
              </box>
              <box style={{ height: 1, width: '100%' }}>
                <text
                  content={`    Status: ${issue.status}  |  Priority: ${issue.priority}${issue.assignee ? `  |  Assignee: ${issue.assignee}` : ''}`}
                  fg="#a9b1d6"
                />
              </box>
              <box
                style={{ height: 1, width: '100%' }}
                onMouseDown={() => onOpenUrl(issue.url)}
              >
                <text content={`    Open in Linear`} fg="#565f89" />
              </box>
            </box>
          ))}
        </>
      )}

      {/* Spacer */}
      <box style={{ height: 1 }} />

      {/* Footer / Status */}
      {statusText ? (
        <box style={{ height: 1, width: '100%' }}>
          <text
            content={` ${statusText}`}
            fg={statusIsError ? '#f7768e' : '#9ece6a'}
          />
        </box>
      ) : (
        <FooterRows rows={footerRows} fg="#565f89" />
      )}

      {/* Check action modal */}
      {modal && (
        <box
          style={{
            position: 'absolute',
            top: Math.floor(height / 2) - 2,
            left: Math.floor(width / 2) - 22,
            width: 44,
            height: getCheckActions(modal.check).length + 4,
          }}
        >
          <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
            {/* Title bar */}
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text
                content={` ${fit(modal.check.name, 42)}`}
                fg="#7aa2f7"
              />
            </box>
            {/* Border */}
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text content={`${'─'.repeat(44)}`} fg="#292e42" />
            </box>
            {/* Options */}
            {getCheckActions(modal.check).map((action, i) => {
              const isActive = i === modal.selectedOption;
              return (
                <box
                  key={action.id}
                  style={{
                    height: 1,
                    width: '100%',
                    backgroundColor: isActive ? '#292e42' : '#1a1b26',
                  }}
                  onMouseDown={() => {
                    if (isActive) {
                      executeModalAction(modal.check, action);
                    } else {
                      setModal({ ...modal, selectedOption: i });
                    }
                  }}
                >
                  <text
                    content={` ${isActive ? '>' : ' '} ${action.label}`}
                    fg={isActive ? '#c0caf5' : '#a9b1d6'}
                  />
                </box>
              );
            })}
            {/* Hint */}
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text content={` Esc to close`} fg="#565f89" />
            </box>
          </box>
        </box>
      )}
    </box>
  );
}

import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useCallback, useEffect, useRef } from "react";
import type { UserPullRequest, CIInfo, CheckRun } from "./types.js";
import type { LocalRepo } from "./scanner.js";

function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 30) return "just now";
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

function fit(str: string, width: number): string {
  if (str.length <= width) return str.padEnd(width);
  return str.slice(0, width - 1) + "~";
}

function checkIcon(check: CheckRun): { char: string; fg: string } {
  if (check.status !== "completed") {
    return { char: "~", fg: "#e0af68" };
  }
  switch (check.conclusion) {
    case "success":
    case "skipped":
    case "neutral":
      return { char: "*", fg: "#9ece6a" };
    case "failure":
      return { char: "x", fg: "#f7768e" };
    default:
      return { char: "~", fg: "#e0af68" };
  }
}

const SPINNER_FRAMES = ["|", "/", "-", "\\"];

interface PrDetailProps {
  pr: UserPullRequest;
  ci: CIInfo | null;
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
  matches,
  watched,
  onOpenInEditor,
  onBack,
  onWatch,
  onRefreshCI,
  ciLoading,
  onOpenUrl,
  onCopyLogs,
  onExit,
}: PrDetailProps) {
  const { width, height } = useTerminalDimensions();
  // Index 0 = "Open in editor" action, 1+ = checks
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [statusText, setStatusText] = useState("");
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  // Animate spinner when CI is loading
  useEffect(() => {
    if (!ciLoading) return;
    const interval = setInterval(() => {
      setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 100);
    return () => clearInterval(interval);
  }, [ciLoading]);

  const checks = ci?.checks ?? [];
  // Total selectable items: 1 action row + N checks
  const totalItems = 1 + checks.length;

  // Chrome rows: header, meta, spacer, actions header, action row, spacer, ci header, spacer, footer + 2 padding
  // But the action row and check rows share the scrollable area
  // Layout: header(1) + meta(1) + spacer(1) + actions-header(1) + [selectable list] + spacer(1) + footer/status(1) + padding(2) = 9
  const listHeight = Math.max(1, height - 9);

  const moveTo = useCallback(
    (newIndex: number) => {
      const clamped = Math.max(0, Math.min(newIndex, totalItems - 1));
      setSelectedIndex(clamped);
      setScrollOffset((prev) => {
        if (clamped < prev) return clamped;
        if (clamped >= prev + listHeight) return clamped - listHeight + 1;
        return prev;
      });
      // Dismiss status on navigation
      if (statusText) {
        setStatusText("");
        if (statusTimerRef.current) {
          clearTimeout(statusTimerRef.current);
          statusTimerRef.current = null;
        }
      }
    },
    [totalItems, listHeight, statusText]
  );

  const showStatus = useCallback((text: string) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatusText(text);
    statusTimerRef.current = setTimeout(() => {
      setStatusText("");
      statusTimerRef.current = null;
    }, 3000);
  }, []);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  useKeyboard((key) => {
    // Dismiss status on any keypress
    if (statusText && key.name !== "c") {
      setStatusText("");
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current);
        statusTimerRef.current = null;
      }
    }

    switch (key.name) {
      case "up":
      case "k":
        moveTo(selectedIndex - 1);
        break;
      case "down":
      case "j":
        moveTo(selectedIndex + 1);
        break;
      case "return": {
        if (selectedIndex === 0) {
          // Action row: open in editor
          onOpenInEditor();
        } else {
          // Check row: open details URL
          const check = checks[selectedIndex - 1];
          if (check?.detailsUrl) {
            onOpenUrl(check.detailsUrl);
          }
        }
        break;
      }
      case "backspace":
      case "escape":
        onBack();
        break;
      case "q":
        onExit();
        break;
      default:
        if (key.raw === "w") {
          onWatch();
        } else if (key.raw === "r") {
          onRefreshCI();
        } else if (key.raw === "c" && selectedIndex > 0) {
          const check = checks[selectedIndex - 1];
          if (check) {
            showStatus("Fetching logs...");
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
    pr.draft ? "Draft" : "Open",
    `Updated: ${relativeTime(pr.updatedAt)}`,
  ];
  if (watched) metaParts.push("W");
  const metaLine = metaParts.join("  |  ");

  // CI section header
  let ciHeader: string;
  if (ciLoading) {
    ciHeader = `CI Checks ${SPINNER_FRAMES[spinnerFrame]} refreshing...`;
  } else if (ci === null) {
    ciHeader = "CI Checks (loading...)";
  } else if (checks.length === 0) {
    ciHeader = "No checks found";
  } else {
    const fetchedAgo = relativeTime(new Date(ci.fetchedAt).toISOString());
    ciHeader = `CI Checks (${checks.length}) - fetched ${fetchedAgo}`;
  }

  // Column layout for checks
  const iconCol = 3;
  const openCol = 8;
  const conclusionCol = 14;
  const nameCol = Math.max(10, width - iconCol - conclusionCol - openCol - 6);

  // Build the unified selectable list: action row + check rows
  const visibleStart = scrollOffset;
  const visibleEnd = scrollOffset + listHeight;

  const actionRowVisible = visibleStart === 0;
  const checksStart = Math.max(0, visibleStart - 1);
  const checksEnd = visibleEnd - (actionRowVisible ? 1 : 0);
  const visibleChecks = checks.slice(checksStart, checksEnd);

  // Footer text
  const footerText = statusText
    ? ` ${statusText}`
    : " Enter Select | c Copy logs | r Refresh CI | w Watch | Backspace Back | q Quit";
  const footerFg = statusText ? "#9ece6a" : "#565f89";

  return (
    <box
      flexDirection="column"
      style={{ width: "100%", height: "100%", padding: 1 }}
    >
      {/* Header */}
      <box style={{ height: 1, width: "100%" }}>
        <text content={` ${header}`} fg="#7aa2f7" />
      </box>

      {/* Meta line */}
      <box style={{ height: 1, width: "100%" }}>
        <text content={` ${fit(metaLine, width - 4)}`} fg="#a9b1d6" />
      </box>

      {/* Spacer */}
      <box style={{ height: 1 }} />

      {/* Actions header */}
      <box style={{ height: 1, width: "100%" }}>
        <text content=" Actions" fg="#bb9af7" />
      </box>

      {/* Selectable list: action row + checks */}
      <box flexDirection="column" style={{ flexGrow: 1, width: "100%" }}>
        {/* Action row (only if in visible range) */}
        {actionRowVisible ? (
          <box
            style={{
              height: 1,
              width: "100%",
              backgroundColor: selectedIndex === 0 ? "#292e42" : undefined,
            }}
          >
            <text
              content="   > Open in editor"
              fg={selectedIndex === 0 ? "#7aa2f7" : "#c0caf5"}
            />
          </box>
        ) : null}

        {/* CI section header (inline in the list area) */}
        {actionRowVisible ? (
          <box style={{ height: 1, width: "100%" }}>
            <text content={` ${ciHeader}`} fg="#bb9af7" />
          </box>
        ) : null}

        {/* Check rows */}
        {visibleChecks.map((check, i) => {
          const actualCheckIndex = checksStart + i;
          const actualIndex = actualCheckIndex + 1; // +1 for the action row
          const isSelected = actualIndex === selectedIndex;
          const bg = isSelected ? "#292e42" : undefined;
          const icon = checkIcon(check);
          const conclusionLabel =
            check.status === "completed"
              ? (check.conclusion ?? "unknown")
              : check.status;
          const openLabel = check.detailsUrl ? "[open]" : "";

          const line =
            `  ${icon.char} ` +
            fit(check.name, nameCol) + " " +
            fit(conclusionLabel, conclusionCol) +
            openLabel.padEnd(openCol);

          return (
            <box
              key={`${check.name}-${actualCheckIndex}`}
              style={{ height: 1, width: "100%", backgroundColor: bg }}
            >
              <text content={line} fg={isSelected ? "#c0caf5" : icon.fg} />
            </box>
          );
        })}
      </box>

      {/* Spacer */}
      <box style={{ height: 1 }} />

      {/* Footer / Status */}
      <box style={{ height: 1, width: "100%" }}>
        <text content={footerText} fg={footerFg} />
      </box>
    </box>
  );
}

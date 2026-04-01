import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useCallback } from "react";
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

interface PrDetailProps {
  pr: UserPullRequest;
  ci: CIInfo | null;
  matches: LocalRepo[];
  watched: boolean;
  onOpenInEditor: () => void;
  onBack: () => void;
  onWatch: () => void;
  onOpenUrl: (url: string) => void;
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
  onOpenUrl,
  onExit,
}: PrDetailProps) {
  const { width, height } = useTerminalDimensions();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const checks = ci?.checks ?? [];

  // 6 chrome rows: header, meta, spacer, section header, spacer, footer + 2 padding
  const listHeight = Math.max(1, height - 8);

  const moveTo = useCallback(
    (newIndex: number) => {
      if (checks.length === 0) return;
      const clamped = Math.max(0, Math.min(newIndex, checks.length - 1));
      setSelectedIndex(clamped);
      setScrollOffset((prev) => {
        if (clamped < prev) return clamped;
        if (clamped >= prev + listHeight) return clamped - listHeight + 1;
        return prev;
      });
    },
    [checks.length, listHeight]
  );

  useKeyboard((key) => {
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
        const check = checks[selectedIndex];
        if (check?.detailsUrl) {
          onOpenUrl(check.detailsUrl);
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
        if (key.raw === "o") {
          onOpenInEditor();
        } else if (key.raw === "w") {
          onWatch();
        }
        break;
    }
  });

  // Header: #42 feat: add auth system
  const titleStr = `#${pr.number} ${pr.title}`;
  const header = fit(titleStr, width - 2);

  // Meta line
  const repoLabel = `${pr.repoOwner}/${pr.repoName}`;
  const metaParts = [
    repoLabel,
    `Branch: ${pr.headRef}`,
    pr.draft ? "Draft" : "Open",
    `Updated: ${relativeTime(pr.updatedAt)}`,
  ];
  if (watched) {
    metaParts.push("W");
  }
  const metaLine = metaParts.join("  |  ");

  // CI section header
  let ciHeader = "CI Checks";
  if (ci === null) {
    ciHeader = "CI Checks (loading...)";
  } else if (checks.length === 0) {
    ciHeader = "No checks found";
  }

  // Column layout for checks
  const iconCol = 3;
  const openCol = 8;
  const conclusionCol = 14;
  const nameCol = Math.max(10, width - iconCol - conclusionCol - openCol - 4);

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
        <text content={` ${fit(metaLine, width - 2)}`} fg="#a9b1d6" />
      </box>

      {/* Spacer */}
      <box style={{ height: 1 }} />

      {/* CI Section Header */}
      <box style={{ height: 1, width: "100%" }}>
        <text content={` ${ciHeader}`} fg="#bb9af7" />
      </box>

      {/* Check list */}
      <box flexDirection="column" style={{ flexGrow: 1, width: "100%" }}>
        {checks
          .slice(scrollOffset, scrollOffset + listHeight)
          .map((check, i) => {
            const actualIndex = scrollOffset + i;
            const isSelected = actualIndex === selectedIndex;
            const bg = isSelected ? "#292e42" : undefined;
            const icon = checkIcon(check);
            const conclusionLabel =
              check.status === "completed"
                ? (check.conclusion ?? "unknown")
                : check.status;
            const openLabel = check.detailsUrl ? "[open]" : "";

            return (
              <box
                key={`${check.name}-${actualIndex}`}
                style={{ height: 1, width: "100%", backgroundColor: bg }}
              >
                <text>
                  <span fg={icon.fg}>{`  ${icon.char} `}</span>
                  <span fg="#c0caf5">
                    {fit(check.name, nameCol)}
                  </span>
                  <span fg="#565f89">
                    {fit(conclusionLabel, conclusionCol)}
                  </span>
                  <span fg="#7aa2f7">{openLabel.padEnd(openCol)}</span>
                </text>
              </box>
            );
          })}
      </box>

      {/* Spacer */}
      <box style={{ height: 1 }} />

      {/* Footer */}
      <box style={{ height: 1, width: "100%" }}>
        <text
          content={
            " o Open in editor | Enter Open check URL | w Watch | Backspace Back | q Quit"
          }
          fg="#565f89"
        />
      </box>
    </box>
  );
}

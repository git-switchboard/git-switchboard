import { useTerminalDimensions } from "@opentui/react";
import type { PRFetchProgress } from "./github.js";
import type { ScanProgress } from "./scanner.js";
import { GAUGE_EMPTY, GAUGE_FILLED } from "./unicode.js";
import { useExitOnCtrlC } from './use-exit-on-ctrl-c.js';

interface LoadingProps {
  prProgress: PRFetchProgress;
  scanProgress: ScanProgress | null;
  scanDone: boolean;
}

function gauge(fraction: number, width: number): string {
  const filled = Math.round(fraction * width);
  const empty = width - filled;
  return GAUGE_FILLED.repeat(filled) + GAUGE_EMPTY.repeat(empty);
}

function prStatusLine(p: PRFetchProgress, barWidth: number): { text: string; bar: string | null } {
  switch (p.phase) {
    case "authenticating":
      return { text: "Authenticating with GitHub...", bar: null };
    case "searching":
      return { text: "Searching for open PRs...", bar: null };
    case "done": {
      const failed = p.failedRepos.length > 0 ? ` (${p.failedRepos.length} repo(s) skipped)` : "";
      return { text: `Done - ${p.fetchedPRs} PRs loaded${failed}`, bar: null };
    }
  }
}

function scanStatusLine(p: ScanProgress | null, done: boolean, barWidth: number): { text: string; bar: string | null; dir: string } {
  if (!p) return { text: "Waiting...", bar: null, dir: "" };
  if (done) {
    return { text: `Done - ${p.reposFound} repos found (${p.dirsScanned} dirs scanned)`, bar: null, dir: "" };
  }
  if (p.totalTopLevel > 0) {
    const fraction = p.completedTopLevel / p.totalTopLevel;
    const bar = gauge(fraction, barWidth);
    const text = `Scanning: ${p.completedTopLevel}/${p.totalTopLevel} top-level dirs, ${p.reposFound} repos found`;
    return { text, bar, dir: p.currentDir };
  }
  const text = `Scanning... ${p.reposFound} repos found, ${p.dirsScanned} dirs scanned`;
  return { text, bar: null, dir: p.currentDir };
}

export function Loading({ prProgress, scanProgress, scanDone }: LoadingProps) {
  useExitOnCtrlC();
  const { width } = useTerminalDimensions();
  const barWidth = Math.max(10, Math.min(40, width - 6));

  const pr = prStatusLine(prProgress, barWidth);
  const scan = scanStatusLine(scanProgress, scanDone, barWidth);

  const maxPathLen = Math.max(10, width - 6);
  const truncatedDir =
    scan.dir.length > maxPathLen
      ? "..." + scan.dir.slice(scan.dir.length - maxPathLen + 3)
      : scan.dir;

  const prDone = prProgress.phase === "done";
  const prIcon = prDone ? "*" : ">";
  const scanIcon = scanDone ? "*" : ">";

  return (
    <box flexDirection="column" style={{ width: "100%", height: "100%", padding: 1 }}>
      <box style={{ height: 1, width: "100%" }}>
        <text content=" git-switchboard pr" fg="#7aa2f7" />
      </box>

      <box style={{ height: 1 }} />

      {/* PR progress */}
      <box style={{ height: 1, width: "100%" }}>
        <text content={` ${prIcon} PRs: ${pr.text}`} fg={prDone ? "#9ece6a" : "#c0caf5"} />
      </box>
      {pr.bar ? (
        <box style={{ height: 1, width: "100%" }}>
          <text content={`   [${pr.bar}]`} fg="#7aa2f7" />
        </box>
      ) : null}

      <box style={{ height: 1 }} />

      {/* Scan progress */}
      <box style={{ height: 1, width: "100%" }}>
        <text content={` ${scanIcon} Repos: ${scan.text}`} fg={scanDone ? "#9ece6a" : "#c0caf5"} />
      </box>
      {scan.bar ? (
        <box style={{ height: 1, width: "100%" }}>
          <text content={`   [${scan.bar}]`} fg="#7aa2f7" />
        </box>
      ) : null}
      {truncatedDir ? (
        <box style={{ height: 1, width: "100%" }}>
          <text content={`   ${truncatedDir}`} fg="#565f89" />
        </box>
      ) : null}
    </box>
  );
}

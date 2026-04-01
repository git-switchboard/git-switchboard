import { useTerminalDimensions } from "@opentui/react";

interface LoadingProps {
  prStatus: string;
  scanStatus: string;
  reposFound: number;
  scanDir: string;
}

export function Loading({
  prStatus,
  scanStatus,
  reposFound,
  scanDir,
}: LoadingProps) {
  const { width } = useTerminalDimensions();

  const maxPathLen = Math.max(10, width - 4);
  const truncatedDir =
    scanDir.length > maxPathLen
      ? "..." + scanDir.slice(scanDir.length - maxPathLen + 3)
      : scanDir;

  return (
    <box flexDirection="column" style={{ width: "100%", height: "100%", padding: 1 }}>
      <box style={{ height: 1, width: "100%" }}>
        <text content=" git-switchboard pr" fg="#7aa2f7" />
      </box>

      <box style={{ height: 1 }} />

      <box style={{ height: 1, width: "100%" }}>
        <text content={` PRs:   ${prStatus}`} fg={prStatus === "done" ? "#9ece6a" : "#e0af68"} />
      </box>

      <box style={{ height: 1, width: "100%" }}>
        <text content={` Repos:  ${scanStatus}${reposFound > 0 ? ` (${reposFound} found)` : ""}`} fg={scanStatus === "done" ? "#9ece6a" : "#e0af68"} />
      </box>

      {scanDir ? (
        <>
          <box style={{ height: 1 }} />
          <box style={{ height: 1, width: "100%" }}>
            <text content={` ${truncatedDir}`} fg="#565f89" />
          </box>
        </>
      ) : null}
    </box>
  );
}

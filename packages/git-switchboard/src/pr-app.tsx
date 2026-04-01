import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useMemo } from "react";
import type { UserPullRequest } from "./types.js";
import type { LocalRepo } from "./scanner.js";

interface PrAppProps {
  prs: UserPullRequest[];
  localRepos: LocalRepo[];
  onSelect: (pr: UserPullRequest, matches: LocalRepo[]) => void;
  onExit: () => void;
}

export function PrApp({ prs, localRepos, onSelect, onExit }: PrAppProps) {
  const { width } = useTerminalDimensions();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState(false);

  const filteredPRs = useMemo(() => {
    if (!searchQuery) return prs;
    const q = searchQuery.toLowerCase();
    return prs.filter(
      (pr) =>
        pr.title.toLowerCase().includes(q) ||
        pr.repoId.includes(q) ||
        pr.headRef.toLowerCase().includes(q)
    );
  }, [prs, searchQuery]);

  const repoMatchMap = useMemo(() => {
    const map = new Map<string, LocalRepo[]>();
    for (const pr of prs) {
      const matches = localRepos.filter((r) => r.repoId === pr.repoId);
      map.set(`${pr.repoId}#${pr.number}`, matches);
    }
    return map;
  }, [prs, localRepos]);

  const clampIndex = (idx: number) =>
    Math.max(0, Math.min(idx, filteredPRs.length - 1));

  useKeyboard((key) => {
    if (searchMode) {
      if (key.name === "escape") {
        setSearchMode(false);
        setSearchQuery("");
      } else if (key.name === "return") {
        setSearchMode(false);
      } else if (key.name === "backspace") {
        setSearchQuery((q) => q.slice(0, -1));
      } else if (key.raw && key.raw.length === 1 && key.raw >= " ") {
        setSearchQuery((q) => q + key.raw);
        setSelectedIndex(0);
      }
      return;
    }

    switch (key.name) {
      case "up":
      case "k":
        setSelectedIndex((i) => clampIndex(i - 1));
        break;
      case "down":
      case "j":
        setSelectedIndex((i) => clampIndex(i + 1));
        break;
      case "return": {
        const pr = filteredPRs[selectedIndex];
        if (pr) {
          const matches = repoMatchMap.get(`${pr.repoId}#${pr.number}`) ?? [];
          onSelect(pr, matches);
        }
        break;
      }
      case "slash":
        setSearchMode(true);
        break;
      case "escape":
      case "q":
        onExit();
        break;
    }
  });

  // Column widths
  const localCol = 12;
  const statusCol = 8;
  const prCol = Math.min(30, Math.floor(width * 0.25));
  const repoCol = Math.min(25, Math.floor(width * 0.2));
  const branchCol = Math.max(
    15,
    width - prCol - repoCol - statusCol - localCol - 6
  );

  return (
    <box flexDirection="column" style={{ width: "100%", height: "100%" }}>
      {/* Header */}
      <box style={{ height: 1, width: "100%" }}>
        <text fg="#7aa2f7"> git-switchboard pr </text>
        <text fg="#565f89">
          {" "}
          {filteredPRs.length} open PRs
          {searchQuery ? ` | Search: ${searchQuery}` : ""}
          {searchMode ? " | (type to search)" : ""}
        </text>
      </box>

      {/* Column headers */}
      <box style={{ height: 1, width: "100%" }}>
        <text fg="#bb9af7">
          {" "}
          {"PR".padEnd(prCol)}
          {"Repo".padEnd(repoCol)}
          {"Branch".padEnd(branchCol)}
          {"Status".padEnd(statusCol)}
          {"Local".padEnd(localCol)}
        </text>
      </box>

      {/* PR list */}
      <scrollbox focused style={{ flexGrow: 1, width: "100%" }}>
        {filteredPRs.map((pr, i) => {
          const isSelected = i === selectedIndex;
          const bg = isSelected ? "#292e42" : undefined;
          const matches =
            repoMatchMap.get(`${pr.repoId}#${pr.number}`) ?? [];
          const cleanMatch = matches.find((r) => r.isClean);

          const localStatus =
            matches.length === 0
              ? "\u2014"
              : cleanMatch
                ? "\u2713 clean"
                : "\u2717 dirty";
          const localFg =
            matches.length === 0
              ? "#565f89"
              : cleanMatch
                ? "#9ece6a"
                : "#f7768e";

          const prLabel = `#${pr.number} ${pr.title}`.slice(0, prCol - 1);
          const repoLabel = `${pr.repoOwner}/${pr.repoName}`.slice(
            0,
            repoCol - 1
          );

          return (
            <box
              key={`${pr.repoId}#${pr.number}`}
              style={{ height: 1, width: "100%", backgroundColor: bg }}
            >
              <text>
                <span fg="#c0caf5">
                  {" "}
                  {prLabel.padEnd(prCol)}
                </span>
                <span fg="#a9b1d6">{repoLabel.padEnd(repoCol)}</span>
                <span fg="#ff9e64">
                  {pr.headRef.slice(0, branchCol - 1).padEnd(branchCol)}
                </span>
                <span fg={pr.draft ? "#e0af68" : "#9ece6a"}>
                  {(pr.draft ? "Draft" : "Open").padEnd(statusCol)}
                </span>
                <span fg={localFg}>{localStatus.padEnd(localCol)}</span>
              </text>
            </box>
          );
        })}
      </scrollbox>

      {/* Footer */}
      <box style={{ height: 1, width: "100%" }}>
        <text fg="#565f89">
          {" "}
          {"\u2191\u2193"}/jk Navigate | Enter Checkout | / Search | q Quit
        </text>
      </box>
    </box>
  );
}

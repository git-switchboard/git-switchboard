import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useMemo, useCallback } from "react";
import type { BranchWithPR, AuthorFilterMode } from "./types.js";

interface AppProps {
  branches: BranchWithPR[];
  currentUser: string;
  authorList: string[];
  initialShowRemote: boolean;
  onSelect: (branch: BranchWithPR) => void;
  onExit: () => void;
  /** Callback to fetch branches when remote toggle changes */
  fetchBranches: (includeRemote: boolean) => BranchWithPR[];
}

export function App({
  branches: initialBranches,
  currentUser,
  authorList,
  initialShowRemote,
  onSelect,
  onExit,
  fetchBranches,
}: AppProps) {
  const { width, height } = useTerminalDimensions();
  const [branches, setBranches] = useState(initialBranches);
  const [showRemote, setShowRemote] = useState(initialShowRemote);
  const [authorFilter, setAuthorFilter] = useState<AuthorFilterMode>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const authorFilterModes: AuthorFilterMode[] = useMemo(() => {
    const modes: AuthorFilterMode[] = ["all", "me"];
    if (authorList.length > 0) modes.push("list");
    return modes;
  }, [authorList]);

  const filteredBranches = useMemo(() => {
    let result = branches;

    if (authorFilter === "me") {
      result = result.filter(
        (b) => b.author.toLowerCase() === currentUser.toLowerCase()
      );
    } else if (authorFilter === "list") {
      const lower = authorList.map((a) => a.toLowerCase());
      result = result.filter((b) => lower.includes(b.author.toLowerCase()));
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((b) => b.name.toLowerCase().includes(q));
    }

    return result;
  }, [branches, authorFilter, currentUser, authorList, searchQuery]);

  const clampIndex = useCallback(
    (idx: number) => Math.max(0, Math.min(idx, filteredBranches.length - 1)),
    [filteredBranches.length]
  );

  useKeyboard((key) => {
    if (searchMode) {
      if (key.name === "escape") {
        setSearchMode(false);
        setSearchQuery("");
      } else if (key.name === "return") {
        setSearchMode(false);
      } else if (key.name === "backspace") {
        setSearchQuery((q) => q.slice(0, -1));
      } else if (key.char && key.char.length === 1) {
        setSearchQuery((q) => q + key.char);
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
        const branch = filteredBranches[selectedIndex];
        if (branch) onSelect(branch);
        break;
      }
      case "r": {
        const newShowRemote = !showRemote;
        setShowRemote(newShowRemote);
        const newBranches = fetchBranches(newShowRemote);
        setBranches(newBranches);
        setSelectedIndex(0);
        break;
      }
      case "a": {
        setAuthorFilter((current) => {
          const idx = authorFilterModes.indexOf(current);
          return authorFilterModes[(idx + 1) % authorFilterModes.length];
        });
        setSelectedIndex(0);
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

  const authorLabel =
    authorFilter === "all"
      ? "All"
      : authorFilter === "me"
        ? currentUser || "Me"
        : `[${authorList.join(", ")}]`;

  // Column widths
  const prCol = 20;
  const authorCol = 16;
  const dateCol = 14;
  const branchCol = Math.max(20, width - prCol - authorCol - dateCol - 8);

  return (
    <box flexDirection="column" style={{ width: "100%", height: "100%" }}>
      {/* Header */}
      <box style={{ height: 1, width: "100%" }}>
        <text fg="#7aa2f7">
          {" "}git-switchboard{" "}
        </text>
        <text fg="#565f89">
          {" "}Remote: {showRemote ? "ON" : "OFF"} | Author: {authorLabel}
          {searchQuery ? ` | Search: ${searchQuery}` : ""}
          {searchMode ? " | (type to search, Enter to confirm, Esc to cancel)" : ""}
        </text>
      </box>

      {/* Column headers */}
      <box style={{ height: 1, width: "100%" }}>
        <text fg="#bb9af7">
          {" "}
          {"Branch".padEnd(branchCol)}
          {"Author".padEnd(authorCol)}
          {"Updated".padEnd(dateCol)}
          {"PR".padEnd(prCol)}
        </text>
      </box>

      {/* Branch list */}
      <scrollbox
        focused
        style={{
          flexGrow: 1,
          width: "100%",
        }}
      >
        {filteredBranches.map((branch, i) => {
          const isSelected = i === selectedIndex;
          const bg = isSelected ? "#292e42" : undefined;
          const marker = branch.isCurrent ? "* " : "  ";
          const nameFg = branch.isCurrent
            ? "#73daca"
            : branch.isRemote
              ? "#ff9e64"
              : "#c0caf5";

          const prText = branch.pr
            ? `#${branch.pr.number} ${branch.pr.draft ? "Draft" : "Open"}`
            : "\u2014";

          return (
            <box
              key={branch.name}
              style={{
                height: 1,
                width: "100%",
                backgroundColor: bg,
              }}
            >
              <text>
                <span fg={nameFg}>
                  {marker}
                  {branch.name.padEnd(branchCol - 2)}
                </span>
                <span fg="#a9b1d6">{branch.author.padEnd(authorCol)}</span>
                <span fg="#565f89">{branch.relativeDate.padEnd(dateCol)}</span>
                <span fg={branch.pr?.draft ? "#e0af68" : "#9ece6a"}>
                  {prText.padEnd(prCol)}
                </span>
              </text>
            </box>
          );
        })}
      </scrollbox>

      {/* Footer */}
      <box style={{ height: 1, width: "100%" }}>
        <text fg="#565f89">
          {" "}\u2191\u2193/jk Navigate | Enter Select | r Remote | a Author | / Search | q Quit
        </text>
      </box>
    </box>
  );
}

import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { LocalRepo } from "./scanner.js";

interface ClonePromptProps {
  repoId: string;
  matches: LocalRepo[];
  onSelect: (repo: LocalRepo) => void;
  onCreateWorktree: (path: string) => void;
  onCancel: () => void;
}

export function ClonePrompt({
  repoId,
  matches,
  onSelect,
  onCreateWorktree,
  onCancel,
}: ClonePromptProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inputMode, setInputMode] = useState(false);
  const [worktreePath, setWorktreePath] = useState("");

  // Items: existing clones + "Create new worktree" option
  const items = [
    ...matches.map((m) => ({
      label: `${m.path} ${m.isClean ? "(clean)" : "(dirty)"}${m.isWorktree ? " [worktree]" : ""}`,
      type: "clone" as const,
      repo: m,
    })),
    {
      label: "+ Create new worktree",
      type: "new-worktree" as const,
      repo: undefined,
    },
  ];

  const clampIndex = (idx: number) =>
    Math.max(0, Math.min(idx, items.length - 1));

  useKeyboard((key) => {
    if (inputMode) {
      if (key.name === "escape") {
        setInputMode(false);
        setWorktreePath("");
      } else if (key.name === "return" && worktreePath) {
        onCreateWorktree(worktreePath);
      } else if (key.name === "backspace") {
        setWorktreePath((p) => p.slice(0, -1));
      } else if (key.raw && key.raw.length === 1 && key.raw >= " ") {
        setWorktreePath((p) => p + key.raw);
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
        const item = items[selectedIndex];
        if (item.type === "clone" && item.repo) {
          onSelect(item.repo);
        } else if (item.type === "new-worktree") {
          setInputMode(true);
        }
        break;
      }
      case "escape":
      case "q":
        onCancel();
        break;
    }
  });

  return (
    <box flexDirection="column" style={{ width: "100%", height: "100%" }}>
      <box style={{ height: 1, width: "100%" }}>
        <text fg="#7aa2f7"> Select clone for {repoId} </text>
      </box>

      {inputMode ? (
        <box
          style={{ height: 3, width: "100%", border: true }}
          title="Worktree path (relative to cwd or absolute)"
        >
          <text fg="#c0caf5">{worktreePath || " "}</text>
        </box>
      ) : (
        <box flexDirection="column" style={{ flexGrow: 1, width: "100%" }}>
          {items.map((item, i) => {
            const isSelected = i === selectedIndex;
            const bg = isSelected ? "#292e42" : undefined;
            const fg = item.type === "new-worktree" ? "#7aa2f7" : "#c0caf5";

            return (
              <box
                key={item.label}
                style={{ height: 1, width: "100%", backgroundColor: bg }}
              >
                <text content={` ${item.label}`} fg={fg} />
              </box>
            );
          })}
        </box>
      )}

      <box style={{ height: 1, width: "100%" }}>
        <text content={inputMode
            ? " Type path, Enter to confirm, Esc to cancel"
            : " Up/Down/jk Navigate | Enter Select | q Cancel"} fg="#565f89" />
      </box>
    </box>
  );
}

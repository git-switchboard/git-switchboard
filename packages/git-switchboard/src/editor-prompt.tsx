import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { EditorInfo } from "./editor.js";
import { DOWN_ARROW, RETURN_SYMBOL, UP_ARROW } from "./unicode.js";
import { useExitOnCtrlC } from './use-exit-on-ctrl-c.js';

interface EditorPromptProps {
  editors: EditorInfo[];
  onSelect: (editor: EditorInfo) => void;
  onCancel: () => void;
}

export function EditorPrompt({
  editors,
  onSelect,
  onCancel,
}: EditorPromptProps) {
  useExitOnCtrlC();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const clampIndex = (idx: number) =>
    Math.max(0, Math.min(idx, editors.length - 1));

  useKeyboard((key) => {
    key.stopPropagation();
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
        const editor = editors[selectedIndex];
        if (!editor.disabled) onSelect(editor);
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
        <text fg="#7aa2f7"> Select editor </text>
      </box>

      <box flexDirection="column" style={{ flexGrow: 1, width: "100%" }}>
        {editors.map((editor, i) => {
          const isSelected = i === selectedIndex;
          const isDisabled = !!editor.disabled;
          const reason = isSelected && typeof editor.disabled === 'string' ? ` — ${editor.disabled}` : '';
          const label = ` ${editor.name} (${editor.command})${reason}`;
          const fg = isDisabled
            ? '#565f89'
            : isSelected ? '#c0caf5' : '#a9b1d6';
          return (
            <box
              key={editor.command}
              style={{
                height: 1,
                width: "100%",
                backgroundColor: isSelected ? "#292e42" : undefined,
              }}
            >
              <text content={label} fg={fg} />
            </box>
          );
        })}
      </box>

      <box style={{ height: 1, width: "100%" }}>
        <text content={` [${UP_ARROW}${DOWN_ARROW}] Navigate | [${RETURN_SYMBOL}] Select | [q] Cancel`} fg="#565f89" />
      </box>
    </box>
  );
}

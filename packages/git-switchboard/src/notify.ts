import { execSync } from "node:child_process";
import { platform } from "node:os";

export function openUrl(url: string): void {
  const os = platform();
  try {
    if (os === "darwin") {
      execSync(`open "${url}"`, { stdio: "pipe" });
    } else if (os === "win32") {
      execSync(`start "" "${url}"`, { stdio: "pipe" });
    } else {
      execSync(`xdg-open "${url}"`, { stdio: "pipe" });
    }
  } catch {
    // Silently fail if no browser available
  }
}

/** Copy text to system clipboard. Returns true on success. */
export function copyToClipboard(text: string): boolean {
  const os = platform();
  try {
    if (os === "darwin") {
      execSync("pbcopy", { input: text, stdio: ["pipe", "pipe", "pipe"] });
    } else if (os === "linux") {
      // Try xclip first, fall back to xsel
      try {
        execSync("xclip -selection clipboard", {
          input: text,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        execSync("xsel --clipboard --input", {
          input: text,
          stdio: ["pipe", "pipe", "pipe"],
        });
      }
    } else if (os === "win32") {
      execSync("clip", { input: text, stdio: ["pipe", "pipe", "pipe"] });
    }
    return true;
  } catch {
    return false;
  }
}

export function sendNotification(title: string, message: string): void {
  const os = platform();
  const safeTitle = title.replace(/"/g, '\\"');
  const safeMessage = message.replace(/"/g, '\\"');
  try {
    if (os === "darwin") {
      execSync(
        `osascript -e 'display notification "${safeMessage}" with title "${safeTitle}"'`,
        { stdio: "pipe" }
      );
    } else if (os === "linux") {
      execSync(`notify-send "${safeTitle}" "${safeMessage}"`, {
        stdio: "pipe",
      });
    }
    // Windows: could use PowerShell toast, skip for now
  } catch {
    // Notification system not available
  }
}

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

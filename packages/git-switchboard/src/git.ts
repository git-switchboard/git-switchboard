import { execSync } from "node:child_process";
import type { BranchInfo } from "./types.js";

const FORMAT =
  "%(refname:short)%09%(authorname)%09%(committerdate:iso-strict)%09%(committerdate:relative)%09%(upstream:short)";

export function getCurrentBranch(): string {
  try {
    return execSync("git symbolic-ref --short HEAD", {
      encoding: "utf-8",
    }).trim();
  } catch {
    return "";
  }
}

export function getCurrentUser(): string {
  try {
    return execSync("git config user.name", { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

/**
 * Get all known aliases for the current user.
 * Includes git config user.name, and the username portion of user.email.
 * Also scans git log for committer names associated with the user's email.
 */
export function getCurrentUserAliases(): string[] {
  const aliases = new Set<string>();

  const name = getCurrentUser();
  if (name) aliases.add(name);

  // Get email and derive username from it
  try {
    const email = execSync("git config user.email", {
      encoding: "utf-8",
    }).trim();
    if (email) {
      // Extract username part before @
      const atIdx = email.indexOf("@");
      if (atIdx > 0) aliases.add(email.slice(0, atIdx));
    }
  } catch {
    // no email configured
  }

  // Check git log for other names used by the same email
  try {
    const output = execSync(
      'git log --all --format="%an" --author="$(git config user.email)" | sort -u',
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    for (const line of output.split("\n")) {
      if (line) aliases.add(line);
    }
  } catch {
    // not in a git repo or no commits
  }

  return [...aliases];
}

export function getRepoRemoteUrl(): string | undefined {
  try {
    return execSync("git remote get-url origin", {
      encoding: "utf-8",
    }).trim();
  } catch {
    return undefined;
  }
}

export function parseGitHubRemote(
  remoteUrl: string
): { owner: string; repo: string } | undefined {
  const sshMatch = remoteUrl.match(/git@[^:]+:(.+?)\/(.+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  const httpsMatch = remoteUrl.match(
    /https?:\/\/[^/]+\/(.+?)\/(.+?)(?:\.git)?$/
  );
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  return undefined;
}

export function getBranches(includeRemote: boolean): BranchInfo[] {
  const currentBranch = getCurrentBranch();
  const refs = includeRemote
    ? "refs/heads/ refs/remotes/"
    : "refs/heads/";

  const output = execSync(
    `git for-each-ref --sort=-committerdate --format="${FORMAT}" ${refs}`,
    { encoding: "utf-8" }
  );

  const branches: BranchInfo[] = [];

  for (const line of output.trim().split("\n")) {
    if (!line) continue;
    const [name, author, dateStr, relativeDate, tracking] = line.split("\t");

    // Skip HEAD pointer for remotes
    if (name.includes("/HEAD")) continue;

    const isRemote = name.startsWith("origin/");

    // Skip remote duplicates of local branches when showing remotes
    if (isRemote) {
      const localName = name.replace(/^origin\//, "");
      if (branches.some((b) => b.name === localName && !b.isRemote)) continue;
    }

    branches.push({
      name,
      author,
      date: new Date(dateStr),
      relativeDate,
      isRemote,
      isCurrent: name === currentBranch,
      trackingBranch: tracking || undefined,
    });
  }

  return branches;
}

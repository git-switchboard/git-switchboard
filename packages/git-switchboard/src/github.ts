import { Octokit } from "@octokit/rest";
import type { PullRequestInfo } from "./types.js";

export function resolveGitHubToken(flagValue?: string): string | undefined {
  return flagValue || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
}

export async function fetchOpenPRs(
  owner: string,
  repo: string,
  token: string
): Promise<Map<string, PullRequestInfo>> {
  const octokit = new Octokit({ auth: token });
  const prMap = new Map<string, PullRequestInfo>();

  try {
    const { data: pulls } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "open",
      per_page: 100,
      sort: "updated",
      direction: "desc",
    });

    for (const pr of pulls) {
      prMap.set(pr.head.ref, {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        draft: pr.draft ?? false,
      });
    }
  } catch {
    // Silently fail — PR data is optional enrichment
  }

  return prMap;
}

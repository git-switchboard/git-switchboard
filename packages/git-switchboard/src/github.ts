import { Octokit } from "@octokit/rest";
import type { PullRequestInfo, UserPullRequest } from "./types.js";

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

export async function fetchUserPRs(
  token: string
): Promise<UserPullRequest[]> {
  const octokit = new Octokit({ auth: token });
  const prs: UserPullRequest[] = [];

  try {
    const { data: user } = await octokit.rest.users.getAuthenticated();
    const username = user.login;

    const { data } = await octokit.rest.search.issuesAndPullRequests({
      q: `is:pr is:open author:${username}`,
      sort: "updated",
      order: "desc",
      per_page: 100,
    });

    // Fetch PR details in parallel to get head ref
    const detailPromises = data.items.map(async (item) => {
      const repoUrlMatch = item.repository_url?.match(
        /repos\/(.+?)\/(.+?)$/
      );
      if (!repoUrlMatch) return null;

      const repoOwner = repoUrlMatch[1];
      const repoName = repoUrlMatch[2];

      try {
        const { data: prDetail } = await octokit.rest.pulls.get({
          owner: repoOwner,
          repo: repoName,
          pull_number: item.number,
        });

        return {
          number: item.number,
          title: item.title,
          state: item.state,
          draft: prDetail.draft,
          repoOwner,
          repoName,
          repoId: `${repoOwner}/${repoName}`.toLowerCase(),
          headRef: prDetail.head.ref,
          updatedAt: item.updated_at,
          url: item.html_url,
        } satisfies UserPullRequest;
      } catch {
        return null;
      }
    });

    const results = await Promise.all(detailPromises);
    for (const pr of results) {
      if (pr) prs.push(pr);
    }
  } catch {
    // Silently fail
  }

  return prs;
}

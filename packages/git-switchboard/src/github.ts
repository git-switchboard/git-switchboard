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

function describeApiError(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    "response" in error
  ) {
    const err = error as {
      status: number;
      response?: {
        headers?: Record<string, string>;
        data?: { message?: string };
      };
    };
    const status = err.status;
    const message = err.response?.data?.message ?? "Unknown error";
    const ssoUrl = err.response?.headers?.["x-github-sso"];

    if (status === 403 && ssoUrl) {
      return `403 Forbidden — SSO authorization required. Authorize your token at: ${ssoUrl.replace(/^required; url=/, "")}`;
    }
    if (status === 403 && message.includes("rate limit")) {
      const reset = err.response?.headers?.["x-ratelimit-reset"];
      const resetTime = reset
        ? ` (resets at ${new Date(Number(reset) * 1000).toLocaleTimeString()})`
        : "";
      return `403 Rate limited${resetTime}`;
    }
    if (status === 403) {
      return `403 Forbidden — ${message} (may need 'repo' scope or SSO authorization)`;
    }
    if (status === 401) {
      return `401 Unauthorized — invalid or expired token`;
    }
    return `HTTP ${status} — ${message}`;
  }
  return String(error);
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

    // Group items by repo so we can skip entire repos that fail
    const itemsByRepo = new Map<
      string,
      { owner: string; name: string; items: typeof data.items }
    >();
    for (const item of data.items) {
      const repoUrlMatch = item.repository_url?.match(
        /repos\/(.+?)\/(.+?)$/
      );
      if (!repoUrlMatch) continue;
      const key = `${repoUrlMatch[1]}/${repoUrlMatch[2]}`;
      if (!itemsByRepo.has(key)) {
        itemsByRepo.set(key, {
          owner: repoUrlMatch[1],
          name: repoUrlMatch[2],
          items: [],
        });
      }
      itemsByRepo.get(key)!.items.push(item);
    }

    const failedRepos: string[] = [];

    // Process each repo: try first PR, skip the rest if it fails
    for (const [repoKey, { owner, name, items }] of itemsByRepo) {
      let repoAccessible = true;

      for (const item of items) {
        if (!repoAccessible) break;

        try {
          const { data: prDetail } = await octokit.rest.pulls.get({
            owner,
            repo: name,
            pull_number: item.number,
          });

          prs.push({
            number: item.number,
            title: item.title,
            state: item.state,
            draft: prDetail.draft,
            repoOwner: owner,
            repoName: name,
            repoId: repoKey.toLowerCase(),
            headRef: prDetail.head.ref,
            updatedAt: item.updated_at,
            url: item.html_url,
          });
        } catch (error) {
          repoAccessible = false;
          failedRepos.push(repoKey);
          console.error(
            `  ${repoKey}: ${describeApiError(error)}`
          );
        }
      }
    }

    if (failedRepos.length > 0) {
      console.error(
        `\nSkipped PRs from ${failedRepos.length} repo(s) due to API errors.`
      );
    }
  } catch (error) {
    console.error(`Failed to fetch PRs: ${describeApiError(error)}`);
  }

  return prs;
}

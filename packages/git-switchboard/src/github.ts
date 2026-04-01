import { execSync } from "node:child_process";
import { Octokit } from "@octokit/rest";
import type { CheckRun, CIInfo, CIStatus, PullRequestInfo, ReviewInfo, ReviewStatus, UserPullRequest } from "./types.js";

function ghCliToken(): string | undefined {
  try {
    return execSync("gh auth token", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function resolveGitHubToken(flagValue?: string): string | undefined {
  return flagValue || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ghCliToken();
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

export interface PRFetchProgress {
  phase: "authenticating" | "searching" | "fetching-details" | "done";
  /** Total PRs found in search */
  totalPRs: number;
  /** PRs whose details have been fetched so far */
  fetchedPRs: number;
  /** Current repo being processed */
  currentRepo: string;
  /** Repos that failed */
  failedRepos: string[];
}

export async function fetchUserPRs(
  token: string,
  onProgress?: (progress: PRFetchProgress) => void
): Promise<UserPullRequest[]> {
  const octokit = new Octokit({ auth: token });
  const prs: UserPullRequest[] = [];

  const progress: PRFetchProgress = {
    phase: "authenticating",
    totalPRs: 0,
    fetchedPRs: 0,
    currentRepo: "",
    failedRepos: [],
  };
  onProgress?.(progress);

  try {
    const { data: user } = await octokit.rest.users.getAuthenticated();
    const username = user.login;

    progress.phase = "searching";
    onProgress?.(progress);

    const { data } = await octokit.rest.search.issuesAndPullRequests({
      q: `is:pr is:open author:${username}`,
      sort: "updated",
      order: "desc",
      per_page: 100,
    });

    progress.totalPRs = data.total_count;
    progress.phase = "fetching-details";
    onProgress?.(progress);

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
      progress.currentRepo = repoKey;
      onProgress?.(progress);

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
            draft: prDetail.draft ?? false,
            repoOwner: owner,
            repoName: name,
            repoId: repoKey.toLowerCase(),
            headRef: prDetail.head.ref,
            updatedAt: item.updated_at,
            url: item.html_url,
          });
          progress.fetchedPRs++;
          onProgress?.(progress);
        } catch (error) {
          repoAccessible = false;
          failedRepos.push(repoKey);
          progress.failedRepos = [...failedRepos];
          onProgress?.(progress);
          console.error(
            `  ${repoKey}: ${describeApiError(error)}`
          );
        }
      }
    }

    progress.phase = "done";
    progress.currentRepo = "";
    onProgress?.(progress);

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

export async function fetchChecks(
  token: string,
  owner: string,
  repo: string,
  ref: string
): Promise<CIInfo> {
  const octokit = new Octokit({ auth: token });
  try {
    const { data } = await octokit.rest.checks.listForRef({
      owner,
      repo,
      ref,
      per_page: 100,
    });
    const checks: CheckRun[] = data.check_runs.map((run) => ({
      id: run.id,
      name: run.name,
      status: run.status as CheckRun["status"],
      conclusion: run.conclusion ?? null,
      detailsUrl: run.details_url ?? null,
      startedAt: run.started_at ?? null,
      completedAt: run.completed_at ?? null,
    }));
    let status: CIStatus = "unknown";
    if (checks.length > 0) {
      const anyPending = checks.some((c) => c.status !== "completed");
      const allPassing = checks.every(
        (c) =>
          c.status === "completed" &&
          (c.conclusion === "success" ||
            c.conclusion === "skipped" ||
            c.conclusion === "neutral")
      );
      const anyFailing = checks.some(
        (c) => c.status === "completed" && c.conclusion === "failure"
      );
      if (anyPending) status = "pending";
      else if (allPassing) status = "passing";
      else if (anyFailing) status = "failing";
      else status = "passing";
    }
    return { status, checks, fetchedAt: Date.now() };
  } catch {
    return { status: "unknown", checks: [], fetchedAt: Date.now() };
  }
}

/**
 * Fetch the raw logs for a GitHub Actions job (check run).
 * Returns the log text, or null if unavailable.
 */
export async function fetchCheckLogs(
  token: string,
  owner: string,
  repo: string,
  jobId: number
): Promise<string | null> {
  const octokit = new Octokit({ auth: token });
  try {
    // This endpoint returns a 302 redirect to the log download URL
    const response = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
      owner,
      repo,
      job_id: jobId,
    });
    // Octokit follows the redirect and returns the data
    if (typeof response.data === "string") {
      return response.data;
    }
    // Some versions return a URL string; others return the body
    return String(response.data);
  } catch {
    return null;
  }
}

/**
 * Fetch review status for a PR.
 * Computes effective status by looking at latest review per reviewer,
 * then comparing against the last push time to detect re-review needed.
 */
export async function fetchReviewStatus(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
  headRef: string
): Promise<ReviewInfo> {
  const octokit = new Octokit({ auth: token });
  try {
    // Get all reviews
    const { data: reviews } = await octokit.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });

    if (reviews.length === 0) {
      return { status: "needs-review", reviewers: [], fetchedAt: Date.now() };
    }

    // Get the latest commit time to detect pushes after reviews
    const { data: commits } = await octokit.rest.pulls.listCommits({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 1,
    });
    // Last commit is the most recent (API returns chronological order, last page has newest)
    // Actually listCommits returns ascending order, so we need the last entry
    // With per_page: 1 we only get the first commit. Use a different approach:
    const { data: prDetail } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });
    // The updated_at on the head ref's commit
    const lastPushAt = prDetail.head.repo
      ? new Date(prDetail.updated_at).getTime()
      : 0;

    // Build latest review state per reviewer (ignore COMMENTED and PENDING)
    const latestByReviewer = new Map<
      string,
      { state: string; submittedAt: string }
    >();
    for (const review of reviews) {
      if (!review.user?.login) continue;
      if (review.state === "COMMENTED" || review.state === "PENDING") continue;
      const existing = latestByReviewer.get(review.user.login);
      if (
        !existing ||
        new Date(review.submitted_at ?? 0) >
          new Date(existing.submittedAt)
      ) {
        latestByReviewer.set(review.user.login, {
          state: review.state,
          submittedAt: review.submitted_at ?? "",
        });
      }
    }

    const reviewers = [...latestByReviewer.keys()];

    // Check if changes were requested then new commits pushed
    const hasChangesRequested = [...latestByReviewer.values()].some(
      (r) => r.state === "CHANGES_REQUESTED"
    );
    if (hasChangesRequested) {
      // Find the latest "changes requested" review time
      const lastChangesRequestedAt = Math.max(
        ...[...latestByReviewer.values()]
          .filter((r) => r.state === "CHANGES_REQUESTED")
          .map((r) => new Date(r.submittedAt).getTime())
      );
      // If there were pushes after the changes requested, it's re-review needed
      if (lastPushAt > lastChangesRequestedAt) {
        return {
          status: "re-review-needed",
          reviewers,
          fetchedAt: Date.now(),
        };
      }
      return {
        status: "changes-requested",
        reviewers,
        fetchedAt: Date.now(),
      };
    }

    const allApproved = [...latestByReviewer.values()].every(
      (r) => r.state === "APPROVED"
    );
    if (allApproved && latestByReviewer.size > 0) {
      return { status: "approved", reviewers, fetchedAt: Date.now() };
    }

    const hasDismissed = [...latestByReviewer.values()].some(
      (r) => r.state === "DISMISSED"
    );
    if (hasDismissed) {
      return { status: "dismissed", reviewers, fetchedAt: Date.now() };
    }

    return { status: "needs-review", reviewers, fetchedAt: Date.now() };
  } catch {
    return { status: "needs-review", reviewers: [], fetchedAt: Date.now() };
  }
}

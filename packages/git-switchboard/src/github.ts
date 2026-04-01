import { execSync } from 'node:child_process';
import { Octokit } from '@octokit/rest';
import { execute, graphql } from './graphql.js';
import type {
  CheckRun,
  CIInfo,
  CIStatus,
  PullRequestInfo,
  ReviewInfo,
  ReviewStatus,
  ReviewerState,
  UserPullRequest,
} from './types.js';

function ghCliToken(): string | undefined {
  try {
    return (
      execSync('gh auth token', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

export interface RateLimitInfo {
  remaining: number;
  limit: number;
  used: number;
  resetAt: Date;
}

/** Shared mutable rate limit state, updated on every API response */
export const rateLimit: { current: RateLimitInfo | null } = { current: null };

/** Create an Octokit instance that tracks rate limit from response headers */
export function createOctokit(token: string): Octokit {
  const octokit = new Octokit({ auth: token });
  octokit.hook.after('request', (response) => {
    const h = response.headers as Record<string, string | undefined>;
    const remaining = h['x-ratelimit-remaining'];
    const limit = h['x-ratelimit-limit'];
    const used = h['x-ratelimit-used'];
    const reset = h['x-ratelimit-reset'];
    if (remaining && limit) {
      rateLimit.current = {
        remaining: Number(remaining),
        limit: Number(limit),
        used: Number(used ?? 0),
        resetAt: new Date(Number(reset ?? 0) * 1000),
      };
    }
  });
  return octokit;
}

export function resolveGitHubToken(flagValue?: string): string | undefined {
  return (
    flagValue ||
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    ghCliToken()
  );
}

export async function fetchOpenPRs(
  owner: string,
  repo: string,
  token: string
): Promise<Map<string, PullRequestInfo>> {
  const octokit = createOctokit(token);
  const prMap = new Map<string, PullRequestInfo>();

  try {
    const { data: pulls } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: 'open',
      per_page: 100,
      sort: 'updated',
      direction: 'desc',
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
    typeof error === 'object' &&
    'status' in error &&
    'response' in error
  ) {
    const err = error as {
      status: number;
      response?: {
        headers?: Record<string, string>;
        data?: { message?: string };
      };
    };
    const status = err.status;
    const message = err.response?.data?.message ?? 'Unknown error';
    const ssoUrl = err.response?.headers?.['x-github-sso'];

    if (status === 403 && ssoUrl) {
      return `403 Forbidden — SSO authorization required. Authorize your token at: ${ssoUrl.replace(/^required; url=/, '')}`;
    }
    if (status === 403 && message.includes('rate limit')) {
      const reset = err.response?.headers?.['x-ratelimit-reset'];
      const resetTime = reset
        ? ` (resets at ${new Date(Number(reset) * 1000).toLocaleTimeString()})`
        : '';
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

// ─── GraphQL queries (typed via gql.tada) ──────────────────────
// Single source of truth: gql.tada provides type inference,
// printQuery() converts to string for octokit.graphql().

const SEARCH_USER_PRS = graphql(`
  query SearchUserPRs($searchQuery: String!) {
    search(query: $searchQuery, type: ISSUE, first: 100) {
      issueCount
      nodes {
        __typename
        ... on PullRequest {
          number
          title
          state
          isDraft
          headRefName
          updatedAt
          url
          repository {
            owner { login }
            name
          }
          headRepository {
            owner { login }
            name
          }
          commits(last: 1) {
            nodes {
              commit {
                committedDate
                statusCheckRollup {
                  contexts(first: 100) {
                    nodes {
                      __typename
                      ... on CheckRun {
                        databaseId
                        name
                        status
                        conclusion
                        detailsUrl
                        startedAt
                        completedAt
                      }
                    }
                  }
                }
              }
            }
          }
          reviews(last: 100) {
            nodes {
              author { login }
              state
              submittedAt
            }
          }
        }
      }
    }
  }
`);

const PR_DETAIL_QUERY = graphql(`
  query PRDetail($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        commits(last: 1) {
          nodes {
            commit {
              committedDate
              statusCheckRollup {
                contexts(first: 100) {
                  nodes {
                    __typename
                    ... on CheckRun {
                      databaseId
                      name
                      status
                      conclusion
                      detailsUrl
                      startedAt
                      completedAt
                    }
                  }
                }
              }
            }
          }
        }
        reviews(last: 100) {
          nodes {
            author { login }
            state
            submittedAt
          }
        }
      }
    }
  }
`);

// ─── fetchUserPRs (GraphQL) ─────────────────────────────────────

export interface PRFetchProgress {
  phase: 'authenticating' | 'searching' | 'done';
  totalPRs: number;
  fetchedPRs: number;
  currentRepo: string;
  failedRepos: string[];
}

export interface FetchUserPRsResult {
  prs: UserPullRequest[];
  ciCache: Map<string, CIInfo>;
  reviewCache: Map<string, ReviewInfo>;
}

export async function fetchUserPRs(
  token: string,
  onProgress?: (progress: PRFetchProgress) => void
): Promise<FetchUserPRsResult> {
  const octokit = createOctokit(token);
  const prs: UserPullRequest[] = [];
  const ciCache = new Map<string, CIInfo>();
  const reviewCache = new Map<string, ReviewInfo>();

  const progress: PRFetchProgress = {
    phase: 'authenticating',
    totalPRs: 0,
    fetchedPRs: 0,
    currentRepo: '',
    failedRepos: [],
  };
  onProgress?.(progress);

  try {
    const { data: user } = await octokit.rest.users.getAuthenticated();
    const username = user.login;

    progress.phase = 'searching';
    onProgress?.(progress);

    // Single GraphQL query gets PRs + CI + reviews in one call
    const result = await execute(octokit, SEARCH_USER_PRS, {
      searchQuery: `is:pr is:open author:${username}`,
    });

    progress.totalPRs = result.search.issueCount;

    for (const node of result.search.nodes ?? []) {
      if (!node || node.__typename !== 'PullRequest') continue;
      const baseId = `${node.repository.owner.login}/${node.repository.name}`.toLowerCase();
      const headRepo = node.headRepository;
      const forkId = headRepo
        ? `${headRepo.owner.login}/${headRepo.name}`.toLowerCase()
        : null;
      const prKey = `${baseId}#${node.number}`;

      prs.push({
        number: node.number,
        title: node.title,
        state: node.state,
        draft: node.isDraft,
        repoOwner: node.repository.owner.login,
        repoName: node.repository.name,
        repoId: baseId,
        forkRepoId: forkId !== baseId ? forkId : null,
        headRef: node.headRefName,
        updatedAt: node.updatedAt,
        url: node.url,
      });

      // Extract CI from commits → statusCheckRollup
      const commitNode = (node.commits?.nodes ?? [])[0];
      const lastCommitDate = commitNode?.commit.committedDate ?? '';
      const contextNodes =
        commitNode?.commit.statusCheckRollup?.contexts.nodes ?? [];

      const checks: CheckRun[] = contextNodes
        .filter(
          (n): n is typeof n & { __typename: 'CheckRun'; name: string } =>
            n != null && n.__typename === 'CheckRun' && n.name != null
        )
        .map((n) => ({
          id: n.databaseId ?? 0,
          name: n.name,
          status: (n.status?.toLowerCase() ?? 'queued') as CheckRun['status'],
          conclusion: n.conclusion?.toLowerCase() ?? null,
          detailsUrl: n.detailsUrl ?? null,
          startedAt: n.startedAt ?? null,
          completedAt: n.completedAt ?? null,
        }));

      ciCache.set(prKey, {
        status: computeCIStatus(checks),
        checks,
        fetchedAt: Date.now(),
      });

      // Extract reviews
      const reviewNodes: ReviewNodeInput[] = ((node.reviews?.nodes) ?? [])
        .filter((n): n is NonNullable<typeof n> => n != null)
        .filter((n) => n.submittedAt != null)
        .map((n) => ({
          author: n.author ? { login: n.author.login } : null,
          state: n.state,
          submittedAt: n.submittedAt!,
        }));

      reviewCache.set(prKey, computeReviewStatus(reviewNodes, lastCommitDate));
    }

    progress.fetchedPRs = prs.length;
    progress.phase = 'done';
    onProgress?.(progress);
  } catch (error) {
    console.error(`Failed to fetch PRs: ${describeApiError(error)}`);
  }

  return { prs, ciCache, reviewCache };
}

// ─── fetchPRDetails (GraphQL) — CI + Reviews in one call ────────

function computeCIStatus(checks: CheckRun[]): CIStatus {
  if (checks.length === 0) return 'unknown';
  const anyPending = checks.some((c) => c.status !== 'completed');
  const allPassing = checks.every(
    (c) =>
      c.status === 'completed' &&
      (c.conclusion === 'success' ||
        c.conclusion === 'skipped' ||
        c.conclusion === 'neutral')
  );
  const anyFailing = checks.some(
    (c) => c.status === 'completed' && c.conclusion === 'failure'
  );
  if (anyPending) return 'pending';
  if (allPassing) return 'passing';
  if (anyFailing) return 'failing';
  return 'passing';
}

interface ReviewNodeInput {
  author: { login: string } | null;
  state: string;
  submittedAt: string;
}

function computeReviewStatus(
  reviewNodes: readonly ReviewNodeInput[],
  lastCommitDate: string
): ReviewInfo {
  const lastCommitTime = new Date(lastCommitDate).getTime();

  // Build latest actionable review per reviewer
  const latestByReviewer = new Map<
    string,
    { state: string; submittedAt: string }
  >();
  for (const review of reviewNodes) {
    if (!review.author?.login) continue;
    if (review.state === 'COMMENTED' || review.state === 'PENDING') continue;
    const existing = latestByReviewer.get(review.author.login);
    if (
      !existing ||
      new Date(review.submittedAt) > new Date(existing.submittedAt)
    ) {
      latestByReviewer.set(review.author.login, {
        state: review.state,
        submittedAt: review.submittedAt,
      });
    }
  }

  const reviewers: ReviewerState[] = [...latestByReviewer.entries()].map(
    ([login, { state, submittedAt }]) => ({
      login,
      state: state as ReviewerState['state'],
      submittedAt,
    })
  );

  if (reviewers.length === 0) {
    return { status: 'needs-review', reviewers: [], fetchedAt: Date.now() };
  }

  const hasChangesRequested = reviewers.some(
    (r) => r.state === 'CHANGES_REQUESTED'
  );
  if (hasChangesRequested) {
    const lastCRTime = Math.max(
      ...reviewers
        .filter((r) => r.state === 'CHANGES_REQUESTED')
        .map((r) => new Date(r.submittedAt).getTime())
    );
    if (lastCommitTime > lastCRTime) {
      return {
        status: 're-review-needed',
        reviewers,
        fetchedAt: Date.now(),
      };
    }
    return {
      status: 'changes-requested',
      reviewers,
      fetchedAt: Date.now(),
    };
  }

  const allApproved = reviewers.every((r) => r.state === 'APPROVED');
  if (allApproved) {
    return { status: 'approved', reviewers, fetchedAt: Date.now() };
  }

  const hasDismissed = reviewers.some((r) => r.state === 'DISMISSED');
  if (hasDismissed) {
    return { status: 'dismissed', reviewers, fetchedAt: Date.now() };
  }

  return { status: 'needs-review', reviewers, fetchedAt: Date.now() };
}

/**
 * Fetch CI checks + review status for a PR in a single GraphQL call.
 */
export async function fetchPRDetails(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<{ ci: CIInfo; review: ReviewInfo }> {
  const octokit = createOctokit(token);

  try {
    const result = await execute(octokit, PR_DETAIL_QUERY, {
      owner,
      repo,
      number: pullNumber,
    });

    const pr = result.repository?.pullRequest;
    if (!pr) throw new Error('PR not found');

    const commitNode = (pr.commits.nodes ?? [])[0];
    const lastCommitDate = commitNode?.commit.committedDate ?? '';
    const contextNodes =
      commitNode?.commit.statusCheckRollup?.contexts.nodes ?? [];

    // Extract check runs (filter out StatusContext nodes)
    const checks: CheckRun[] = contextNodes
      .filter((n): n is typeof n & { __typename: 'CheckRun'; name: string } =>
        n != null && n.__typename === 'CheckRun' && n.name != null
      )
      .map((n) => ({
        id: n.databaseId ?? 0,
        name: n.name,
        status: (n.status?.toLowerCase() ?? 'queued') as CheckRun['status'],
        conclusion: n.conclusion?.toLowerCase() ?? null,
        detailsUrl: n.detailsUrl ?? null,
        startedAt: n.startedAt ?? null,
        completedAt: n.completedAt ?? null,
      }));

    const ci: CIInfo = {
      status: computeCIStatus(checks),
      checks,
      fetchedAt: Date.now(),
    };

    const reviewNodes: ReviewNodeInput[] = ((pr.reviews?.nodes) ?? [])
      .filter((n): n is NonNullable<typeof n> => n != null)
      .filter((n) => n.submittedAt != null)
      .map((n) => ({
        author: n.author ? { login: n.author.login } : null,
        state: n.state,
        submittedAt: n.submittedAt!,
      }));
    const review = computeReviewStatus(reviewNodes, lastCommitDate);

    return { ci, review };
  } catch {
    return {
      ci: { status: 'unknown', checks: [], fetchedAt: Date.now() },
      review: { status: 'needs-review', reviewers: [], fetchedAt: Date.now() },
    };
  }
}

// ─── Legacy REST wrappers (kept for backward compat) ────────────

/** @deprecated Use fetchPRDetails instead */
export async function fetchChecks(
  token: string,
  owner: string,
  repo: string,
  ref: string
): Promise<CIInfo> {
  const result = await fetchPRDetails(token, owner, repo, 0);
  // Fallback: if called with ref, use REST
  if (ref) {
    const octokit = createOctokit(token);
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
        status: run.status as CheckRun['status'],
        conclusion: run.conclusion ?? null,
        detailsUrl: run.details_url ?? null,
        startedAt: run.started_at ?? null,
        completedAt: run.completed_at ?? null,
      }));
      return {
        status: computeCIStatus(checks),
        checks,
        fetchedAt: Date.now(),
      };
    } catch {
      return { status: 'unknown', checks: [], fetchedAt: Date.now() };
    }
  }
  return result.ci;
}

/** @deprecated Use fetchPRDetails instead */
export async function fetchReviewStatus(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
  _headRef: string
): Promise<ReviewInfo> {
  const result = await fetchPRDetails(token, owner, repo, pullNumber);
  return result.review;
}

/**
 * Fetch raw logs for a GitHub Actions job. REST only — no GraphQL equivalent.
 */
export async function fetchCheckLogs(
  token: string,
  owner: string,
  repo: string,
  jobId: number
): Promise<string | null> {
  const octokit = createOctokit(token);
  try {
    const response =
      await octokit.rest.actions.downloadJobLogsForWorkflowRun({
        owner,
        repo,
        job_id: jobId,
      });
    if (typeof response.data === 'string') {
      return response.data;
    }
    return String(response.data);
  } catch {
    return null;
  }
}

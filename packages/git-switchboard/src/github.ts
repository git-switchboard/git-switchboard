import { execSync } from 'node:child_process';
import { Octokit } from '@octokit/rest';
import { selectRelevantCheckRuns } from './check-selection.js';
import { execute, graphql, type ResultOf } from './graphql.js';
import { hashKey, readCache, readCacheEntry, writeCache } from './cache.js';
import type {
  CheckRun,
  CIInfo,
  CIStatus,
  MergeableStatus,
  ProviderRateLimit,
  PullRequestInfo,
  ReviewInfo,
  ReviewStatus,
  ReviewerState,
  UserPullRequest,
} from './types.js';

export function ghCliToken(): string | undefined {
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

/** Shared mutable rate limit state, updated on every API response */
export const rateLimit: { current: ProviderRateLimit | null } = { current: null };

/** Create an Octokit instance that tracks rate limit from response headers */
const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export function createOctokit(token: string): Octokit {
  const octokit = new Octokit({ auth: token, log: silentLogger });
  octokit.hook.after('request', (response) => {
    const h = response.headers as Record<string, string | undefined>;
    const remaining = h['x-ratelimit-remaining'];
    const limit = h['x-ratelimit-limit'];
    const used = h['x-ratelimit-used'];
    const reset = h['x-ratelimit-reset'];
    if (remaining && limit) {
      rateLimit.current = {
        provider: 'github',
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

const RETRYABLE_GITHUB_STATUSES = new Set([502, 503, 504]);
const RETRYABLE_NETWORK_ERRORS = [
  'fetch failed',
  'gateway timeout',
  'bad gateway',
  'timed out',
  'econnreset',
  'eai_again',
];

function apiErrorStatus(error: unknown): number | null {
  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
  ) {
    return (error as { status: number }).status;
  }
  return null;
}

function isRetryableGitHubError(error: unknown): boolean {
  const status = apiErrorStatus(error);
  if (status != null) {
    return RETRYABLE_GITHUB_STATUSES.has(status);
  }

  const message = String(error).toLowerCase();
  return RETRYABLE_NETWORK_ERRORS.some((fragment) => message.includes(fragment));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function retryGitHubRequest<T>(
  request: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableGitHubError(error)) {
        throw error;
      }
      await sleep(250 * attempt);
    }
  }

  throw lastError;
}

// ─── GraphQL queries (typed via gql.tada) ──────────────────────
// Single source of truth: gql.tada provides type inference,
// printQuery() converts to string for octokit.graphql().

const SEARCH_USER_PRS = graphql(`
  query SearchUserPRs($searchQuery: String!, $cursor: String) {
    search(query: $searchQuery, type: ISSUE, first: 25, after: $cursor) {
      issueCount
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        __typename
        ... on PullRequest {
          id
          number
          title
          state
          isDraft
          headRefName
          updatedAt
          url
          author { login }
          repository {
            owner { login }
            name
          }
          headRepository {
            owner { login }
            name
          }
        }
      }
    }
  }
`);

type SearchNode = NonNullable<NonNullable<ResultOf<typeof SEARCH_USER_PRS>['search']['nodes']>[number]>;
type PullRequestSearchNode = Extract<SearchNode, { __typename: 'PullRequest' }>;

type SearchResult = ResultOf<typeof SEARCH_USER_PRS>;

interface StatusContextNodeInput {
  __typename?: string | null;
  databaseId?: number | null;
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  detailsUrl?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  checkSuite?: {
    databaseId?: number | null;
    createdAt?: string | null;
    app?: {
      slug?: string | null;
    } | null;
    matchingPullRequests?: {
      nodes?: Array<{
        number?: number | null;
      } | null> | null;
    } | null;
    workflowRun?: {
      databaseId?: number | null;
      runNumber?: number | null;
      createdAt?: string | null;
      workflow?: {
        name?: string | null;
      } | null;
    } | null;
  } | null;
}

interface ReviewNodeGraphInput {
  author?: { login?: string | null } | null;
  state?: string | null;
  submittedAt?: string | null;
}

interface PullRequestDetailsNodeInput {
  body?: string | null;
  mergeable?: string | null;
  commits: {
    nodes?: Array<{
      commit?: {
        committedDate?: string | null;
        statusCheckRollup?: {
          contexts?: {
            nodes?: readonly (StatusContextNodeInput | null)[] | null;
          } | null;
        } | null;
      } | null;
    } | null> | null;
  };
  reviews?: {
    nodes?: Array<ReviewNodeGraphInput | null> | null;
  } | null;
}

function extractChecksFromStatusContextNodes(
  contextNodes: readonly (StatusContextNodeInput | null)[],
  pullNumber: number
): CheckRun[] {
  const candidates = contextNodes
    .filter(
      (node): node is StatusContextNodeInput & {
        __typename: 'CheckRun';
        name: string;
        checkSuite: NonNullable<StatusContextNodeInput['checkSuite']>;
      } =>
        node != null &&
        node.__typename === 'CheckRun' &&
        node.name != null &&
        node.checkSuite != null
    )
    .map((node) => ({
      id: node.databaseId ?? 0,
      name: node.name,
      status: (node.status?.toLowerCase() ?? 'queued') as CheckRun['status'],
      conclusion: node.conclusion?.toLowerCase() ?? null,
      detailsUrl: node.detailsUrl ?? null,
      startedAt: node.startedAt ?? null,
      completedAt: node.completedAt ?? null,
      appSlug: node.checkSuite.app?.slug ?? null,
      suiteId: node.checkSuite.databaseId ?? null,
      suiteCreatedAt: node.checkSuite.createdAt ?? null,
      workflowRunId: node.checkSuite.workflowRun?.databaseId ?? null,
      workflowRunNumber: node.checkSuite.workflowRun?.runNumber ?? null,
      workflowRunCreatedAt: node.checkSuite.workflowRun?.createdAt ?? null,
      workflowName: node.checkSuite.workflowRun?.workflow?.name ?? null,
      matchingPullRequestNumbers: (node.checkSuite.matchingPullRequests?.nodes ?? [])
        .map((matchingPr) => matchingPr?.number ?? null)
        .filter((number): number is number => number != null),
    }));

  return selectRelevantCheckRuns(candidates, pullNumber);
}

/** Paginate a GitHub search query, collecting all nodes across pages. */
async function paginateSearch(
  octokit: Octokit,
  searchQuery: string
): Promise<{ nodes: SearchNode[]; totalCount: number }> {
  const allNodes: SearchNode[] = [];
  let cursor: string | undefined;
  let totalCount = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page: SearchResult = await retryGitHubRequest(() =>
      execute(octokit, SEARCH_USER_PRS, {
        searchQuery,
        cursor: cursor ?? null,
      })
    );
    totalCount = page.search.issueCount;
    for (const node of page.search.nodes ?? []) {
      if (node) allNodes.push(node);
    }
    if (!page.search.pageInfo.hasNextPage) break;
    cursor = page.search.pageInfo.endCursor ?? undefined;
    if (!cursor) break;
  }

  return { nodes: allNodes, totalCount };
}

const PR_DETAIL_QUERY = graphql(`
  query PRDetail($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        mergeable
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
                      checkSuite {
                        databaseId
                        createdAt
                        app { slug }
                        matchingPullRequests(first: 10) {
                          nodes {
                            ... on PullRequest {
                              number
                            }
                          }
                        }
                        workflowRun {
                          databaseId
                          runNumber
                          createdAt
                          workflow {
                            name
                          }
                        }
                      }
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

const BATCH_PR_DETAILS_QUERY = graphql(`
  query BatchPRDetails($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      ... on PullRequest {
        id
        number
        body
        mergeable
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
                      checkSuite {
                        databaseId
                        createdAt
                        app { slug }
                        matchingPullRequests(first: 10) {
                          nodes {
                            ... on PullRequest {
                              number
                            }
                          }
                        }
                        workflowRun {
                          databaseId
                          runNumber
                          createdAt
                          workflow {
                            name
                          }
                        }
                      }
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
  mergeableCache: Map<string, MergeableStatus>;
}

function buildUserPullRequest(
  node: PullRequestSearchNode,
  role: UserPullRequest['role']
): UserPullRequest {
  const baseId = `${node.repository.owner.login}/${node.repository.name}`.toLowerCase();
  const headRepo = node.headRepository;
  const forkId = headRepo
    ? `${headRepo.owner.login}/${headRepo.name}`.toLowerCase()
    : null;

  return {
    nodeId: node.id,
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
    author: node.author?.login ?? '',
    role,
  };
}

export async function fetchUserPRs(
  token: string,
  onProgress?: (progress: PRFetchProgress) => void
): Promise<FetchUserPRsResult> {
  const octokit = createOctokit(token);
  const prs: UserPullRequest[] = [];
  const ciCache = new Map<string, CIInfo>();
  const reviewCache = new Map<string, ReviewInfo>();
  const mergeableCache = new Map<string, MergeableStatus>();

  const progress: PRFetchProgress = {
    phase: 'authenticating',
    totalPRs: 0,
    fetchedPRs: 0,
    currentRepo: '',
    failedRepos: [],
  };
  onProgress?.(progress);

  try {
    const tokenHash = hashKey(token);
    const userCacheKey = `user-${tokenHash}`;
    let username = await readCache<string>(userCacheKey);
    if (!username) {
      const { data: user } = await octokit.rest.users.getAuthenticated();
      username = user.login;
      writeCache(userCacheKey, username);
    }

    progress.phase = 'searching';
    onProgress?.(progress);

    const [authored, assigned] = await Promise.all([
      paginateSearch(octokit, `is:pr is:open author:${username}`),
      paginateSearch(octokit, `is:pr is:open assignee:${username}`),
    ]);
    progress.totalPRs = authored.totalCount + assigned.totalCount;
    onProgress?.(progress);

    // Merge and deduplicate by repo#number, tracking source query
    const authoredKeys = new Set<string>();
    const assignedKeys = new Set<string>();

    // Build key sets to determine role
    for (const node of authored.nodes) {
      if (node.__typename !== 'PullRequest') continue;
      const baseId = `${node.repository.owner.login}/${node.repository.name}`.toLowerCase();
      authoredKeys.add(`${baseId}#${node.number}`);
    }
    for (const node of assigned.nodes) {
      if (node.__typename !== 'PullRequest') continue;
      const baseId = `${node.repository.owner.login}/${node.repository.name}`.toLowerCase();
      assignedKeys.add(`${baseId}#${node.number}`);
    }

    const seen = new Set<string>();
    const allNodes = [...authored.nodes, ...assigned.nodes];

    for (const node of allNodes) {
      if (!node || node.__typename !== 'PullRequest') continue;
      const baseId = `${node.repository.owner.login}/${node.repository.name}`.toLowerCase();
      const prKey = `${baseId}#${node.number}`;

      if (seen.has(prKey)) continue;
      seen.add(prKey);

      const isAuthored = authoredKeys.has(prKey);
      const isAssigned = assignedKeys.has(prKey);

      prs.push(
        buildUserPullRequest(
          node,
          isAuthored && isAssigned ? 'both' : isAssigned ? 'assigned' : 'author'
        )
      );
    }

    progress.fetchedPRs = prs.length;
    progress.phase = 'done';
    onProgress?.(progress);

    const result = await mergeWithExistingPRCache(
      token,
      { prs, ciCache, reviewCache, mergeableCache }
    );
    writePRCache(token, result);
    return result;
  } catch (error) {
    throw new Error(`Failed to fetch PRs: ${describeApiError(error)}`, { cause: error });
  }
}

/**
 * Fetch all open PRs for a specific repo (not filtered by user).
 */
export async function fetchRepoPRs(
  token: string,
  repoFullName: string,
  onProgress?: (progress: PRFetchProgress) => void
): Promise<FetchUserPRsResult> {
  const octokit = createOctokit(token);
  const prs: UserPullRequest[] = [];
  const ciCache = new Map<string, CIInfo>();
  const reviewCache = new Map<string, ReviewInfo>();
  const mergeableCache = new Map<string, MergeableStatus>();

  const progress: PRFetchProgress = {
    phase: 'searching',
    totalPRs: 0,
    fetchedPRs: 0,
    currentRepo: repoFullName,
    failedRepos: [],
  };
  onProgress?.(progress);

  try {
    const result = await paginateSearch(octokit, `is:pr is:open repo:${repoFullName}`);
    progress.totalPRs = result.totalCount;
    onProgress?.(progress);

    for (const node of result.nodes) {
      if (node.__typename !== 'PullRequest') continue;
      prs.push(buildUserPullRequest(node, 'author'));
    }

    progress.fetchedPRs = prs.length;
    progress.phase = 'done';
    onProgress?.(progress);

    const refreshed = await mergeWithExistingPRCache(
      token,
      { prs, ciCache, reviewCache, mergeableCache },
      repoFullName
    );
    writePRCache(token, refreshed, repoFullName);
    return refreshed;
  } catch (error) {
    throw new Error(`Failed to fetch PRs for ${repoFullName}: ${describeApiError(error)}`, { cause: error });
  }
}

interface CachedPRsPayload {
  prs: UserPullRequest[];
  ciCache: Record<string, CIInfo>;
  reviewCache: Record<string, ReviewInfo>;
  mergeableCache: Record<string, MergeableStatus>;
}

export interface CachedPRsSnapshot {
  result: FetchUserPRsResult;
  ageMs: number;
  isStale: boolean;
}

const PR_CACHE_MAX_AGE = 60 * 60 * 1000; // 1 hour threshold for marking cached PR data as stale

function prCacheKey(token: string, repoFullName?: string): string {
  const tokenHash = hashKey(token);
  return repoFullName ? `prs-repo-${hashKey(repoFullName)}-${tokenHash}` : `prs-${tokenHash}`;
}

function writePRCache(token: string, result: FetchUserPRsResult, repoFullName?: string): void {
  writeCache(prCacheKey(token, repoFullName), {
    prs: result.prs,
    ciCache: Object.fromEntries(result.ciCache),
    reviewCache: Object.fromEntries(result.reviewCache),
    mergeableCache: Object.fromEntries(result.mergeableCache),
  } satisfies CachedPRsPayload);
}

function retainMapEntries<T>(
  map: ReadonlyMap<string, T>,
  keys: ReadonlySet<string>
): Map<string, T> {
  return new Map([...map.entries()].filter(([key]) => keys.has(key)));
}

export function mergeCachedPRData(
  incoming: FetchUserPRsResult,
  existing: FetchUserPRsResult | null
): FetchUserPRsResult {
  if (!existing) return incoming;

  const nextKeys = new Set(incoming.prs.map((pr) => `${pr.repoId}#${pr.number}`));
  return {
    prs: incoming.prs,
    ciCache: new Map([
      ...retainMapEntries(existing.ciCache, nextKeys),
      ...incoming.ciCache,
    ]),
    reviewCache: new Map([
      ...retainMapEntries(existing.reviewCache, nextKeys),
      ...incoming.reviewCache,
    ]),
    mergeableCache: new Map([
      ...retainMapEntries(existing.mergeableCache, nextKeys),
      ...incoming.mergeableCache,
    ]),
  };
}

async function mergeWithExistingPRCache(
  token: string,
  incoming: FetchUserPRsResult,
  repoFullName?: string
): Promise<FetchUserPRsResult> {
  const cachedSnapshot = await readCachedPRsSnapshot(token, repoFullName);
  return mergeCachedPRData(incoming, cachedSnapshot?.result ?? null);
}

export function persistPRCache(
  token: string,
  result: FetchUserPRsResult,
  repoFullName?: string
): void {
  writePRCache(token, result, repoFullName);
}

function fromCachedPRPayload(cached: CachedPRsPayload): FetchUserPRsResult {
  return {
    prs: cached.prs,
    ciCache: new Map(Object.entries(cached.ciCache)),
    reviewCache: new Map(Object.entries(cached.reviewCache)),
    mergeableCache: new Map(Object.entries(cached.mergeableCache)),
  };
}

export async function readCachedPRsSnapshot(
  token: string,
  repoFullName?: string
): Promise<CachedPRsSnapshot | null> {
  const cached = await readCacheEntry<CachedPRsPayload>(
    prCacheKey(token, repoFullName)
  );
  if (!cached) return null;

  const ageMs = Date.now() - cached.ts;
  return {
    result: fromCachedPRPayload(cached.data),
    ageMs,
    isStale: ageMs > PR_CACHE_MAX_AGE,
  };
}

/**
 * Read fresh cached PR results from disk. Returns null if missing or stale.
 */
export async function readCachedPRs(
  token: string,
  repoFullName?: string
): Promise<FetchUserPRsResult | null> {
  const snapshot = await readCachedPRsSnapshot(token, repoFullName);
  if (!snapshot || snapshot.isStale) return null;
  return snapshot.result;
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

function buildPRDetailsFromNode(
  pr: PullRequestDetailsNodeInput,
  pullNumber: number
): { ci: CIInfo; review: ReviewInfo; mergeable: MergeableStatus; body?: string } {
  const commitNode = (pr.commits.nodes ?? [])[0];
  const lastCommitDate = commitNode?.commit?.committedDate ?? '';
  const contextNodes =
    commitNode?.commit?.statusCheckRollup?.contexts?.nodes ?? [];

  const checks = extractChecksFromStatusContextNodes(
    contextNodes,
    pullNumber
  );

  const ci: CIInfo = {
    status: computeCIStatus(checks),
    checks,
    fetchedAt: Date.now(),
  };

  const reviewNodes: ReviewNodeInput[] = ((pr.reviews?.nodes) ?? [])
    .filter((n): n is NonNullable<typeof n> => n != null)
    .filter((n) => n.submittedAt != null && n.state != null)
    .map((n) => ({
      author: n.author?.login ? { login: n.author.login } : null,
      state: n.state!,
      submittedAt: n.submittedAt!,
    }));
  const review = computeReviewStatus(reviewNodes, lastCommitDate);
  const mergeable = (pr.mergeable ?? 'UNKNOWN') as MergeableStatus;

  const body = pr.body ?? undefined;

  return { ci, review, mergeable, body };
}

async function fetchPRDetailsWithOctokit(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<{ ci: CIInfo; review: ReviewInfo; mergeable: MergeableStatus }> {
  const result = await retryGitHubRequest(() =>
    execute(octokit, PR_DETAIL_QUERY, {
      owner,
      repo,
      number: pullNumber,
    })
  );

  const pr = result.repository?.pullRequest;
  if (!pr) throw new Error('PR not found');

  return buildPRDetailsFromNode(pr, pullNumber);
}

export async function fetchPRDetailsBatch(
  token: string,
  prs: readonly UserPullRequest[]
): Promise<Map<string, { ci: CIInfo; review: ReviewInfo; mergeable: MergeableStatus }>> {
  const octokit = createOctokit(token);
  const uniquePRs = [...new Map(prs.map((pr) => [pr.nodeId, pr])).values()];
  if (uniquePRs.length === 0) return new Map();

  const ids = uniquePRs.map((pr) => pr.nodeId);
  const result = await retryGitHubRequest(() =>
    execute(octokit, BATCH_PR_DETAILS_QUERY, { ids })
  );

  const prsByNodeId = new Map(uniquePRs.map((pr) => [pr.nodeId, pr]));
  const detailsByKey = new Map<
    string,
    { ci: CIInfo; review: ReviewInfo; mergeable: MergeableStatus; body?: string }
  >();

  for (const node of result.nodes ?? []) {
    if (!node || node.__typename !== 'PullRequest') continue;
    const pr = prsByNodeId.get(node.id);
    if (!pr) continue;
    const details = buildPRDetailsFromNode(node, pr.number);
    // body comes from the GraphQL node directly (gql.tada types it)
    details.body = node.body ?? undefined;
    detailsByKey.set(`${pr.repoId}#${pr.number}`, details);
  }

  return detailsByKey;
}

/**
 * Fetch CI checks + review status for a PR in a single GraphQL call.
 */
export async function fetchPRDetails(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<{ ci: CIInfo; review: ReviewInfo; mergeable: MergeableStatus }> {
  const octokit = createOctokit(token);
  return fetchPRDetailsWithOctokit(octokit, owner, repo, pullNumber);
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
  const cacheKey = `logs-${owner}-${repo}-${jobId}`;
  const cached = await readCache<string>(cacheKey);
  if (cached) return cached;

  const octokit = createOctokit(token);
  try {
    const response =
      await octokit.rest.actions.downloadJobLogsForWorkflowRun({
        owner,
        repo,
        job_id: jobId,
      });
    const logs =
      typeof response.data === 'string'
        ? response.data
        : String(response.data);
    writeCache(cacheKey, logs);
    return logs;
  } catch {
    return null;
  }
}

/**
 * Retry failed GitHub Actions jobs for a PR.
 * Re-runs each failed job individually.
 */
export async function retryFailedJobs(
  token: string,
  owner: string,
  repo: string,
  failedChecks: CheckRun[]
): Promise<void> {
  const octokit = createOctokit(token);
  await Promise.allSettled(
    failedChecks
      .filter((c) => c.id > 0)
      .map((c) =>
        octokit.rest.actions.reRunJobForWorkflowRun({
          owner,
          repo,
          job_id: c.id,
        })
      )
  );
}

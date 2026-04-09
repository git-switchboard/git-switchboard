import { hashKey, readCacheEntry, writeCache } from './cache.js';
import type {
  LinearIssue,
  LinearData,
  ProviderRateLimit,
} from './types.js';

// ─── Rate limit tracking ────────────────────────────────────────

export const linearRateLimit: { current: ProviderRateLimit | null } = {
  current: null,
};

function updateRateLimit(headers: Headers): void {
  const remaining = headers.get('x-ratelimit-requests-remaining');
  const limit = headers.get('x-ratelimit-requests-limit');
  const reset = headers.get('x-ratelimit-requests-reset');
  if (remaining && limit) {
    linearRateLimit.current = {
      provider: 'linear',
      remaining: Number(remaining),
      limit: Number(limit),
      used: Number(limit) - Number(remaining),
      resetAt: new Date(Number(reset ?? 0) * 1000),
    };
  }
}

// ─── GraphQL execution ──────────────────────────────────────────

async function linearGraphQL<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify({ query, variables }),
  });
  updateRateLimit(response.headers);
  if (!response.ok) {
    throw new Error(`Linear API returned ${response.status}`);
  }
  const result = (await response.json()) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (result.errors?.length) {
    throw new Error(result.errors[0].message);
  }
  if (!result.data) {
    throw new Error('No data in Linear response');
  }
  return result.data;
}

// ─── Queries ────────────────────────────────────────────────────

const TEAM_ISSUES_QUERY = `
  query TeamIssues($after: String) {
    viewer {
      teamMemberships {
        nodes {
          team {
            key
            issues(
              first: 100
              after: $after
              filter: { state: { type: { nin: ["completed", "canceled"] } } }
            ) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                identifier
                title
                state { name }
                priority
                assignee { name }
                url
              }
            }
          }
        }
      }
    }
  }
`;

interface TeamIssuesResponse {
  viewer: {
    teamMemberships: {
      nodes: {
        team: {
          key: string;
          issues: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: {
              id: string;
              identifier: string;
              title: string;
              state: { name: string };
              priority: number;
              assignee: { name: string } | null;
              url: string;
            }[];
          };
        };
      }[];
    };
  };
}

const ATTACHMENTS_QUERY = `
  query Attachments($after: String) {
    viewer {
      teamMemberships {
        nodes {
          team {
            issues(
              first: 100
              after: $after
              filter: { state: { type: { nin: ["completed", "canceled"] } } }
            ) {
              pageInfo { hasNextPage endCursor }
              nodes {
                identifier
                attachments {
                  nodes {
                    url
                    sourceType
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

interface AttachmentsResponse {
  viewer: {
    teamMemberships: {
      nodes: {
        team: {
          issues: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: {
              identifier: string;
              attachments: {
                nodes: {
                  url: string;
                  sourceType: string | null;
                }[];
              };
            }[];
          };
        };
      }[];
    };
  };
}

// ─── Fetch functions ────────────────────────────────────────────

async function fetchTeamIssues(
  token: string
): Promise<Map<string, LinearIssue>> {
  const issues = new Map<string, LinearIssue>();
  const data = await linearGraphQL<TeamIssuesResponse>(
    token,
    TEAM_ISSUES_QUERY
  );

  for (const membership of data.viewer.teamMemberships.nodes) {
    const team = membership.team;
    for (const node of team.issues.nodes) {
      issues.set(node.identifier, {
        id: node.id,
        identifier: node.identifier,
        title: node.title,
        status: node.state.name,
        priority: node.priority,
        assignee: node.assignee?.name ?? null,
        url: node.url,
        teamKey: team.key,
      });
    }
  }

  return issues;
}

async function fetchAttachments(
  token: string
): Promise<Map<string, string>> {
  const attachments = new Map<string, string>();
  const data = await linearGraphQL<AttachmentsResponse>(
    token,
    ATTACHMENTS_QUERY
  );

  for (const membership of data.viewer.teamMemberships.nodes) {
    for (const issue of membership.team.issues.nodes) {
      for (const att of issue.attachments.nodes) {
        // Match GitHub PR URLs
        if (att.url && /github\.com\/.*\/pull\/\d+/.test(att.url)) {
          attachments.set(att.url, issue.identifier);
        }
      }
    }
  }

  return attachments;
}

// ─── Caching ────────────────────────────────────────────────────

const LINEAR_CACHE_MAX_AGE = 60 * 60 * 1000; // 1 hour

// ─── Fetch issues by identifier ────────────────────────────────

const SEARCH_ISSUES_QUERY = `
  query SearchIssues($term: String!) {
    searchIssues(term: $term, first: 10) {
      nodes {
        id
        identifier
        title
        state { name }
        priority
        assignee { name }
        url
        team { key }
      }
    }
  }
`;

interface SearchIssuesResponse {
  searchIssues: {
    nodes: {
      id: string;
      identifier: string;
      title: string;
      state: { name: string };
      priority: number;
      assignee: { name: string } | null;
      url: string;
      team: { key: string };
    }[];
  };
}

export async function fetchIssuesByIdentifier(
  token: string,
  identifiers: string[]
): Promise<LinearIssue[]> {
  if (identifiers.length === 0) return [];

  // Search each identifier individually — Linear's searchIssues takes a single term
  // Batch them with Promise.allSettled to handle partial failures
  const results = await Promise.allSettled(
    identifiers.map(async (identifier) => {
      const data = await linearGraphQL<SearchIssuesResponse>(
        token,
        SEARCH_ISSUES_QUERY,
        { term: identifier }
      );
      // Filter to exact identifier match (search may return fuzzy results)
      return data.searchIssues.nodes
        .filter((node) => node.identifier === identifier)
        .map((node) => ({
          id: node.id,
          identifier: node.identifier,
          title: node.title,
          status: node.state.name,
          priority: node.priority,
          assignee: node.assignee?.name ?? null,
          url: node.url,
          teamKey: node.team.key,
        }));
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<LinearIssue[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value);
}

// ─── Caching ───────────────────────────────────────────────────

interface CachedLinearPayload {
  issues: Record<string, LinearIssue>;
  attachments: Record<string, string>;
}

export interface CachedLinearSnapshot {
  data: LinearData;
  ageMs: number;
  isStale: boolean;
}

function linearCacheKey(token: string): string {
  return `linear-${hashKey(token)}`;
}

export async function readCachedLinearSnapshot(
  token: string
): Promise<CachedLinearSnapshot | null> {
  const cached = await readCacheEntry<CachedLinearPayload>(
    linearCacheKey(token)
  );
  if (!cached) return null;

  const ageMs = Date.now() - cached.ts;
  return {
    data: {
      issues: new Map(Object.entries(cached.data.issues)),
      attachments: new Map(Object.entries(cached.data.attachments)),
    },
    ageMs,
    isStale: ageMs > LINEAR_CACHE_MAX_AGE,
  };
}

function writeLinearCache(token: string, data: LinearData): void {
  writeCache(linearCacheKey(token), {
    issues: Object.fromEntries(data.issues),
    attachments: Object.fromEntries(data.attachments),
  } satisfies CachedLinearPayload);
}

// ─── Public fetch (with caching) ────────────────────────────────

export async function fetchLinearData(
  token: string
): Promise<LinearData> {
  const [issues, attachments] = await Promise.all([
    fetchTeamIssues(token),
    fetchAttachments(token),
  ]);

  const data: LinearData = { issues, attachments };
  writeLinearCache(token, data);
  return data;
}

// ─── Issue matching ─────────────────────────────────────────────

/** Pattern for Linear issue identifiers in branch names / PR text */
const ISSUE_PATTERN = /\b([A-Z][A-Z0-9]+-\d+)\b/;

/** Extract the first Linear issue identifier from a string. */
export function parseLinearIssueId(text: string): string | null {
  const match = text.match(ISSUE_PATTERN);
  return match ? match[1] : null;
}

/**
 * Resolve a Linear issue for a branch/PR by trying:
 * 1. Branch name pattern match
 * 2. PR title/body pattern match (if provided)
 * 3. Attachment reverse lookup by PR URL (if provided)
 */
export function resolveLinearIssue(
  linearData: LinearData,
  branchName: string,
  prTitle?: string,
  prBody?: string,
  prUrl?: string
): LinearIssue | null {
  // 1. Branch name
  const branchId = parseLinearIssueId(branchName);
  if (branchId && linearData.issues.has(branchId)) {
    return linearData.issues.get(branchId)!;
  }

  // 2. PR title
  if (prTitle) {
    const titleId = parseLinearIssueId(prTitle);
    if (titleId && linearData.issues.has(titleId)) {
      return linearData.issues.get(titleId)!;
    }
  }

  // 3. PR body
  if (prBody) {
    const bodyId = parseLinearIssueId(prBody);
    if (bodyId && linearData.issues.has(bodyId)) {
      return linearData.issues.get(bodyId)!;
    }
  }

  // 4. Attachment reverse lookup
  if (prUrl) {
    const identifier = linearData.attachments.get(prUrl);
    if (identifier && linearData.issues.has(identifier)) {
      return linearData.issues.get(identifier)!;
    }
  }

  return null;
}

/**
 * Build a map of branch name → LinearIssue for all branches.
 * Used by the branch command for simple branch-name matching.
 */
export function matchBranchesToLinear(
  branchNames: string[],
  linearData: LinearData
): Map<string, LinearIssue> {
  const map = new Map<string, LinearIssue>();
  for (const name of branchNames) {
    const issue = resolveLinearIssue(linearData, name);
    if (issue) map.set(name, issue);
  }
  return map;
}

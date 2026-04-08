# Linear Enrichment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enrich branch and PR views with Linear ticket data parsed from branch names, PR bodies, and Linear attachments, with caching mirroring the existing GitHub pattern.

**Architecture:** A `linear.ts` module handles GraphQL queries, rate limit tracking, caching, and issue matching. Linear data flows into the existing Zustand store (PR command) or directly into BranchRouter props (branch command). A new `provider-status.tsx` modal shows rate limits for both providers.

**Tech Stack:** TypeScript, fetch API (Linear GraphQL), @opentui/react, Zustand

---

### Task 1: Types for Linear data

Add Linear-related types to the shared types file.

**Files:**
- Modify: `packages/git-switchboard/src/types.ts`

**Step 1: Add Linear types**

Append to the end of `packages/git-switchboard/src/types.ts`:

```typescript
// ─── Linear ─────────────────────────────────────────────────────

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: number;
  assignee: string | null;
  url: string;
  teamKey: string;
}

export interface LinearAttachment {
  issueId: string;
  issueIdentifier: string;
  url: string;
}

export interface LinearData {
  /** identifier → issue (e.g., "ENG-123" → LinearIssue) */
  issues: Map<string, LinearIssue>;
  /** GitHub PR URL → Linear issue identifier */
  attachments: Map<string, string>;
}

export interface ProviderRateLimit {
  provider: string;
  remaining: number;
  limit: number;
  used: number;
  resetAt: Date;
}
```

**Step 2: Verify typecheck**

Run: `cd packages/git-switchboard && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/git-switchboard/src/types.ts
git commit -m "feat: add Linear and rate limit types"
```

---

### Task 2: Linear API client (`linear.ts`)

Core module: GraphQL queries, rate limit tracking, caching, issue pattern matching.

**Files:**
- Create: `packages/git-switchboard/src/linear.ts`

**Step 1: Create the Linear client**

```typescript
import { hashKey, readCache, readCacheEntry, writeCache } from './cache.js';
import type {
  LinearIssue,
  LinearAttachment,
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
```

**Step 2: Verify typecheck**

Run: `cd packages/git-switchboard && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/git-switchboard/src/linear.ts
git commit -m "feat: add Linear API client with caching and issue matching"
```

---

### Task 3: Refactor GitHub rate limit to use shared type

Make the GitHub rate limit use the same `ProviderRateLimit` type so the provider status modal can display both uniformly.

**Files:**
- Modify: `packages/git-switchboard/src/github.ts:31-39`

**Step 1: Update rateLimit type**

In `packages/git-switchboard/src/github.ts`, replace the `RateLimitInfo` interface and `rateLimit` export (lines 31-39):

Change from:
```typescript
export interface RateLimitInfo {
  remaining: number;
  limit: number;
  used: number;
  resetAt: Date;
}

/** Shared mutable rate limit state, updated on every API response */
export const rateLimit: { current: RateLimitInfo | null } = { current: null };
```

To:
```typescript
import type { ProviderRateLimit } from './types.js';

/** Shared mutable rate limit state, updated on every API response */
export const rateLimit: { current: ProviderRateLimit | null } = { current: null };
```

Then update `createOctokit` (around line 44-59) to set `provider: 'github'` in the rate limit object:

Change the `rateLimit.current = {` assignment to include `provider: 'github'`:
```typescript
rateLimit.current = {
  provider: 'github',
  remaining: Number(remaining),
  limit: Number(limit),
  used: Number(used ?? 0),
  resetAt: new Date(Number(reset ?? 0) * 1000),
};
```

Remove the now-unused `RateLimitInfo` export. Find any files importing `RateLimitInfo` and update them — likely none since it was only used internally.

**Step 2: Verify typecheck**

Run: `cd packages/git-switchboard && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/git-switchboard/src/github.ts
git commit -m "refactor: use shared ProviderRateLimit type for GitHub rate limits"
```

---

### Task 4: Provider Status Modal (`provider-status.tsx`)

A modal overlay showing GitHub and Linear rate limits, accessible via `p` keybind.

**Files:**
- Create: `packages/git-switchboard/src/provider-status.tsx`

**Step 1: Create the provider status component**

```typescript
import { useKeyboard } from '@opentui/react';
import { rateLimit as githubRateLimit } from './github.js';
import { linearRateLimit } from './linear.js';
import { UP_ARROW, DOWN_ARROW } from './unicode.js';
import type { ProviderRateLimit } from './types.js';

function relativeReset(resetAt: Date): string {
  const ms = resetAt.getTime() - Date.now();
  if (ms <= 0) return 'now';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatLimit(rl: ProviderRateLimit | null, name: string): string {
  if (!rl) return `  ${name.padEnd(10)} no data`;
  return `  ${name.padEnd(10)} ${String(rl.used).padStart(5)}/${rl.limit} used   resets in ${relativeReset(rl.resetAt)}`;
}

export function ProviderStatusModal({
  width,
  height,
  onClose,
}: {
  width: number;
  height: number;
  onClose: () => void;
}) {
  useKeyboard((key) => {
    if (
      key.name === 'escape' ||
      key.raw === 'p' ||
      key.name === 'q'
    ) {
      onClose();
      return true;
    }
    return true; // consume all keys while modal is open
  });

  const modalWidth = Math.min(50, width - 4);
  const modalHeight = 7;

  return (
    <box
      style={{
        position: 'absolute',
        top: Math.floor(height / 2) - Math.floor(modalHeight / 2),
        left: Math.floor(width / 2) - Math.floor(modalWidth / 2),
        width: modalWidth,
        height: modalHeight,
      }}
    >
      <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
        <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
          <text content=" Provider Status" fg="#7aa2f7" />
        </box>
        <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
          <text content={'─'.repeat(modalWidth)} fg="#292e42" />
        </box>
        <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
          <text content={formatLimit(githubRateLimit.current, 'GitHub')} fg="#a9b1d6" />
        </box>
        <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
          <text content={formatLimit(linearRateLimit.current, 'Linear')} fg="#a9b1d6" />
        </box>
        <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
          <text content={'─'.repeat(modalWidth)} fg="#292e42" />
        </box>
        <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
          <text content=" [Esc] or [p] close" fg="#565f89" />
        </box>
      </box>
    </box>
  );
}
```

**Step 2: Verify typecheck**

Run: `cd packages/git-switchboard && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/git-switchboard/src/provider-status.tsx
git commit -m "feat: add provider status modal for rate limit display"
```

---

### Task 5: Integrate Linear data into Store

Add Linear cache to the Zustand store for the PR command. The store persists Linear data alongside CI/review caches.

**Files:**
- Modify: `packages/git-switchboard/src/store.ts`

**Step 1: Add Linear imports and state**

At the top of `store.ts`, add imports:
```typescript
import type { LinearIssue, LinearData } from './types.js';
```

Add to the `PrStore` interface (after line 41, after `mergeableCache`):
```typescript
linearCache: Record<string, LinearIssue>;
```

Add to `createPrStore`'s `initial` parameter (after `mergeableCache`):
```typescript
linearCache: Map<string, LinearIssue>;
```

In the store initialization (around line 332, after `mergeableCache`):
```typescript
linearCache: Object.fromEntries(initial.linearCache),
```

**Step 2: Include linear in cache persistence**

In `schedulePersistPRCache` (around line 158-175), the persist call needs to include linear data. However, `persistPRCacheImpl` currently only knows about CI/review/mergeable. Rather than changing that function's signature (it's in github.ts), we should persist Linear data separately via `writeCache` from cache.ts.

Add a new `schedulePersistLinearCache` closure alongside `schedulePersistPRCache`:

```typescript
let linearPersistQueued = false;
const schedulePersistLinearCache = () => {
  if (linearPersistQueued) return;
  linearPersistQueued = true;
  queueMicrotask(() => {
    linearPersistQueued = false;
    // Linear cache is read/written via linear.ts cache functions
    // It's already persisted on fetch — store just holds the in-memory copy
  });
};
```

Actually, since Linear data is fetched and cached by `linear.ts` directly (not per-PR like CI/review), the store just holds an in-memory copy for the views to read. No additional persistence logic needed in the store — `fetchLinearData` in `linear.ts` already calls `writeLinearCache`.

**Step 3: Add a `setLinearCache` action**

Add to the `PrStore` interface:
```typescript
setLinearCache: (cache: Record<string, LinearIssue>) => void;
```

Add to the store actions:
```typescript
setLinearCache: (cache) => set({ linearCache: cache }),
```

**Step 4: Verify typecheck**

Run: `cd packages/git-switchboard && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add packages/git-switchboard/src/store.ts
git commit -m "feat: add linearCache to Zustand store"
```

---

### Task 6: Branch view — conditional Linear column

Add the Linear column to the branch picker, only shown if any branch has a matched ticket.

**Files:**
- Modify: `packages/git-switchboard/src/app.tsx`
- Modify: `packages/git-switchboard/src/types.ts` (add `linearIssue` to `BranchWithPR`)

**Step 1: Extend BranchWithPR**

In `types.ts`, update `BranchWithPR` (line 84-86):

```typescript
export interface BranchWithPR extends BranchInfo {
  pr?: PullRequestInfo;
  linearIssue?: LinearIssue;
}
```

**Step 2: Update app.tsx**

Add import at top:
```typescript
import type { LinearIssue } from './types.js';
```

In the column width calculations (around line 159-164), add a conditional `linearCol`:

```typescript
const hasLinear = filteredBranches.some((b) => b.linearIssue);
const linearCol = hasLinear ? 12 : 0;
const branchCol = Math.max(12, width - prCol - authorCol - dateCol - linearCol - 7);
```

Update the column headers line (around line 198) to include Linear:

```typescript
content={`   ${fit('Branch', branchCol)} ${fit('Author', authorCol)} ${fit('Updated', dateCol)} ${hasLinear ? fit('Linear', linearCol) : ''}${fit('PR', prCol)}`}
```

In the branch row rendering (around line 229-241), add Linear text:

```typescript
const linearText = branch.linearIssue ? branch.linearIssue.identifier : (hasLinear ? '-' : '');

const line =
  marker +
  fit(branch.name, branchCol) +
  ' ' +
  fit(branch.author, authorCol) +
  ' ' +
  fit(branch.relativeDate, dateCol) +
  ' ' +
  (hasLinear ? fit(linearText, linearCol) : '') +
  fit(prText, prCol);
```

Also add Linear issue identifiers to the search filter in `filteredBranches` (around line 73-76):
```typescript
result = result.filter(
  (b) =>
    b.name.toLowerCase().includes(q) ||
    (b.linearIssue?.identifier.toLowerCase().includes(q) ?? false)
);
```

**Step 3: Verify typecheck**

Run: `cd packages/git-switchboard && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/git-switchboard/src/app.tsx packages/git-switchboard/src/types.ts
git commit -m "feat: add conditional Linear column to branch view"
```

---

### Task 7: PR list view — conditional Linear column

Add the Linear column to the PR list and integrate with search/sort.

**Files:**
- Modify: `packages/git-switchboard/src/pr-app.tsx`

**Step 1: Add Linear imports and column**

Add import:
```typescript
import type { LinearIssue } from './types.js';
```

Add `linearCache` to `PrAppProps` (around line 171):
```typescript
linearCache: Map<string, LinearIssue>;
```

Add `linearCache` to the destructured props.

**Step 2: Compute conditional column visibility**

After the `repoMatchMap` useMemo (around line 298), add:

```typescript
const hasLinear = useMemo(
  () => filteredPRs.some((pr) => linearCache.has(`${pr.repoId}#${pr.number}`)),
  [filteredPRs, linearCache]
);
```

**Step 3: Add column width**

In the column widths section (around line 510-521), add:

```typescript
const linearCol = hasLinear ? 12 : 0;
```

Adjust `prCol` to account for it:
```typescript
const prCol = Math.max(
  20,
  width - authorCol - roleCol - repoCol - updatedCol - ciCol - mergeCol - reviewCol - linearCol - 6
);
```

**Step 4: Add to search filter**

In `filteredPRs` useMemo (around line 239-249), add Linear to search:

```typescript
const linearIssue = linearCache.get(`${pr.repoId}#${pr.number}`);
return (
  pr.title.toLowerCase().includes(q) ||
  pr.repoId.includes(q) ||
  pr.headRef.toLowerCase().includes(q) ||
  pr.author.toLowerCase().includes(q) ||
  (linearIssue?.identifier.toLowerCase().includes(q) ?? false)
);
```

**Step 5: Add to column headers and row rendering**

In the column header text (around line 555), add Linear before Review:
```typescript
${hasLinear ? 'Linear'.padEnd(linearCol) : ''}
```

In the row rendering (around line 615-635), add Linear text before the review span:

```typescript
const linearIssue = linearCache.get(prKey);
const linearText = linearIssue ? linearIssue.identifier : (hasLinear ? '-' : '');
```

Add a span for it:
```typescript
{hasLinear && (
  <span fg={tableFocused ? '#bb9af7' : muteColor('#bb9af7')}>
    {linearText.slice(0, linearCol - 1).padEnd(linearCol)}
  </span>
)}
```

**Step 6: Verify typecheck**

Run: `cd packages/git-switchboard && npx tsc --noEmit`

**Step 7: Commit**

```bash
git add packages/git-switchboard/src/pr-app.tsx
git commit -m "feat: add conditional Linear column to PR list view"
```

---

### Task 8: PR detail view — Linear ticket section

Show Linear ticket info in the PR detail view.

**Files:**
- Modify: `packages/git-switchboard/src/pr-detail.tsx`

**Step 1: Add Linear props**

Add import:
```typescript
import type { LinearIssue } from './types.js';
```

Add to `PrDetailProps` (around line 119):
```typescript
linearIssue: LinearIssue | null;
```

Destructure it in the component.

**Step 2: Add Linear section after Reviews**

After the reviews section (around line 572, before the spacer), add:

```typescript
{/* Linear ticket */}
{linearIssue && (
  <>
    <box style={{ height: 1 }} />
    <box style={{ height: 1, width: '100%' }}>
      <text content={` Linear: ${linearIssue.identifier}`} fg="#bb9af7" />
    </box>
    <box style={{ height: 1, width: '100%' }}>
      <text content={`  ${linearIssue.title}`} fg="#c0caf5" />
    </box>
    <box style={{ height: 1, width: '100%' }}>
      <text
        content={`  Status: ${linearIssue.status}  |  Priority: ${linearIssue.priority}${linearIssue.assignee ? `  |  Assignee: ${linearIssue.assignee}` : ''}`}
        fg="#a9b1d6"
      />
    </box>
  </>
)}
```

**Step 3: Adjust chrome height calculation**

The `checkListHeight` calculation (around line 214) accounts for chrome rows. Add 3 rows when Linear is present (header + title + status):

```typescript
const linearRowCount = linearIssue ? 4 : 0; // spacer + header + title + status
const checkListHeight = Math.max(1, height - 13 - reviewRowCount - linearRowCount - footerHeight);
```

**Step 4: Verify typecheck**

Run: `cd packages/git-switchboard && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add packages/git-switchboard/src/pr-detail.tsx
git commit -m "feat: show Linear ticket details in PR detail view"
```

---

### Task 9: Wire `p` keybind and provider status into PR router

Add the `p` keybind to PR views and render the provider status modal as an overlay.

**Files:**
- Modify: `packages/git-switchboard/src/pr-router.tsx`
- Modify: `packages/git-switchboard/src/pr-app.tsx` (pass linearCache through from store)

**Step 1: Add `p` keybind to PR command views**

In `pr-router.tsx`, add the `providerStatus` keybind to both `pr-list` and `pr-detail` views in `PR_COMMAND`:

```typescript
providerStatus: {
  keys: ['p'],
  label: 'p',
  description: 'Provider status',
  terminal: '[p]roviders',
},
```

**Step 2: Add provider status modal state to PrRouter**

In `PrRouter` component (around line 418), add state:
```typescript
const [showProviderStatus, setShowProviderStatus] = useState(false);
```

Import `ProviderStatusModal`:
```typescript
import { ProviderStatusModal } from './provider-status.js';
```

**Step 3: Handle `p` keybind in PrRouter**

Add a `useKeyboard` handler in `PrRouter` that toggles the modal:
```typescript
useKeyboard((key) => {
  if (key.raw === 'p') {
    setShowProviderStatus((prev) => !prev);
    return true;
  }
  if (showProviderStatus) {
    return true; // consume all keys while modal is open (modal handles its own)
  }
});
```

Actually, the `ProviderStatusModal` component already handles all keys internally. Just toggle state on `p` in the PrRouter.

**Step 4: Render provider status as overlay**

Combine the editor modal and provider status into the overlay prop:

```typescript
const combinedOverlay = (
  <>
    {editorModalOverlay}
    {showProviderStatus && (
      <ProviderStatusModal
        width={width}
        height={height}
        onClose={() => setShowProviderStatus(false)}
      />
    )}
  </>
);
```

Pass `combinedOverlay` instead of `editorModalOverlay` to `TuiRouter`.

**Step 5: Pass linearCache from store to PrListScreen and PrDetailScreen**

In `PrListScreen` (around line 64-93), add:
```typescript
const linearCache = useStore(store, (s) => s.linearCache);
```

Convert to Map and pass to `PrApp`:
```typescript
const linearMap = useMemo(() => new Map(Object.entries(linearCache)), [linearCache]);
```
```typescript
<PrApp linearCache={linearMap} ... />
```

In `PrDetailScreen` (around line 96-134), add:
```typescript
const linearCache = useStore(store, (s) => s.linearCache);
const linearIssue = linearCache[prKey] ?? null;
```

Pass `linearIssue` to `PrDetail`:
```typescript
<PrDetail linearIssue={linearIssue} ... />
```

**Step 6: Remove old rate limit display from pr-detail.tsx footer**

In `pr-detail.tsx`, the footer currently shows `API: remaining/limit` (around line 202-209). Remove the `rateLimit` import and the `quota` parameter from `buildFooterRows`:

```typescript
// Before:
import { rateLimit } from './github.js';
// ...
const footerRows = buildFooterRows(footerKeyParts, width,
  rateLimit.current ? `API: ${rateLimit.current.remaining}/${rateLimit.current.limit}` : undefined);

// After:
const footerRows = buildFooterRows(footerKeyParts, width);
```

Do the same in `pr-app.tsx` (around line 307-312) — remove the quota display from the footer since it's now in the modal.

**Step 7: Verify typecheck**

Run: `cd packages/git-switchboard && npx tsc --noEmit`

**Step 8: Commit**

```bash
git add packages/git-switchboard/src/pr-router.tsx packages/git-switchboard/src/pr-app.tsx packages/git-switchboard/src/pr-detail.tsx
git commit -m "feat: wire provider status modal and Linear data into PR views"
```

---

### Task 10: Wire `p` keybind into Branch router

**Files:**
- Modify: `packages/git-switchboard/src/branch-router.tsx`
- Modify: `packages/git-switchboard/src/app.tsx`

**Step 1: Add providerStatus keybind to BRANCH_COMMAND**

In `branch-router.tsx`, add to the `branch-picker` view's keybinds:

```typescript
providerStatus: {
  keys: ['p'],
  label: 'p',
  description: 'Provider status',
  terminal: '[p]roviders',
},
```

**Step 2: Add modal state and overlay to BranchRouter**

In `BranchRouter` component, add state and render with overlay:

```typescript
import { useState } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import { ProviderStatusModal } from './provider-status.js';

export function BranchRouter(props: BranchRouterProps) {
  const [showProviderStatus, setShowProviderStatus] = useState(false);
  const { width, height } = useTerminalDimensions();

  const overlay = showProviderStatus ? (
    <ProviderStatusModal
      width={width}
      height={height}
      onClose={() => setShowProviderStatus(false)}
    />
  ) : undefined;

  return (
    <BranchCtx.Provider value={props}>
      <TuiRouter<BranchScreen>
        views={BRANCH_COMMAND.views}
        initialScreen={{ type: 'branch-picker' }}
        overlay={overlay}
      />
    </BranchCtx.Provider>
  );
}
```

**Step 3: Handle `p` in app.tsx keybinds**

In `app.tsx`, add a `providerStatus` handler in `useKeybinds`:
```typescript
providerStatus: () => {
  // Handled by BranchRouter overlay — the keybind just needs to exist
  // so it shows in the footer. The actual toggle is via the overlay's
  // onClose callback, but we need to trigger it somehow.
},
```

Actually, since the `p` key is consumed by `useKeybinds` in `app.tsx`, it won't bubble to the router. Instead, pass an `onProviderStatus` callback from `BranchRouter` through the context:

Add `onProviderStatus: () => void` to `BranchRouterProps`.

In `BranchRouter`:
```typescript
<BranchCtx.Provider value={{ ...props, onProviderStatus: () => setShowProviderStatus(true) }}>
```

In `app.tsx` keybinds:
```typescript
providerStatus: () => onProviderStatus(),
```

Add `onProviderStatus` to `AppProps` and destructure it.

**Step 4: Verify typecheck**

Run: `cd packages/git-switchboard && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add packages/git-switchboard/src/branch-router.tsx packages/git-switchboard/src/app.tsx
git commit -m "feat: wire provider status modal into branch view"
```

---

### Task 11: Wire Linear data fetching into CLI

Connect everything in `cli.ts`: resolve Linear token, fetch data, pass to views.

**Files:**
- Modify: `packages/git-switchboard/src/cli.ts`

**Step 1: Update PR command handler**

In the PR command handler (around lines 68-280), after the GitHub token resolution, add Linear token resolution and parallel fetch:

After the existing `resolveGitHubToken` import (around line 83), add:
```typescript
const { resolveToken } = await import('./token-store.js');
const { LINEAR_PROVIDER } = await import('./providers.js');
const { fetchLinearData, readCachedLinearSnapshot, resolveLinearIssue } = await import('./linear.js');
```

After the GitHub token check (around line 99), resolve Linear token:
```typescript
const linearToken = await resolveToken(LINEAR_PROVIDER);
```

After `scanPromise` is created (around line 151), start Linear fetch in parallel:
```typescript
const linearPromise = linearToken
  ? (async () => {
      const cached = await readCachedLinearSnapshot(linearToken);
      if (cached && !cached.isStale) return cached.data;
      return fetchLinearData(linearToken).catch(() => cached?.data ?? null);
    })()
  : Promise.resolve(null);
```

Before `createPrStore` (around line 217), await Linear data and build the cache:
```typescript
const linearData = await linearPromise;
const linearCache = new Map<string, import('./types.js').LinearIssue>();
if (linearData) {
  for (const pr of prs) {
    const issue = resolveLinearIssue(
      linearData,
      pr.headRef,
      pr.title,
      undefined, // body not available in list query
      pr.url
    );
    if (issue) linearCache.set(`${pr.repoId}#${pr.number}`, issue);
  }
}
```

Add `linearCache` to the `createPrStore` call:
```typescript
const store = createPrStore({
  ...existing params...,
  linearCache,
});
```

**Step 2: Update branch command handler**

In the default command handler (around lines 349-414), after the `resolveGitHubToken` import, add:

```typescript
const { resolveToken } = await import('./token-store.js');
const { LINEAR_PROVIDER } = await import('./providers.js');
const { fetchLinearData, readCachedLinearSnapshot, matchBranchesToLinear } = await import('./linear.js');
```

After the branch enrichment with PRs (around line 391), add Linear enrichment:
```typescript
// Enrich with Linear data if possible
const linearToken = await resolveToken(LINEAR_PROVIDER);
if (linearToken) {
  try {
    const cached = await readCachedLinearSnapshot(linearToken);
    const linearData = cached && !cached.isStale
      ? cached.data
      : await fetchLinearData(linearToken).catch(() => cached?.data ?? null);
    if (linearData) {
      const linearMap = matchBranchesToLinear(
        branches.map((b) => b.name),
        linearData
      );
      branches = branches.map((b) => ({
        ...b,
        linearIssue: linearMap.get(b.name),
      }));
    }
  } catch {
    // Linear enrichment is optional — don't block on failure
  }
}
```

**Step 3: Verify typecheck**

Run: `cd packages/git-switchboard && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/git-switchboard/src/cli.ts
git commit -m "feat: wire Linear data fetching into both commands"
```

---

### Task 12: Typecheck, smoke test, and final cleanup

**Step 1: Full typecheck**

Run: `cd packages/git-switchboard && npx tsc --noEmit`
Fix any remaining errors.

**Step 2: Smoke test connect command**

Run: `cd packages/git-switchboard && bun run src/cli.ts connect`
Verify both providers appear.

**Step 3: Smoke test branch command**

Run: `cd packages/git-switchboard && bun run src/cli.ts`
Verify it boots without errors (Linear column won't show unless Linear token is configured and branches match).

**Step 4: Smoke test help output**

Run: `cd packages/git-switchboard && bun run src/cli.ts --help`
Verify no regressions.

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during smoke testing"
```

---

## Summary

| Task | Component | Files |
|------|-----------|-------|
| 1 | Linear types | `types.ts` |
| 2 | Linear API client | `linear.ts` (new) |
| 3 | Shared rate limit type | `github.ts` |
| 4 | Provider status modal | `provider-status.tsx` (new) |
| 5 | Store integration | `store.ts` |
| 6 | Branch view Linear column | `app.tsx`, `types.ts` |
| 7 | PR list Linear column | `pr-app.tsx` |
| 8 | PR detail Linear section | `pr-detail.tsx` |
| 9 | PR router wiring | `pr-router.tsx`, `pr-app.tsx`, `pr-detail.tsx` |
| 10 | Branch router wiring | `branch-router.tsx`, `app.tsx` |
| 11 | CLI data fetching | `cli.ts` |
| 12 | Final testing | — |

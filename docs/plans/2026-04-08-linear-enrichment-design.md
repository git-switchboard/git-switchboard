# Linear Enrichment Design

**Date**: 2026-04-08
**Status**: Approved

## Overview

Enrich branch and PR views with Linear ticket data. Parse ticket identifiers from branch names and PR bodies, fetch issue metadata from Linear's GraphQL API, and resolve manually linked PRs via Linear attachments. Add a unified provider rate limit modal accessible via `p` keybind.

## Linear Data Model

```typescript
interface LinearIssue {
  id: string;
  identifier: string;      // "ENG-123"
  title: string;
  status: string;           // "In Progress", "Done", etc.
  priority: number;         // 0=none, 1=urgent, 2=high, 3=medium, 4=low
  assignee: string | null;  // display name
  url: string;
  teamKey: string;          // "ENG"
}

interface LinearAttachment {
  issueId: string;
  url: string;              // GitHub PR URL
}
```

## Fetching Strategy

### Two queries on boot (when Linear token resolves):

1. **Team issues query** — all open issues across the user's teams. Gives the full `identifier → issue` map for matching against branch names / PR bodies.

2. **Attachments query** — GitHub PR URL attachments for those issues. Gives the reverse lookup: "Linear ticket X is linked to GitHub PR Y".

### Caching

Identical to GitHub PR data:
- Disk cache with 1-hour TTL
- Stale-while-revalidate: show cached instantly, refresh in background
- Cache key: `linear-${hashKey(linearToken)}`
- Included in Zustand store persistence (same `schedulePersistPRCache` pattern)

### Matching Chain (per branch/PR)

1. Parse branch name for `[A-Z]+-\d+` → lookup in issue map
2. Parse PR title/body for same pattern (PR view only)
3. Check attachments map: does any Linear issue link to this PR's GitHub URL? (reverse lookup)

First match wins. Multiple matches possible (e.g., branch name + PR body reference different tickets) — take the first/primary one from branch name, fall back to body, fall back to attachment.

## View Changes

### Branch View (`app.tsx`)

- New conditional column `Linear` after `PR` column
- Only shown if any branch in the current filtered list has a matched ticket
- Displays ticket identifier (e.g., `ENG-123`), ~12 chars wide
- Shows `-` if no match for that branch

### PR List View (`pr-app.tsx`)

- New conditional column `Linear` — same conditional hide logic
- Shows identifier in list row
- Searchable: typing `ENG-123` in search matches PRs with that ticket
- Sortable: add `linear` to sort fields

### PR Detail View (`pr-detail.tsx`)

- If PR has a linked Linear ticket, show section with: identifier, title, status, priority, assignee
- Keybind to open Linear issue URL in browser (reuse existing `openInBrowser`)

### Provider Status Modal (new component)

- Accessible via `p` keybind from both branch and PR views
- Modal overlay (like existing sort modal), not a full screen
- Shows GitHub + Linear API rate limits:
  ```
  Provider Status

    GitHub    1847/5000 used  resets in 42m
    Linear     18/1500 used   resets in 58m
  ```
- Press `Esc` or `p` to close

## Linear Rate Limit Tracking

Linear returns these headers:
- `X-RateLimit-Requests-Remaining`
- `X-RateLimit-Requests-Limit`
- `X-RateLimit-Requests-Reset`

Store in a module-level mutable object (same pattern as `rateLimit` in `github.ts`).

## Data Flow

### Boot Sequence (both commands)

```
1. resolveToken(LINEAR_PROVIDER) — async, non-blocking
2. If token resolves, fetchLinearData(token) in parallel with GitHub fetches
3. Pass Linear data into TUI components
```

### Branch Command

```
resolveToken(LINEAR_PROVIDER)
  → fetchLinearData(token)  // issues + attachments, cached
  → match branches by name pattern
  → pass linearMap: Map<branchName, LinearIssue> into BranchRouter
```

### PR Command

```
resolveToken(LINEAR_PROVIDER)
  → fetchLinearData(token)  // same fetch, same cache
  → match PRs by: headRef pattern + title/body pattern + attachment reverse lookup
  → linearCache added to Zustand store (alongside ciCache, reviewCache)
  → background refresh same as GitHub data
```

### Store Changes (`store.ts`)

- `linearCache: Record<string, LinearIssue>` keyed by `repoId#number`
- `linearAttachments: Map<string, string>` — GitHub PR URL → Linear issue identifier
- Included in disk cache persistence
- Background refresh follows stale-while-revalidate

## File Changes

### New Files

| File | Purpose |
|---|---|
| `linear.ts` | Linear GraphQL client, fetch functions, rate limit tracking, issue matching |
| `provider-status.tsx` | Provider rate limit modal component |

### Modified Files

| File | Change |
|---|---|
| `types.ts` | Add `LinearIssue`, `LinearAttachment`, `LinearRateLimit` types |
| `store.ts` | Add linearCache, linearAttachments to store + persistence |
| `app.tsx` | Conditional Linear column in branch list |
| `pr-app.tsx` | Conditional Linear column + search + sort + `p` keybind |
| `pr-detail.tsx` | Linear ticket detail section |
| `pr-router.tsx` | Provider status overlay, `p` keybind |
| `branch-router.tsx` | `p` keybind for provider status |
| `cli.ts` | Linear token resolution + parallel fetch + pass to TUI |

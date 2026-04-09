# Reactive Data Layer Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the reactive data layer into the PR command flow, replacing the manual cache management in store.ts and cli.ts with the event-driven DataLayer.

**Architecture:** The Zustand store becomes a thin UI layer. DataLayer owns all entity data and relations. The store subscribes to DataLayer events to trigger React re-renders. PR entities carry their own enrichment data (ci, review, mergeable) — no more separate cache maps.

**Tech Stack:** Same as data layer — TypeScript, Bun, Zustand 5, existing API modules.

**Design doc:** `docs/plans/2026-04-08-reactive-data-layer-design.md`

---

### Task 1: Rewrite store.ts as thin UI layer

The store drops all cache state and the internal batch queue system. It takes DataLayer as a dependency and subscribes to events for reactivity.

**Files:**
- Modify: `packages/git-switchboard/src/store.ts`
- Modify: `packages/git-switchboard/src/store.test.ts`

**What changes:**

Remove from PrStore interface:
- `ciCache`, `reviewCache`, `mergeableCache`, `linearCache` (data lives in DataLayer)
- `fetchDetailsForPR`, `prefetchDetailsForPRs` (replaced by bus events)
- `refreshPRs` (replaced by bus events)
- `setLinearCache` (data flows through ingestion)
- The entire closure-based batch queue system (~170 lines)

Keep in PrStore:
- `prs: UserPullRequest[]` — snapshot from DataLayer, updated on events
- `localRepos`, `repoScanDone`, `setLocalRepos`, `waitForLocalRepos`
- `watchedPRs`, `toggleWatch`
- `ciLoading`, `refreshing`, `statusText`, `showStatus`, `clearStatus`
- `repoMode`, `token`, `editor`, `installedEditors`, `setEditor`
- `copyToClipboard`, `onDone`, `openEditorForPR`
- `openInBrowser`
- `refreshCI` — now emits `pr:fetchDetail` via bus
- `retryChecks`, `retryCheck`, `copyLogs` — these still call GitHub API directly (they're actions, not data flow)
- `refreshAllPRs` — refetches PR list and re-ingests

Add to PrStore:
- `dataLayer: DataLayer` — reference to the data layer
- `prefetchDetails(prs: UserPullRequest[]): void` — emits `pr:fetchDetail` for each

**New createPrStore signature:**

```typescript
createPrStore(initial: {
  dataLayer: DataLayer;
  localRepos: LocalRepo[];
  repoScanDone: boolean;
  repoMode: string | null;
  token: string;
  copyToClipboard: (text: string) => Promise<boolean>;
  onDone: (result: PrRouterResult | null) => void;
  openEditorForPR: (pr: UserPullRequest, repo: LocalRepo, skipCheckout: boolean) => Promise<string>;
  waitForLocalRepos: () => Promise<LocalRepo[]>;
  editor: ResolvedEditor | null;
  installedEditors: EditorInfo[];
}, deps?: Partial<PrStoreDeps>)
```

**Event subscriptions (in createPrStore):**

```typescript
// Subscribe to DataLayer events that should trigger re-renders
const unsubs: (() => void)[] = [];

// When PRs change, re-snapshot from DataLayer
const refreshPrSnapshot = () => {
  set({ prs: dataLayer.stores.prs.getAll() });
};
unsubs.push(dataLayer.bus.on('pr:discovered', refreshPrSnapshot));
unsubs.push(dataLayer.bus.on('pr:enriched', refreshPrSnapshot));
```

**refreshAllPRs rewrite:**

```typescript
refreshAllPRs: async () => {
  const { token, repoMode } = get();
  set({ refreshing: true });
  try {
    const result = repoMode
      ? await fetchRepoPRsImpl(token, repoMode)
      : await fetchUserPRsImpl(token);
    
    // Re-ingest through DataLayer — events cascade automatically
    const prsWithEnrichment = result.prs.map(pr => {
      const key = `${pr.repoId}#${pr.number}`;
      return {
        ...pr,
        ci: result.ciCache.get(key),
        review: result.reviewCache.get(key),
        mergeable: result.mergeableCache.get(key),
      };
    });
    dataLayer.ingest.ingestPRs(prsWithEnrichment);
    set({ refreshing: false });
  } catch {
    set({ refreshing: false });
  }
},
```

**refreshCI rewrite:**

```typescript
refreshCI: async (pr) => {
  set({ ciLoading: true });
  try {
    const { token } = get();
    const { ci, review, mergeable } = await fetchPRDetailsImpl(
      token, pr.repoOwner, pr.repoName, pr.number
    );
    dataLayer.ingest.ingestPRs([{ ...pr, ci, review, mergeable }]);
  } finally {
    set({ ciLoading: false });
  }
},
```

**prefetchDetails:**

```typescript
prefetchDetails: (prs) => {
  for (const pr of prs) {
    dataLayer.bus.emit('pr:fetchDetail', {
      repoId: pr.repoId,
      number: pr.number,
    });
  }
},
```

**Update store.test.ts:**

Rewrite tests to work with the new store shape. Tests should:
- Create a DataLayer via `createDataLayer()`
- Ingest initial data
- Create store with the DataLayer
- Verify store reflects DataLayer state
- Test that DataLayer events trigger store updates

**Step 1:** Rewrite `store.ts` with the new shape
**Step 2:** Rewrite `store.test.ts`
**Step 3:** Run `bun test src/store.test.ts` — verify passes
**Step 4:** Run `npx tsc --noEmit` — expect type errors in UI components (that's expected, we fix those next)
**Step 5:** Commit

```bash
git commit -m "feat: rewrite store as thin UI layer on DataLayer"
```

---

### Task 2: Update pr-router.tsx — Add DataLayer context

**Files:**
- Modify: `packages/git-switchboard/src/pr-router.tsx`

**What changes:**

Add a DataLayer context alongside the existing PrStoreCtx:

```typescript
import type { DataLayer } from './data/index.js';

const DataLayerCtx = createContext<DataLayer | null>(null);

export function useDataLayer(): DataLayer {
  const ctx = useContext(DataLayerCtx);
  if (!ctx) throw new Error('useDataLayer must be used inside PrRouter');
  return ctx;
}
```

Update PrRouter props:

```typescript
interface PrRouterProps {
  store: PrStoreApi;
  dataLayer: DataLayer;
}
```

Wrap the tree with DataLayerCtx.Provider:

```typescript
<DataLayerCtx.Provider value={dataLayer}>
  <PrStoreCtx.Provider value={store}>
    ...existing tree...
  </PrStoreCtx.Provider>
</DataLayerCtx.Provider>
```

**Update PrListScreen:**

Replace cache reads with DataLayer reads. The store's `prs` now contains `PR` entities with `ci`, `review`, `mergeable` embedded.

```typescript
// Before:
const ciCache = useStore(store, (s) => s.ciCache);
const reviewCache = useStore(store, (s) => s.reviewCache);
const mergeableCache = useStore(store, (s) => s.mergeableCache);
const linearCache = useStore(store, (s) => s.linearCache);

// After: Remove these. PrApp receives prs directly and reads pr.ci, etc.
```

Pass DataLayer's query API for Linear lookups.

**Update PrDetailScreen:**

```typescript
// Before:
const ci = ciCache[prKey] ?? null;
const review = reviewCache[prKey] ?? null;
const linearIssue = linearCache[prKey] ?? null;

// After:
const dataLayer = useDataLayer();
const prEntity = dataLayer.stores.prs.get(prKey);
const ci = prEntity?.ci ?? null;
const review = prEntity?.review ?? null;
const linearIssues = dataLayer.query.linearIssuesForPr(prKey);
const linearIssue = linearIssues[0] ?? null;
```

**Step 1:** Add DataLayer context and update PrRouter
**Step 2:** Update PrListScreen and PrDetailScreen
**Step 3:** Commit

```bash
git commit -m "feat: add DataLayer context to PrRouter, update screens"
```

---

### Task 3: Update pr-app.tsx — Remove cache props

**Files:**
- Modify: `packages/git-switchboard/src/pr-app.tsx`

**What changes:**

Update PrAppProps — remove cache map props. PRs now carry their own enrichment data:

```typescript
interface PrAppProps {
  prs: UserPullRequest[];     // These now have ci/review/mergeable on them
  localRepos: LocalRepo[];
  repoMode: string | null;
  refreshing: boolean;
  dataLayer: DataLayer;       // For Linear queries
  onFetchCI: (pr: UserPullRequest) => Promise<void>;
  onPrefetchDetails: (prs: UserPullRequest[]) => void;
  onRetryChecks: (pr: UserPullRequest) => Promise<string>;
  onRefreshAll: (prs: UserPullRequest[]) => Promise<void>;
  onExit: () => void;
}
```

Update data access patterns throughout:

```typescript
// Before:
const ci = ciMap.get(key);
const review = reviewMap.get(key);
const mergeable = mergeableCache[key];
const linear = linearMap.get(key);

// After:
const ci = pr.ci;
const review = pr.review;
const mergeable = pr.mergeable;
const linear = dataLayer.query.linearIssuesForPr(key)[0];
```

Remove the Map conversion logic (ciMap, reviewMap, linearMap useMemo).

**Step 1:** Update props and data access
**Step 2:** Remove cache-to-Map conversion code
**Step 3:** Commit

```bash
git commit -m "feat: update PrApp to read enrichment from PR entities"
```

---

### Task 4: Update pr-detail.tsx — Type adjustments

**Files:**
- Modify: `packages/git-switchboard/src/pr-detail.tsx`

**What changes:**

Minimal — this component already receives individual `ci`, `review`, `linearIssue` as props. The types might need adjustment (import `CIInfo` etc. from the right place), but the component logic stays the same.

Verify the prop types match what PrDetailScreen now passes.

**Step 1:** Update imports if needed
**Step 2:** Verify types compile
**Step 3:** Commit if changes needed

```bash
git commit -m "fix: update PrDetail types for DataLayer integration"
```

---

### Task 5: Update cli.ts — Wire DataLayer into PR command

**Files:**
- Modify: `packages/git-switchboard/src/cli.ts`

**What changes:**

Replace manual cache building with DataLayer creation and ingestion:

```typescript
// Import data layer
const { createDataLayer } = await import('./data/index.js');
const { createGithubFetcher } = await import('./data/fetchers/github.js');
const { createLinearFetcher } = await import('./data/fetchers/linear.js');

// Create DataLayer with cache dir
const { cacheDir } = await import('./cache.js');
const dataLayer = createDataLayer({ cacheDir: cacheDir() });

// Hydrate from disk cache
await dataLayer.hydrate();

// Register fetch listeners
const cleanupGithub = createGithubFetcher(
  dataLayer.bus, dataLayer.ingest, dataLayer.stores,
  { fetchPRDetailsBatch: (prs) => fetchPRDetailsBatch(token, prs) }
);
if (linearToken) {
  createLinearFetcher(dataLayer.bus, dataLayer.ingest, {
    fetchIssuesByIdentifier: async (ids) => {
      // Fetch from Linear API by identifiers
      const data = await fetchLinearData(linearToken);
      return ids.map(id => data.issues.get(id)).filter(Boolean);
    }
  });
}

// After fetching PRs, ingest them
const prsWithEnrichment = prResult.prs.map(pr => {
  const key = `${pr.repoId}#${pr.number}`;
  return {
    ...pr,
    ci: prResult.ciCache.get(key),
    review: prResult.reviewCache.get(key),
    mergeable: prResult.mergeableCache.get(key),
  };
});
dataLayer.ingest.ingestPRs(prsWithEnrichment);

// Ingest Linear data
if (linearData) {
  dataLayer.ingest.ingestLinearData({
    issues: [...linearData.issues.values()],
    attachments: [...linearData.attachments.entries()].map(
      ([prUrl, issueId]) => ({ prUrl, issueIdentifier: issueId })
    ),
  });
}

// Ingest scanned repos as checkouts
if (initialLocalRepos.length > 0) {
  dataLayer.ingest.ingestCheckouts(initialLocalRepos.map(repo => ({
    path: repo.path,
    remoteUrl: repo.remoteUrl ?? null,
    repoId: repo.repoId ?? null,
    currentBranch: repo.currentBranch ?? '',
    isWorktree: repo.isWorktree,
    parentCheckoutKey: null, // TODO: resolve from worktree info
  })));
}

// Create store with DataLayer
const store = createPrStore({
  dataLayer,
  localRepos: initialLocalRepos,
  repoScanDone: scanDone,
  repoMode,
  token,
  copyToClipboard,
  editor,
  installedEditors,
  waitForLocalRepos: () => scanPromise,
  onDone: (result) => { ... },
  openEditorForPR: async (pr, repo, skipCheckout) => { ... },
});

// Pass DataLayer to PrRouter
root.render(createElement(PrRouter, { store, dataLayer }));
```

Remove: manual ciCache/reviewCache/mergeableCache/linearCache building.

**Step 1:** Wire DataLayer creation and hydration
**Step 2:** Replace manual cache with ingestion
**Step 3:** Update store creation call
**Step 4:** Pass dataLayer to PrRouter
**Step 5:** Commit

```bash
git commit -m "feat: wire DataLayer into CLI PR command startup"
```

---

### Task 6: Verify full flow compiles and tests pass

**Step 1:** Run `npx tsc --noEmit` — fix any remaining type errors
**Step 2:** Run `bun test` — fix any test failures
**Step 3:** Commit fixes

```bash
git commit -m "fix: resolve type and test issues from DataLayer integration"
```

---

### Notes for Implementer

**Type compatibility:** `UserPullRequest` from `types.ts` and `PR` from `data/entities.ts` are structurally compatible — `PR` is `UserPullRequest` plus optional `ci`, `review`, `mergeable` fields. Components can accept either. Consider having `PR` extend `UserPullRequest` or adding a type alias.

**Watch polling:** The 30s watch polling in `pr-router.tsx` currently calls `refreshPRs()`. This should be changed to emit `pr:fetchDetail` events for watched PRs, or call `refreshCI()` which re-ingests.

**Persistence scheduling:** The old store's `schedulePersistPRCache` microtask pattern is replaced by the DataLayer's persistence subscriber. Wire a `dataLayer.persist()` call on a similar schedule, or have the persistence layer auto-persist on data events.

**Branch mode:** `app.tsx` and `branch-router.tsx` are NOT changed in this plan. They still use the old data flow. This is intentional — migrate them as a separate follow-up.

# Reactive Data Layer Design

## Overview

Rework the data flow for Linear and GitHub integrations into an event-driven, progressively-enriching reactive data layer. Zustand sits on top as a thin UI-state layer for filtered views, selection, and loading indicators.

## Architecture Layers

```
┌─────────────────────────────────────────────────┐
│  Zustand (UI state)                             │
│  - Selection, filters, sort, search, loading    │
│  - Subscribes to data events, recomputes views  │
└──────────────────┬──────────────────────────────┘
                   │ subscribes to events
┌──────────────────▼──────────────────────────────┐
│  Data Layer (plain TypeScript)                  │
│  - Event bus                                    │
│  - Entity stores (Maps)                         │
│  - Relation maps (bidirectional)                │
│  - Ingestion functions                          │
│  - Discovery effects                            │
│  - Relation effects                             │
│  - Fetch listeners                              │
│  - Persistence subscriber                       │
└─────────────────────────────────────────────────┘
```

## Module Structure

```
packages/git-switchboard/src/data/
  event-bus.ts        — Typed EventBus<EventMap> class
  events.ts           — EventMap type definition (all events + payloads)
  entities.ts         — Entity types (PR, LinearIssue, Branch, LocalCheckout)
  entity-store.ts     — Generic EntityStore<K, V> wrapper around Map
  relations.ts        — Relation maps + link() helper + query utilities
  effects.ts          — Effect registrations (discovery + relation effects)
  fetchers/
    github.ts         — Fetch listener for pr:fetch, pr:fetchDetail
    linear.ts         — Fetch listener for linear:issue:fetch
    branches.ts       — Fetch listener for branch:fetch
    checkouts.ts      — Fetch listener for checkout:scan
  ingest.ts           — ingestPRs, ingestLinearData, ingestBranches, ingestCheckouts
  persistence.ts      — Subscriber that writes to disk + hydrate() for startup
  index.ts            — Creates instances, wires everything up, exports public API
```

Existing API modules (`github.ts`, `linear.ts`, `scanner.ts`, `git.ts`) at the package root stay as pure data-fetching functions. The `data/fetchers/` modules are thin listeners that call those and funnel results through ingestion.

## Event Bus

A typed event emitter. ~50-60 lines. No framework dependencies.

```typescript
class EventBus<TEventMap> {
  on<K extends keyof TEventMap>(event: K, handler: (payload: TEventMap[K]) => void): () => void
  off<K extends keyof TEventMap>(event: K, handler: (payload: TEventMap[K]) => void): void
  emit<K extends keyof TEventMap>(event: K, payload: TEventMap[K]): void
}

function createEventBus<T extends EventMap>(): EventBus<T>
```

- Returns unsubscribe function from `on()`
- Handlers are synchronous — async work kicks off and results come back through ingestion
- No wildcard matching
- Singleton created in `index.ts`, not at module level

## Event Map

Two categories: **data events** (what happened) and **command events** (please do this).

```typescript
interface EventMap {
  // Data events
  'pr:discovered':                  PR
  'pr:enriched':                    PR
  'linear:issue:discovered':        LinearIssue
  'linear:attachment:discovered':   { prUrl: string; issueIdentifier: string }
  'branch:discovered':              Branch
  'checkout:discovered':            LocalCheckout
  'relation:created':               { type: RelationType; sourceKey: string; targetKey: string }

  // Command events
  'pr:fetch':                       { repoId: string; number: number }
  'pr:fetchDetail':                 { repoId: string; number: number }
  'linear:issue:fetch':             { identifier: string }
  'checkout:scan':                  { paths?: string[] }
}

type RelationType =
  | 'prToLinear'
  | 'branchToPr'
  | 'branchToLinear'
  | 'checkoutToPr'
  | 'checkoutToBranch'
```

## Entity Types

Four first-class entities:

```typescript
interface PR {
  nodeId: string
  number: number
  title: string
  state: string
  draft: boolean
  repoOwner: string
  repoName: string
  repoId: string              // "owner/name" lowercase
  headRef: string
  url: string
  author: string
  role: 'author' | 'assigned' | 'both'
  updatedAt: string
  ci?: CIInfo
  review?: ReviewInfo
  mergeable?: MergeableStatus
}

interface LinearIssue {
  id: string
  identifier: string         // "ENG-123"
  title: string
  status: string
  priority: number
  assignee: string | null
  url: string
  teamKey: string
}

interface Branch {
  name: string
  isRemote: boolean
  isCurrent: boolean
  lastCommitDate?: string
}

interface LocalCheckout {
  path: string               // absolute path on disk
  remoteUrl: string | null
  repoId: string | null      // parsed "owner/name" from remote
  currentBranch: string
  isWorktree: boolean
  parentCheckoutKey: string | null  // checkoutKey of the main clone
}
```

**Entity key functions:**

```typescript
const prKey = (pr: PR) => `${pr.repoId}#${pr.number}`
const linearKey = (issue: LinearIssue) => issue.identifier
const branchKey = (branch: Branch) => branch.name
const checkoutKey = (checkout: LocalCheckout) => checkout.path
```

## Entity Stores

Generic wrapper around `Map`. Created via factory function.

```typescript
function createEntityStore<V>(keyFn: (v: V) => string): EntityStore<V>

interface EntityStore<V> {
  get(key: string): V | undefined
  set(key: string, value: V): void
  has(key: string): boolean
  values(): Iterable<V>
  getAll(): V[]
}
```

## Relation Maps

Bidirectional pairs. Each pair managed via a `link()` helper that writes both sides and emits `relation:created`.

| Relation | Forward Map | Reverse Map |
|---|---|---|
| PR <-> Linear | `prToLinear` | `linearToPr` |
| Branch <-> PR | `branchToPr` | `prToBranch` |
| Branch <-> Linear | `branchToLinear` | `linearToBranch` |
| Checkout <-> PR | `checkoutToPr` | `prToCheckout` |
| Checkout <-> Branch | `checkoutToBranch` | `branchToCheckout` |

```typescript
function createRelationMap<S, T>(): RelationMap<S, T>

// link() writes both sides + emits relation:created
function link(bus, forwardMap, reverseMap, type, sourceKey, targetKey): void
```

**Query utilities:**

```typescript
interface QueryAPI {
  linearIssuesForPr(prKey: string): LinearIssue[]
  prsForLinearIssue(identifier: string): PR[]
  prsForBranch(branchName: string): PR[]
  checkoutsForPr(prKey: string): LocalCheckout[]
  // ... etc
}
```

## Ingestion

Single front door for all data entering the system. Idempotent — skips emit if entity exists and hasn't changed.

```typescript
interface Ingester {
  ingestPRs(prs: PR[]): void
  ingestLinearData(data: { issues: LinearIssue[]; attachments: { prUrl: string; issueIdentifier: string }[] }): void
  ingestBranches(branches: Branch[]): void
  ingestCheckouts(checkouts: LocalCheckout[]): void
}

function createIngester(bus: EventBus, stores: Stores): Ingester
```

## Three Effect Layers

### 1. Discovery Effects

Listen to `*:discovered` events. Parse entities for cross-references. Create relations via `link()`.

| Trigger | Effect |
|---|---|
| `branch:discovered` | Parse branch name for Linear pattern (e.g. `ENG-123`) → `link(branchToLinear)` |
| `pr:discovered` | Match `headRef` to branch → `link(branchToPr)`. Parse title for Linear patterns → `link(prToLinear)` |
| `linear:issue:discovered` | Check if any branches/PRs reference this identifier → create links |
| `linear:attachment:discovered` | Look up PR by URL → `link(prToLinear)` |
| `checkout:discovered` | Match remote to PR repos → `link(checkoutToPr)`. Match branch → `link(checkoutToBranch)` |

### 2. Relation Effects

Listen to `relation:created`. Check if the target entity exists in its store. If not, emit the appropriate fetch command.

```
relation:created { type: 'prToLinear', sourceKey: 'acme/api#42', targetKey: 'ENG-123' }
  → stores.linearIssues.has('ENG-123')?
    → yes: do nothing
    → no: bus.emit('linear:issue:fetch', { identifier: 'ENG-123' })
```

### 3. Fetch Listeners

Listen to `*:fetch` command events. Implement their own batching/debouncing strategy per data source. Call the existing API modules. Funnel results through the ingester.

```
linear:issue:fetch listener:
  → collects identifiers
  → debounces (custom per listener)
  → batch GraphQL query
  → ingester.ingestLinearData(results)
```

## Persistence

A subscriber on data events that writes entity stores and relation maps to disk.

```typescript
function createPersistence(bus, stores, relations): { hydrate(): void }
```

### Two-Phase Hydration

Solves the event ordering problem during startup:

1. **Phase 1 — silent populate.** Load all cached entities into stores without emitting events. Also restore cached relations silently.
2. **Phase 2 — emit discovery events.** Walk hydrated entities and emit `*:discovered`. By this point all cached entities are in all stores, so relation effects see targets as present and skip unnecessary fetches.

## Zustand Integration

Zustand becomes a thin UI-state layer:

**What stays in Zustand:** selection state, filter/sort/search, loading indicators, UI mode, watched PRs.

**What leaves Zustand:** `prs`, `ciCache`, `reviewCache`, `mergeableCache`, `linearCache` — all move to data layer.

```typescript
function createUIStore(dataLayer: DataLayer) {
  const store = create((set, get) => ({
    selectedPrKey: null,
    searchQuery: '',
    sortBy: 'updated',
    loading: true,
    filteredPrs: [],

    recomputeViews() {
      const allPrs = dataLayer.stores.prs.getAll()
      const { searchQuery, sortBy } = get()
      set({ filteredPrs: filter(allPrs, searchQuery, sortBy) })
    }
  }))

  dataLayer.bus.on('pr:discovered', () => store.getState().recomputeViews())
  dataLayer.bus.on('pr:enriched', () => store.getState().recomputeViews())
  dataLayer.bus.on('relation:created', () => store.getState().recomputeViews())

  return store
}
```

## Testability

All implementations take dependencies as arguments — no module-level singletons except in `index.ts`.

- **Event bus:** fresh instance per test, no shared state
- **Effects:** create bus + empty stores + relations, register one effect, emit event, assert links/commands
- **Fetch listeners:** pass mock ingester, assert batching without hitting APIs
- **Ingestion:** pass bus, assert which events fire
- **Relations:** pure data structure tests with `createRelationMap()`
- **Full integration:** wire everything via factory functions with stubbed fetchers

## Startup Sequence

```typescript
const dataLayer = createDataLayer({ githubToken, linearToken, config })
// 1. Creates bus, stores, relations, ingester
// 2. Registers effects, fetch listeners, persistence
// 3. Hydrates from cache (two-phase: populate then emit)
// 4. Fresh fetches overlay cached data through the same event flow

const uiStore = createUIStore(dataLayer)
// Render TUI
```

## Public API

```typescript
interface DataLayer {
  bus: EventBus<EventMap>
  stores: {
    prs: EntityStore<PR>
    linearIssues: EntityStore<LinearIssue>
    branches: EntityStore<Branch>
    checkouts: EntityStore<LocalCheckout>
  }
  relations: Relations
  query: QueryAPI
  ingest: Ingester
  destroy(): void
}
```

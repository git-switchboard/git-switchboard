# Reactive Data Layer

Event-driven data layer for progressive entity enrichment. Zustand sits on top as a thin UI-state layer.

## Architecture

```
Ingestion (front door) --> Entity Stores (Maps) --> Events --> Effects --> Relations
                                                         \--> Fetch Listeners --> API --> Ingestion (loop)
```

All data enters through **ingestion** (`ingest.ts`). Ingestion stores entities and emits events. **Effects** (`effects.ts`) react to events by creating relations and emitting fetch commands. **Fetch listeners** (`fetchers/`) handle commands by calling APIs and re-ingesting results. This creates a reactive loop where discovering one entity can cascade into fetching related entities.

## Key Design Decisions

**Two-phase batch ingestion** (`ingest.ts`): When ingesting a batch of PRs, ALL are stored first, THEN events are emitted. This ensures that when discovery effects run for PR #1, PRs #2-#100 are already in the store.

**Two-phase hydration** (`persistence.ts`): On startup, cached entities and relations are silently populated into stores without emitting events. Then discovery events fire. Since all entities are present, relation effects see targets as existing and skip unnecessary fetches.

**Enrichment staleness** (`ingest.ts`): When re-ingesting a PR without enrichment (e.g., from a list query), existing enrichment is preserved UNLESS it's stale (fetchedAt < updatedAt, or from a previous session past the 60s grace period).

**Causality tracking** (`event-bus.ts`): Every event records which event's handler caused it (causeId + depth). This enables the debug view to show event graphs.

## Modules

| Module | Purpose |
|--------|---------|
| `event-bus.ts` | Typed EventBus with history + causality tracking |
| `events.ts` | DataEventMap — all event types and payloads |
| `entities.ts` | Entity types (PR, LinearIssue, Branch, LocalCheckout), key functions, Stores interface |
| `entity-store.ts` | Generic Map wrapper with keyFn |
| `relations.ts` | Bidirectional relation maps, link() helper, QueryAPI |
| `ingest.ts` | Single entry point for data. Two-phase batch. Staleness checks. |
| `effects.ts` | Discovery effects (parse cross-references) + relation effects (fetch missing targets) |
| `fetchers/github.ts` | Listens to pr:fetchDetail, pr:fetchAll. Batching, cooldown, chunking. |
| `fetchers/linear.ts` | Listens to linear:issue:fetch. Batching + debounce. |
| `persistence.ts` | Disk cache with two-phase hydration. Auto-persists on data events (1s debounce). |
| `loading.ts` | Tracks in-flight fetches per entity key. |
| `index.ts` | Factory + wiring. Creates DataLayer singleton. |

## Event Flow

### Data Events (what happened)
- `pr:discovered` — PR ingested (new or basic fields changed)
- `pr:enriched` — PR re-ingested with CI/review/mergeable/body data
- `linear:issue:discovered` — Linear issue ingested
- `linear:attachment:discovered` — Linear attachment mapping PR URL to issue
- `branch:discovered`, `checkout:discovered` — branch/checkout ingested
- `relation:created` — new link between entities
- `error` — fetch failure with source and message

### Command Events (please do this)
- `pr:fetchDetail` — fetch CI/review/mergeable/body for a PR (supports `force` flag to skip cooldown)
- `pr:fetchAll` — re-fetch the entire PR list
- `linear:issue:fetch` — fetch a Linear issue by identifier

### Effect Chains

```
pr:discovered
  --> parse headRef for Linear pattern --> link(prToLinear)
  --> parse title for Linear pattern --> link(prToLinear)
  --> match to branch --> link(branchToPr)
  --> match to checkout by repoId --> link(checkoutToPr)

pr:enriched
  --> parse body for Linear pattern --> link(prToLinear)

relation:created (prToLinear, target missing)
  --> emit linear:issue:fetch

linear:issue:fetch
  --> fetch listener batches, calls Linear API
  --> ingestLinearData --> linear:issue:discovered
```

## Fetch Listener Behavior

### GitHub (`fetchers/github.ts`)
- **Debounce**: 50ms window collects pr:fetchDetail events
- **Batch size**: 20 PRs per GraphQL request (chunks run concurrently)
- **Cooldown**: 30s per PR key after successful fetch (skipped with `force: true`)
- **In-flight dedup**: same PR can't be fetched concurrently
- **Error handling**: emits `error` event, doesn't throw

### Linear (`fetchers/linear.ts`)
- **Debounce**: 50ms window collects linear:issue:fetch events
- **Dedup**: Set-based, same identifier batched once
- **API**: Uses `searchIssues(term)` with exact identifier match filtering

## Persistence

Auto-persists to `{cacheDir}/data-layer.json` on a 1-second debounce after any data event. Stores all entity data + forward relation maps. On hydration, restores entities silently then emits discovery events.

## Testing

All modules use factory functions with dependency injection — no singletons except in `index.ts`. Tests create fresh EventBus/stores per test case.

## Adding a New Entity Type

1. Add the interface + key function to `entities.ts`
2. Add to the `Stores` interface
3. Add discovery/ingestion events to `events.ts`
4. Add store + ingestion method to `ingest.ts`
5. Add discovery effects in `effects.ts`
6. Add to persistence serialization/hydration
7. Create store in `index.ts`

## Debug View

Press `~` in the PR TUI to see the event bus history. Enter on an event shows the full payload, causal chain, and triggered children. Press `e` to export the full history as JSON (path copied to clipboard).

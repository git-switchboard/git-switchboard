# Reactive Data Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single-pass, imperative data flow with an event-driven reactive data layer where entities progressively enrich through discovery, relation creation, and on-demand fetching.

**Architecture:** A typed event bus carries data events ("this was loaded") and command events ("please fetch this"). Entity stores (plain Maps) hold PRs, Linear issues, branches, and local checkouts. Bidirectional relation maps track many-to-many links. Discovery effects parse entities for cross-references and create relations. Relation effects check if targets exist and emit fetch commands when they don't. Fetch listeners batch/debounce API calls. Zustand sits on top as a thin UI-state layer.

**Tech Stack:** TypeScript (ESNext, bundler resolution), Bun runtime + `bun test`, Zustand 5, existing GitHub/Linear/git API modules.

**Design doc:** `docs/plans/2026-04-08-reactive-data-layer-design.md`

---

### Task 1: Event Bus

The typed event bus is the foundation everything else builds on. A generic class parameterized by an event map type.

**Files:**
- Create: `packages/git-switchboard/src/data/event-bus.ts`
- Test: `packages/git-switchboard/src/data/event-bus.test.ts`

**Step 1: Write the failing tests**

```typescript
// event-bus.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEventBus } from './event-bus.js';

type TestEvents = {
  'item:added': { id: string; value: number };
  'item:removed': { id: string };
};

describe('EventBus', () => {
  it('calls handler when event is emitted', () => {
    const bus = createEventBus<TestEvents>();
    const received: { id: string; value: number }[] = [];
    bus.on('item:added', (payload) => received.push(payload));
    bus.emit('item:added', { id: 'a', value: 1 });
    assert.deepEqual(received, [{ id: 'a', value: 1 }]);
  });

  it('does not call handler for other events', () => {
    const bus = createEventBus<TestEvents>();
    let called = false;
    bus.on('item:removed', () => { called = true; });
    bus.emit('item:added', { id: 'a', value: 1 });
    assert.equal(called, false);
  });

  it('supports multiple handlers for the same event', () => {
    const bus = createEventBus<TestEvents>();
    let count = 0;
    bus.on('item:added', () => { count++; });
    bus.on('item:added', () => { count++; });
    bus.emit('item:added', { id: 'a', value: 1 });
    assert.equal(count, 2);
  });

  it('returns unsubscribe function from on()', () => {
    const bus = createEventBus<TestEvents>();
    let count = 0;
    const unsub = bus.on('item:added', () => { count++; });
    bus.emit('item:added', { id: 'a', value: 1 });
    unsub();
    bus.emit('item:added', { id: 'b', value: 2 });
    assert.equal(count, 1);
  });

  it('off() removes a specific handler', () => {
    const bus = createEventBus<TestEvents>();
    let count = 0;
    const handler = () => { count++; };
    bus.on('item:added', handler);
    bus.off('item:added', handler);
    bus.emit('item:added', { id: 'a', value: 1 });
    assert.equal(count, 0);
  });

  it('handles emit with no listeners without error', () => {
    const bus = createEventBus<TestEvents>();
    assert.doesNotThrow(() => {
      bus.emit('item:added', { id: 'a', value: 1 });
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/git-switchboard && bun test src/data/event-bus.test.ts`
Expected: FAIL — module `./event-bus.js` not found

**Step 3: Write minimal implementation**

```typescript
// event-bus.ts
export interface EventBus<TEventMap> {
  on<K extends keyof TEventMap>(
    event: K,
    handler: (payload: TEventMap[K]) => void
  ): () => void;
  off<K extends keyof TEventMap>(
    event: K,
    handler: (payload: TEventMap[K]) => void
  ): void;
  emit<K extends keyof TEventMap>(event: K, payload: TEventMap[K]): void;
}

export function createEventBus<
  TEventMap extends Record<string, unknown>,
>(): EventBus<TEventMap> {
  const listeners = new Map<
    keyof TEventMap,
    Set<(payload: unknown) => void>
  >();

  return {
    on<K extends keyof TEventMap>(
      event: K,
      handler: (payload: TEventMap[K]) => void,
    ): () => void {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      const handlerSet = listeners.get(event)!;
      handlerSet.add(handler as (payload: unknown) => void);
      return () => {
        handlerSet.delete(handler as (payload: unknown) => void);
      };
    },

    off<K extends keyof TEventMap>(
      event: K,
      handler: (payload: TEventMap[K]) => void,
    ): void {
      listeners.get(event)?.delete(handler as (payload: unknown) => void);
    },

    emit<K extends keyof TEventMap>(event: K, payload: TEventMap[K]): void {
      const handlerSet = listeners.get(event);
      if (!handlerSet) return;
      for (const handler of handlerSet) {
        handler(payload);
      }
    },
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/git-switchboard && bun test src/data/event-bus.test.ts`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add packages/git-switchboard/src/data/event-bus.ts packages/git-switchboard/src/data/event-bus.test.ts
git commit -m "feat(data): add typed EventBus with factory function"
```

---

### Task 2: Event Map & Entity Types

Define the concrete event map and all entity types used by the data layer. These are pure types + key functions — no logic to test beyond type correctness.

**Files:**
- Create: `packages/git-switchboard/src/data/events.ts`
- Create: `packages/git-switchboard/src/data/entities.ts`
- Test: `packages/git-switchboard/src/data/entities.test.ts`

**Step 1: Write the failing tests**

Test the key functions — they're the only runtime code here.

```typescript
// entities.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { prKey, linearKey, branchKey, checkoutKey } from './entities.js';
import type { PR, LinearIssue, Branch, LocalCheckout } from './entities.js';

describe('entity key functions', () => {
  it('prKey returns repoId#number', () => {
    assert.equal(
      prKey({ repoId: 'acme/api', number: 42 } as PR),
      'acme/api#42',
    );
  });

  it('linearKey returns identifier', () => {
    assert.equal(
      linearKey({ identifier: 'ENG-123' } as LinearIssue),
      'ENG-123',
    );
  });

  it('branchKey returns name', () => {
    assert.equal(
      branchKey({ name: 'feat/auth' } as Branch),
      'feat/auth',
    );
  });

  it('checkoutKey returns path', () => {
    assert.equal(
      checkoutKey({ path: '/Users/me/repos/api' } as LocalCheckout),
      '/Users/me/repos/api',
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/git-switchboard && bun test src/data/entities.test.ts`
Expected: FAIL — module not found

**Step 3: Write entity types, key functions, and event map**

```typescript
// entities.ts
import type { CIInfo, ReviewInfo, MergeableStatus, PRRole } from '../types.js';

export interface PR {
  nodeId: string;
  number: number;
  title: string;
  state: string;
  draft: boolean;
  repoOwner: string;
  repoName: string;
  repoId: string;
  forkRepoId: string | null;
  headRef: string;
  url: string;
  author: string;
  role: PRRole;
  updatedAt: string;
  ci?: CIInfo;
  review?: ReviewInfo;
  mergeable?: MergeableStatus;
}

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

export interface Branch {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
  lastCommitDate?: string;
}

export interface LocalCheckout {
  path: string;
  remoteUrl: string | null;
  repoId: string | null;
  currentBranch: string;
  isWorktree: boolean;
  parentCheckoutKey: string | null;
}

export const prKey = (pr: PR): string => `${pr.repoId}#${pr.number}`;
export const linearKey = (issue: LinearIssue): string => issue.identifier;
export const branchKey = (branch: Branch): string => branch.name;
export const checkoutKey = (checkout: LocalCheckout): string => checkout.path;
```

```typescript
// events.ts
import type { PR, LinearIssue, Branch, LocalCheckout } from './entities.js';

export type RelationType =
  | 'prToLinear'
  | 'branchToPr'
  | 'branchToLinear'
  | 'checkoutToPr'
  | 'checkoutToBranch';

export interface DataEventMap {
  // Data events
  'pr:discovered': PR;
  'pr:enriched': PR;
  'linear:issue:discovered': LinearIssue;
  'linear:attachment:discovered': { prUrl: string; issueIdentifier: string };
  'branch:discovered': Branch;
  'checkout:discovered': LocalCheckout;
  'relation:created': {
    type: RelationType;
    sourceKey: string;
    targetKey: string;
  };

  // Command events
  'pr:fetch': { repoId: string; number: number };
  'pr:fetchDetail': { repoId: string; number: number };
  'linear:issue:fetch': { identifier: string };
  'checkout:scan': { paths?: string[] };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/git-switchboard && bun test src/data/entities.test.ts`
Expected: All 4 tests PASS

**Step 5: Run typecheck**

Run: `cd packages/git-switchboard && npx tsc --noEmit`
Expected: No type errors

**Step 6: Commit**

```bash
git add packages/git-switchboard/src/data/entities.ts packages/git-switchboard/src/data/entities.test.ts packages/git-switchboard/src/data/events.ts
git commit -m "feat(data): add entity types, key functions, and event map"
```

---

### Task 3: Entity Store

Generic `EntityStore<V>` wrapper around `Map`, parameterized by a key function.

**Files:**
- Create: `packages/git-switchboard/src/data/entity-store.ts`
- Test: `packages/git-switchboard/src/data/entity-store.test.ts`

**Step 1: Write the failing tests**

```typescript
// entity-store.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEntityStore } from './entity-store.js';

interface Item {
  id: string;
  value: number;
}

const itemKey = (item: Item) => item.id;

describe('EntityStore', () => {
  it('stores and retrieves an entity by key', () => {
    const store = createEntityStore(itemKey);
    const item = { id: 'a', value: 1 };
    store.set(item);
    assert.deepEqual(store.get('a'), item);
  });

  it('returns undefined for missing key', () => {
    const store = createEntityStore(itemKey);
    assert.equal(store.get('missing'), undefined);
  });

  it('has() returns true for existing, false for missing', () => {
    const store = createEntityStore(itemKey);
    store.set({ id: 'a', value: 1 });
    assert.equal(store.has('a'), true);
    assert.equal(store.has('b'), false);
  });

  it('getAll() returns all entities', () => {
    const store = createEntityStore(itemKey);
    store.set({ id: 'a', value: 1 });
    store.set({ id: 'b', value: 2 });
    const all = store.getAll();
    assert.equal(all.length, 2);
    assert.deepEqual(
      all.sort((a, b) => a.id.localeCompare(b.id)),
      [{ id: 'a', value: 1 }, { id: 'b', value: 2 }],
    );
  });

  it('overwrites entity with same key', () => {
    const store = createEntityStore(itemKey);
    store.set({ id: 'a', value: 1 });
    store.set({ id: 'a', value: 99 });
    assert.deepEqual(store.get('a'), { id: 'a', value: 99 });
    assert.equal(store.getAll().length, 1);
  });

  it('setByKey() stores entity under explicit key', () => {
    const store = createEntityStore(itemKey);
    store.setByKey('custom-key', { id: 'a', value: 1 });
    assert.deepEqual(store.get('custom-key'), { id: 'a', value: 1 });
    assert.equal(store.get('a'), undefined);
  });

  it('values() is iterable', () => {
    const store = createEntityStore(itemKey);
    store.set({ id: 'a', value: 1 });
    store.set({ id: 'b', value: 2 });
    const vals = [...store.values()];
    assert.equal(vals.length, 2);
  });

  it('clear() removes all entities', () => {
    const store = createEntityStore(itemKey);
    store.set({ id: 'a', value: 1 });
    store.set({ id: 'b', value: 2 });
    store.clear();
    assert.equal(store.getAll().length, 0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/git-switchboard && bun test src/data/entity-store.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// entity-store.ts
export interface EntityStore<V> {
  get(key: string): V | undefined;
  set(value: V): void;
  setByKey(key: string, value: V): void;
  has(key: string): boolean;
  values(): Iterable<V>;
  getAll(): V[];
  clear(): void;
}

export function createEntityStore<V>(
  keyFn: (value: V) => string,
): EntityStore<V> {
  const map = new Map<string, V>();

  return {
    get(key: string): V | undefined {
      return map.get(key);
    },
    set(value: V): void {
      map.set(keyFn(value), value);
    },
    setByKey(key: string, value: V): void {
      map.set(key, value);
    },
    has(key: string): boolean {
      return map.has(key);
    },
    values(): Iterable<V> {
      return map.values();
    },
    getAll(): V[] {
      return Array.from(map.values());
    },
    clear(): void {
      map.clear();
    },
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/git-switchboard && bun test src/data/entity-store.test.ts`
Expected: All 8 tests PASS

**Step 5: Commit**

```bash
git add packages/git-switchboard/src/data/entity-store.ts packages/git-switchboard/src/data/entity-store.test.ts
git commit -m "feat(data): add generic EntityStore with factory function"
```

---

### Task 4: Relation Maps

Bidirectional relation maps with a `link()` helper that writes both sides and emits `relation:created`. Plus a `query` API for convenience lookups.

**Files:**
- Create: `packages/git-switchboard/src/data/relations.ts`
- Test: `packages/git-switchboard/src/data/relations.test.ts`

**Step 1: Write the failing tests**

```typescript
// relations.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRelationMap, createRelations, createQueryAPI } from './relations.js';
import { createEventBus } from './event-bus.js';
import { createEntityStore } from './entity-store.js';
import type { DataEventMap } from './events.js';
import type { PR, LinearIssue, Branch, LocalCheckout } from './entities.js';
import { prKey, linearKey, branchKey, checkoutKey } from './entities.js';

describe('RelationMap', () => {
  it('get() returns empty set for unknown key', () => {
    const rel = createRelationMap();
    assert.deepEqual(rel.get('unknown'), new Set());
  });

  it('add() creates a link and get() retrieves it', () => {
    const rel = createRelationMap();
    rel.add('a', 'x');
    assert.deepEqual(rel.get('a'), new Set(['x']));
  });

  it('supports many-to-many', () => {
    const rel = createRelationMap();
    rel.add('a', 'x');
    rel.add('a', 'y');
    rel.add('b', 'x');
    assert.deepEqual(rel.get('a'), new Set(['x', 'y']));
    assert.deepEqual(rel.get('b'), new Set(['x']));
  });

  it('add() is idempotent', () => {
    const rel = createRelationMap();
    rel.add('a', 'x');
    rel.add('a', 'x');
    assert.deepEqual(rel.get('a'), new Set(['x']));
  });

  it('has() checks for a specific link', () => {
    const rel = createRelationMap();
    rel.add('a', 'x');
    assert.equal(rel.has('a', 'x'), true);
    assert.equal(rel.has('a', 'y'), false);
  });
});

describe('createRelations + link()', () => {
  it('link() writes both forward and reverse maps and emits relation:created', () => {
    const bus = createEventBus<DataEventMap>();
    const relations = createRelations(bus);
    const emitted: DataEventMap['relation:created'][] = [];
    bus.on('relation:created', (payload) => emitted.push(payload));

    relations.link('prToLinear', 'acme/api#42', 'ENG-123');

    assert.deepEqual(relations.prToLinear.get('acme/api#42'), new Set(['ENG-123']));
    assert.deepEqual(relations.linearToPr.get('ENG-123'), new Set(['acme/api#42']));
    assert.equal(emitted.length, 1);
    assert.deepEqual(emitted[0], {
      type: 'prToLinear',
      sourceKey: 'acme/api#42',
      targetKey: 'ENG-123',
    });
  });

  it('link() does not re-emit for duplicate links', () => {
    const bus = createEventBus<DataEventMap>();
    const relations = createRelations(bus);
    const emitted: DataEventMap['relation:created'][] = [];
    bus.on('relation:created', (payload) => emitted.push(payload));

    relations.link('prToLinear', 'acme/api#42', 'ENG-123');
    relations.link('prToLinear', 'acme/api#42', 'ENG-123');

    assert.equal(emitted.length, 1);
  });
});

describe('QueryAPI', () => {
  it('linearIssuesForPr resolves through relation + store', () => {
    const bus = createEventBus<DataEventMap>();
    const relations = createRelations(bus);
    const stores = {
      prs: createEntityStore(prKey),
      linearIssues: createEntityStore(linearKey),
      branches: createEntityStore(branchKey),
      checkouts: createEntityStore(checkoutKey),
    };

    const issue: LinearIssue = {
      id: 'li1', identifier: 'ENG-123', title: 'Auth',
      status: 'In Progress', priority: 1, assignee: null,
      url: 'https://linear.app/eng/ENG-123', teamKey: 'ENG',
    };
    stores.linearIssues.set(issue);
    relations.link('prToLinear', 'acme/api#42', 'ENG-123');

    const query = createQueryAPI(stores, relations);
    const result = query.linearIssuesForPr('acme/api#42');
    assert.deepEqual(result, [issue]);
  });

  it('returns empty array when no relations exist', () => {
    const bus = createEventBus<DataEventMap>();
    const relations = createRelations(bus);
    const stores = {
      prs: createEntityStore(prKey),
      linearIssues: createEntityStore(linearKey),
      branches: createEntityStore(branchKey),
      checkouts: createEntityStore(checkoutKey),
    };

    const query = createQueryAPI(stores, relations);
    assert.deepEqual(query.linearIssuesForPr('acme/api#42'), []);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/git-switchboard && bun test src/data/relations.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// relations.ts
import type { EventBus } from './event-bus.js';
import type { DataEventMap, RelationType } from './events.js';
import type { PR, LinearIssue, Branch, LocalCheckout } from './entities.js';
import type { EntityStore } from './entity-store.js';

export interface RelationMap {
  get(sourceKey: string): Set<string>;
  add(sourceKey: string, targetKey: string): boolean;
  has(sourceKey: string, targetKey: string): boolean;
  clear(): void;
  entries(): Iterable<[string, Set<string>]>;
}

export function createRelationMap(): RelationMap {
  const map = new Map<string, Set<string>>();

  return {
    get(sourceKey: string): Set<string> {
      return map.get(sourceKey) ?? new Set();
    },
    add(sourceKey: string, targetKey: string): boolean {
      if (!map.has(sourceKey)) {
        map.set(sourceKey, new Set());
      }
      const set = map.get(sourceKey)!;
      if (set.has(targetKey)) return false;
      set.add(targetKey);
      return true;
    },
    has(sourceKey: string, targetKey: string): boolean {
      return map.get(sourceKey)?.has(targetKey) ?? false;
    },
    clear(): void {
      map.clear();
    },
    entries(): Iterable<[string, Set<string>]> {
      return map.entries();
    },
  };
}

export interface Stores {
  prs: EntityStore<PR>;
  linearIssues: EntityStore<LinearIssue>;
  branches: EntityStore<Branch>;
  checkouts: EntityStore<LocalCheckout>;
}

// Maps RelationType to the forward/reverse pair
const RELATION_PAIRS: Record<RelationType, [RelationType, RelationType]> = {
  prToLinear: ['prToLinear', 'linearToPr'],
  branchToPr: ['branchToPr', 'prToBranch'],
  branchToLinear: ['branchToLinear', 'linearToBranch'],
  checkoutToPr: ['checkoutToPr', 'prToCheckout'],
  checkoutToBranch: ['checkoutToBranch', 'branchToCheckout'],
};

// Reverse map names aren't in RelationType union, so extend for internal use
type AllRelationNames = RelationType
  | 'linearToPr'
  | 'prToBranch'
  | 'linearToBranch'
  | 'prToCheckout'
  | 'branchToCheckout';

export type Relations = {
  [K in AllRelationNames]: RelationMap;
} & {
  link(type: RelationType, sourceKey: string, targetKey: string): void;
  clear(): void;
};

export function createRelations(bus: EventBus<DataEventMap>): Relations {
  const maps: Record<AllRelationNames, RelationMap> = {
    prToLinear: createRelationMap(),
    linearToPr: createRelationMap(),
    branchToPr: createRelationMap(),
    prToBranch: createRelationMap(),
    branchToLinear: createRelationMap(),
    linearToBranch: createRelationMap(),
    checkoutToPr: createRelationMap(),
    prToCheckout: createRelationMap(),
    checkoutToBranch: createRelationMap(),
    branchToCheckout: createRelationMap(),
  };

  function link(type: RelationType, sourceKey: string, targetKey: string): void {
    const forwardMap = maps[type];
    const isNew = forwardMap.add(sourceKey, targetKey);
    if (!isNew) return;

    // Write reverse
    const reverseName = getReverseName(type);
    maps[reverseName].add(targetKey, sourceKey);

    bus.emit('relation:created', { type, sourceKey, targetKey });
  }

  function clear(): void {
    for (const map of Object.values(maps)) {
      map.clear();
    }
  }

  return { ...maps, link, clear };
}

function getReverseName(type: RelationType): AllRelationNames {
  const reverseMap: Record<RelationType, AllRelationNames> = {
    prToLinear: 'linearToPr',
    branchToPr: 'prToBranch',
    branchToLinear: 'linearToBranch',
    checkoutToPr: 'prToCheckout',
    checkoutToBranch: 'branchToCheckout',
  };
  return reverseMap[type];
}

export interface QueryAPI {
  linearIssuesForPr(prKey: string): LinearIssue[];
  prsForLinearIssue(identifier: string): PR[];
  prsForBranch(branchName: string): PR[];
  branchesForPr(prKey: string): Branch[];
  checkoutsForPr(prKey: string): LocalCheckout[];
  prsForCheckout(checkoutPath: string): PR[];
  branchesForCheckout(checkoutPath: string): Branch[];
  checkoutsForBranch(branchName: string): LocalCheckout[];
  linearIssuesForBranch(branchName: string): LinearIssue[];
  branchesForLinearIssue(identifier: string): Branch[];
}

export function createQueryAPI(stores: Stores, relations: Relations): QueryAPI {
  function resolveMany<V>(
    relationMap: RelationMap,
    key: string,
    store: EntityStore<V>,
  ): V[] {
    const keys = relationMap.get(key);
    const results: V[] = [];
    for (const k of keys) {
      const entity = store.get(k);
      if (entity) results.push(entity);
    }
    return results;
  }

  return {
    linearIssuesForPr: (key) => resolveMany(relations.prToLinear, key, stores.linearIssues),
    prsForLinearIssue: (id) => resolveMany(relations.linearToPr, id, stores.prs),
    prsForBranch: (name) => resolveMany(relations.branchToPr, name, stores.prs),
    branchesForPr: (key) => resolveMany(relations.prToBranch, key, stores.branches),
    checkoutsForPr: (key) => resolveMany(relations.prToCheckout, key, stores.checkouts),
    prsForCheckout: (path) => resolveMany(relations.checkoutToPr, path, stores.prs),
    branchesForCheckout: (path) => resolveMany(relations.checkoutToBranch, path, stores.branches),
    checkoutsForBranch: (name) => resolveMany(relations.branchToCheckout, name, stores.checkouts),
    linearIssuesForBranch: (name) => resolveMany(relations.branchToLinear, name, stores.linearIssues),
    branchesForLinearIssue: (id) => resolveMany(relations.linearToBranch, id, stores.branches),
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/git-switchboard && bun test src/data/relations.test.ts`
Expected: All 7 tests PASS

**Step 5: Commit**

```bash
git add packages/git-switchboard/src/data/relations.ts packages/git-switchboard/src/data/relations.test.ts
git commit -m "feat(data): add bidirectional relation maps with link() and QueryAPI"
```

---

### Task 5: Ingestion Layer

The single front door for data entering the system. Normalizes data, writes to stores, emits discovery events. Idempotent — skips emit if entity exists and hasn't meaningfully changed.

**Files:**
- Create: `packages/git-switchboard/src/data/ingest.ts`
- Test: `packages/git-switchboard/src/data/ingest.test.ts`

**Step 1: Write the failing tests**

```typescript
// ingest.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEventBus } from './event-bus.js';
import { createEntityStore } from './entity-store.js';
import { createIngester } from './ingest.js';
import { prKey, linearKey, branchKey, checkoutKey } from './entities.js';
import type { PR, LinearIssue, Branch, LocalCheckout } from './entities.js';
import type { DataEventMap } from './events.js';

function makePR(overrides: Partial<PR> = {}): PR {
  return {
    nodeId: 'PR_1', number: 1, title: 'Test PR', state: 'OPEN',
    draft: false, repoOwner: 'acme', repoName: 'api', repoId: 'acme/api',
    forkRepoId: null, headRef: 'feat/ENG-123-auth', url: 'https://github.com/acme/api/pull/1',
    author: 'dev', role: 'author', updatedAt: '2026-04-08T00:00:00Z',
    ...overrides,
  };
}

function makeLinearIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: 'li1', identifier: 'ENG-123', title: 'Auth feature',
    status: 'In Progress', priority: 1, assignee: null,
    url: 'https://linear.app/eng/ENG-123', teamKey: 'ENG',
    ...overrides,
  };
}

function makeBranch(overrides: Partial<Branch> = {}): Branch {
  return {
    name: 'feat/ENG-123-auth', isRemote: false, isCurrent: false,
    ...overrides,
  };
}

function makeCheckout(overrides: Partial<LocalCheckout> = {}): LocalCheckout {
  return {
    path: '/Users/me/repos/api', remoteUrl: 'git@github.com:acme/api.git',
    repoId: 'acme/api', currentBranch: 'main', isWorktree: false,
    parentCheckoutKey: null,
    ...overrides,
  };
}

function createTestIngester() {
  const bus = createEventBus<DataEventMap>();
  const stores = {
    prs: createEntityStore<PR>(prKey),
    linearIssues: createEntityStore<LinearIssue>(linearKey),
    branches: createEntityStore<Branch>(branchKey),
    checkouts: createEntityStore<LocalCheckout>(checkoutKey),
  };
  const ingester = createIngester(bus, stores);
  return { bus, stores, ingester };
}

describe('Ingester', () => {
  describe('ingestPRs', () => {
    it('stores PRs and emits pr:discovered for each', () => {
      const { bus, stores, ingester } = createTestIngester();
      const discovered: PR[] = [];
      bus.on('pr:discovered', (pr) => discovered.push(pr));

      const pr = makePR();
      ingester.ingestPRs([pr]);

      assert.deepEqual(stores.prs.get('acme/api#1'), pr);
      assert.equal(discovered.length, 1);
    });

    it('skips emit for unchanged PR on re-ingest', () => {
      const { bus, stores, ingester } = createTestIngester();
      const discovered: PR[] = [];

      const pr = makePR();
      ingester.ingestPRs([pr]);
      bus.on('pr:discovered', (p) => discovered.push(p));
      ingester.ingestPRs([pr]);

      assert.equal(discovered.length, 0);
    });

    it('re-emits when PR has changed', () => {
      const { bus, stores, ingester } = createTestIngester();
      const discovered: PR[] = [];

      ingester.ingestPRs([makePR()]);
      bus.on('pr:discovered', (p) => discovered.push(p));
      ingester.ingestPRs([makePR({ title: 'Updated title' })]);

      assert.equal(discovered.length, 1);
      assert.equal(stores.prs.get('acme/api#1')?.title, 'Updated title');
    });
  });

  describe('ingestPRs with enrichment', () => {
    it('emits pr:enriched when CI/review/mergeable data is added', () => {
      const { bus, stores, ingester } = createTestIngester();
      const enriched: PR[] = [];
      bus.on('pr:enriched', (pr) => enriched.push(pr));

      ingester.ingestPRs([makePR()]);
      ingester.ingestPRs([makePR({
        ci: { status: 'passing', checks: [], fetchedAt: Date.now() },
      })]);

      assert.equal(enriched.length, 1);
    });
  });

  describe('ingestLinearData', () => {
    it('stores issues and emits linear:issue:discovered', () => {
      const { bus, stores, ingester } = createTestIngester();
      const discovered: LinearIssue[] = [];
      bus.on('linear:issue:discovered', (issue) => discovered.push(issue));

      ingester.ingestLinearData({
        issues: [makeLinearIssue()],
        attachments: [],
      });

      assert.equal(stores.linearIssues.has('ENG-123'), true);
      assert.equal(discovered.length, 1);
    });

    it('emits linear:attachment:discovered for each attachment', () => {
      const { bus, ingester } = createTestIngester();
      const attachments: DataEventMap['linear:attachment:discovered'][] = [];
      bus.on('linear:attachment:discovered', (a) => attachments.push(a));

      ingester.ingestLinearData({
        issues: [],
        attachments: [{ prUrl: 'https://github.com/acme/api/pull/1', issueIdentifier: 'ENG-123' }],
      });

      assert.equal(attachments.length, 1);
      assert.deepEqual(attachments[0], {
        prUrl: 'https://github.com/acme/api/pull/1',
        issueIdentifier: 'ENG-123',
      });
    });
  });

  describe('ingestBranches', () => {
    it('stores branches and emits branch:discovered', () => {
      const { bus, stores, ingester } = createTestIngester();
      const discovered: Branch[] = [];
      bus.on('branch:discovered', (b) => discovered.push(b));

      ingester.ingestBranches([makeBranch()]);

      assert.equal(stores.branches.has('feat/ENG-123-auth'), true);
      assert.equal(discovered.length, 1);
    });
  });

  describe('ingestCheckouts', () => {
    it('stores checkouts and emits checkout:discovered', () => {
      const { bus, stores, ingester } = createTestIngester();
      const discovered: LocalCheckout[] = [];
      bus.on('checkout:discovered', (c) => discovered.push(c));

      ingester.ingestCheckouts([makeCheckout()]);

      assert.equal(stores.checkouts.has('/Users/me/repos/api'), true);
      assert.equal(discovered.length, 1);
    });
  });

  describe('batch two-phase behavior', () => {
    it('all PRs in batch are in store before any discovery event fires', () => {
      const { bus, stores, ingester } = createTestIngester();
      let storeCountDuringFirstEvent: number | null = null;

      bus.on('pr:discovered', () => {
        if (storeCountDuringFirstEvent === null) {
          storeCountDuringFirstEvent = stores.prs.getAll().length;
        }
      });

      ingester.ingestPRs([
        makePR({ number: 1 }),
        makePR({ number: 2, nodeId: 'PR_2', url: 'https://github.com/acme/api/pull/2' }),
        makePR({ number: 3, nodeId: 'PR_3', url: 'https://github.com/acme/api/pull/3' }),
      ]);

      // When the first event fires, all 3 should already be in the store
      assert.equal(storeCountDuringFirstEvent, 3);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/git-switchboard && bun test src/data/ingest.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

The key design choice: **two-phase batch ingestion**. When a batch of 100 PRs arrives, we store all of them first, then emit events. This way, when discovery effects run for PR #1 and scan the store for matches, PRs #2-#100 are already present. Same pattern as hydration.

```typescript
// ingest.ts
import type { EventBus } from './event-bus.js';
import type { DataEventMap } from './events.js';
import type {
  PR, LinearIssue, Branch, LocalCheckout,
} from './entities.js';
import { prKey, linearKey, branchKey, checkoutKey } from './entities.js';
import type { EntityStore } from './entity-store.js';

export interface Stores {
  prs: EntityStore<PR>;
  linearIssues: EntityStore<LinearIssue>;
  branches: EntityStore<Branch>;
  checkouts: EntityStore<LocalCheckout>;
}

export interface Ingester {
  ingestPRs(prs: PR[]): void;
  ingestLinearData(data: {
    issues: LinearIssue[];
    attachments: { prUrl: string; issueIdentifier: string }[];
  }): void;
  ingestBranches(branches: Branch[]): void;
  ingestCheckouts(checkouts: LocalCheckout[]): void;
}

type EventEntry<K extends keyof DataEventMap> = { event: K; payload: DataEventMap[K] };

export function createIngester(
  bus: EventBus<DataEventMap>,
  stores: Stores,
): Ingester {
  // Shared helper: two-phase batch ingest
  // Phase 1: store all items, collect events to emit
  // Phase 2: emit all events (effects now see the full batch in the store)
  function emitDeferred(events: EventEntry<keyof DataEventMap>[]): void {
    for (const { event, payload } of events) {
      (bus.emit as (e: string, p: unknown) => void)(event, payload);
    }
  }

  return {
    ingestPRs(prs: PR[]): void {
      // Phase 1: store all, determine which events to fire
      const deferred: EventEntry<'pr:discovered' | 'pr:enriched'>[] = [];

      for (const pr of prs) {
        const key = prKey(pr);
        const existing = stores.prs.get(key);
        stores.prs.set(pr);

        if (!existing) {
          deferred.push({ event: 'pr:discovered', payload: pr });
          continue;
        }

        const enriched =
          (pr.ci && !existing.ci) ||
          (pr.review && !existing.review) ||
          (pr.mergeable && !existing.mergeable);
        if (enriched) {
          deferred.push({ event: 'pr:enriched', payload: pr });
          continue;
        }

        if (hasChanged(existing, pr)) {
          deferred.push({ event: 'pr:discovered', payload: pr });
        }
      }

      // Phase 2: emit events (all PRs in batch are now in the store)
      emitDeferred(deferred);
    },

    ingestLinearData(data): void {
      const deferred: EventEntry<'linear:issue:discovered' | 'linear:attachment:discovered'>[] = [];

      for (const issue of data.issues) {
        const existing = stores.linearIssues.get(linearKey(issue));
        stores.linearIssues.set(issue);

        if (!existing || hasChanged(existing, issue)) {
          deferred.push({ event: 'linear:issue:discovered', payload: issue });
        }
      }
      for (const attachment of data.attachments) {
        deferred.push({ event: 'linear:attachment:discovered', payload: attachment });
      }

      emitDeferred(deferred);
    },

    ingestBranches(branches: Branch[]): void {
      const deferred: EventEntry<'branch:discovered'>[] = [];

      for (const branch of branches) {
        const existing = stores.branches.get(branchKey(branch));
        stores.branches.set(branch);

        if (!existing || hasChanged(existing, branch)) {
          deferred.push({ event: 'branch:discovered', payload: branch });
        }
      }

      emitDeferred(deferred);
    },

    ingestCheckouts(checkouts: LocalCheckout[]): void {
      const deferred: EventEntry<'checkout:discovered'>[] = [];

      for (const checkout of checkouts) {
        const existing = stores.checkouts.get(checkoutKey(checkout));
        stores.checkouts.set(checkout);

        if (!existing || hasChanged(existing, checkout)) {
          deferred.push({ event: 'checkout:discovered', payload: checkout });
        }
      }

      emitDeferred(deferred);
    },
  };
}

function hasChanged<T extends Record<string, unknown>>(a: T, b: T): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return true;
  for (const key of keysA) {
    if (a[key] !== b[key]) return true;
  }
  return false;
}
```

**Important:** `hasChanged` uses shallow comparison. For flat entity fields it catches real updates. Object fields like `ci`/`review` always show as changed (triggering `pr:enriched`), which is the desired behavior for progressive enrichment.

**Step 4: Run tests to verify they pass**

Run: `cd packages/git-switchboard && bun test src/data/ingest.test.ts`
Expected: All 8 tests PASS

**Step 5: Commit**

```bash
git add packages/git-switchboard/src/data/ingest.ts packages/git-switchboard/src/data/ingest.test.ts
git commit -m "feat(data): add ingestion layer with idempotent discovery events"
```

---

### Task 6: Discovery Effects

Effects that listen to `*:discovered` events, parse entities for cross-references, and create relations via `link()`. Uses existing `parseLinearIssueId` from `../linear.ts`.

**Files:**
- Create: `packages/git-switchboard/src/data/effects.ts`
- Test: `packages/git-switchboard/src/data/effects.test.ts`

**Step 1: Write the failing tests**

```typescript
// effects.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEventBus } from './event-bus.js';
import { createEntityStore } from './entity-store.js';
import { createRelations } from './relations.js';
import { registerDiscoveryEffects, registerRelationEffects } from './effects.js';
import { prKey, linearKey, branchKey, checkoutKey } from './entities.js';
import type { PR, LinearIssue, Branch, LocalCheckout } from './entities.js';
import type { DataEventMap } from './events.js';

function setup() {
  const bus = createEventBus<DataEventMap>();
  const stores = {
    prs: createEntityStore<PR>(prKey),
    linearIssues: createEntityStore<LinearIssue>(linearKey),
    branches: createEntityStore<Branch>(branchKey),
    checkouts: createEntityStore<LocalCheckout>(checkoutKey),
  };
  const relations = createRelations(bus);
  return { bus, stores, relations };
}

function makePR(overrides: Partial<PR> = {}): PR {
  return {
    nodeId: 'PR_1', number: 1, title: 'Test PR', state: 'OPEN',
    draft: false, repoOwner: 'acme', repoName: 'api', repoId: 'acme/api',
    forkRepoId: null, headRef: 'feat/ENG-123-auth',
    url: 'https://github.com/acme/api/pull/1',
    author: 'dev', role: 'author', updatedAt: '2026-04-08T00:00:00Z',
    ...overrides,
  };
}

describe('Discovery Effects', () => {
  it('pr:discovered links PR to branch by headRef', () => {
    const { bus, stores, relations } = setup();
    stores.branches.set({ name: 'feat/ENG-123-auth', isRemote: false, isCurrent: false });
    registerDiscoveryEffects(bus, stores, relations);

    bus.emit('pr:discovered', makePR());

    assert.equal(relations.branchToPr.has('feat/ENG-123-auth', 'acme/api#1'), true);
  });

  it('pr:discovered links PR to Linear issue by title pattern', () => {
    const { bus, stores, relations } = setup();
    registerDiscoveryEffects(bus, stores, relations);

    bus.emit('pr:discovered', makePR({ title: 'Fix ENG-456 login bug' }));

    assert.equal(relations.prToLinear.has('acme/api#1', 'ENG-456'), true);
  });

  it('pr:discovered links PR to Linear issue by headRef pattern', () => {
    const { bus, stores, relations } = setup();
    registerDiscoveryEffects(bus, stores, relations);

    bus.emit('pr:discovered', makePR({ headRef: 'feat/ENG-789-stuff' }));

    assert.equal(relations.prToLinear.has('acme/api#1', 'ENG-789'), true);
  });

  it('branch:discovered links branch to Linear issue by name pattern', () => {
    const { bus, stores, relations } = setup();
    registerDiscoveryEffects(bus, stores, relations);

    bus.emit('branch:discovered', { name: 'feat/ENG-123-auth', isRemote: false, isCurrent: false });

    assert.equal(relations.branchToLinear.has('feat/ENG-123-auth', 'ENG-123'), true);
  });

  it('branch:discovered does NOT link when no pattern matches', () => {
    const { bus, stores, relations } = setup();
    registerDiscoveryEffects(bus, stores, relations);

    bus.emit('branch:discovered', { name: 'main', isRemote: false, isCurrent: true });

    assert.deepEqual(relations.branchToLinear.get('main'), new Set());
  });

  it('linear:attachment:discovered links PR to Linear issue by URL', () => {
    const { bus, stores, relations } = setup();
    stores.prs.set(makePR());
    registerDiscoveryEffects(bus, stores, relations);

    bus.emit('linear:attachment:discovered', {
      prUrl: 'https://github.com/acme/api/pull/1',
      issueIdentifier: 'ENG-999',
    });

    assert.equal(relations.prToLinear.has('acme/api#1', 'ENG-999'), true);
  });

  it('checkout:discovered links checkout to branch by currentBranch', () => {
    const { bus, stores, relations } = setup();
    stores.branches.set({ name: 'feat/auth', isRemote: false, isCurrent: false });
    registerDiscoveryEffects(bus, stores, relations);

    bus.emit('checkout:discovered', {
      path: '/repos/api', remoteUrl: 'git@github.com:acme/api.git',
      repoId: 'acme/api', currentBranch: 'feat/auth',
      isWorktree: false, parentCheckoutKey: null,
    });

    assert.equal(relations.checkoutToBranch.has('/repos/api', 'feat/auth'), true);
  });

  it('checkout:discovered links checkout to PRs by repoId match', () => {
    const { bus, stores, relations } = setup();
    stores.prs.set(makePR());
    registerDiscoveryEffects(bus, stores, relations);

    bus.emit('checkout:discovered', {
      path: '/repos/api', remoteUrl: 'git@github.com:acme/api.git',
      repoId: 'acme/api', currentBranch: 'main',
      isWorktree: false, parentCheckoutKey: null,
    });

    assert.equal(relations.checkoutToPr.has('/repos/api', 'acme/api#1'), true);
  });
});

describe('Relation Effects', () => {
  it('emits linear:issue:fetch when prToLinear target is not in store', () => {
    const { bus, stores, relations } = setup();
    registerRelationEffects(bus, stores);
    const fetches: DataEventMap['linear:issue:fetch'][] = [];
    bus.on('linear:issue:fetch', (p) => fetches.push(p));

    // This triggers relation:created internally
    relations.link('prToLinear', 'acme/api#1', 'ENG-123');

    assert.equal(fetches.length, 1);
    assert.deepEqual(fetches[0], { identifier: 'ENG-123' });
  });

  it('does NOT emit fetch when target already exists in store', () => {
    const { bus, stores, relations } = setup();
    stores.linearIssues.set({
      id: 'li1', identifier: 'ENG-123', title: 'Auth',
      status: 'Done', priority: 1, assignee: null,
      url: 'https://linear.app/eng/ENG-123', teamKey: 'ENG',
    });
    registerRelationEffects(bus, stores);
    const fetches: DataEventMap['linear:issue:fetch'][] = [];
    bus.on('linear:issue:fetch', (p) => fetches.push(p));

    relations.link('prToLinear', 'acme/api#1', 'ENG-123');

    assert.equal(fetches.length, 0);
  });

  it('emits pr:fetchDetail when branchToPr target is not in store', () => {
    const { bus, stores, relations } = setup();
    registerRelationEffects(bus, stores);
    const fetches: DataEventMap['pr:fetchDetail'][] = [];
    bus.on('pr:fetchDetail', (p) => fetches.push(p));

    relations.link('branchToPr', 'feat/auth', 'acme/api#42');

    assert.equal(fetches.length, 1);
    assert.deepEqual(fetches[0], { repoId: 'acme/api', number: 42 });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/git-switchboard && bun test src/data/effects.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// effects.ts
import type { EventBus } from './event-bus.js';
import type { DataEventMap } from './events.js';
import type { PR, LocalCheckout } from './entities.js';
import { prKey } from './entities.js';
import type { Relations, Stores } from './relations.js';
import { parseLinearIssueId } from '../linear.js';

/**
 * Discovery effects: listen to discovered events, parse for cross-references, create relations.
 * Returns a cleanup function that removes all listeners.
 */
export function registerDiscoveryEffects(
  bus: EventBus<DataEventMap>,
  stores: Stores,
  relations: Relations,
): () => void {
  const unsubs: (() => void)[] = [];

  // PR discovered → link to branch by headRef, link to Linear by pattern in title/headRef
  unsubs.push(
    bus.on('pr:discovered', (pr) => {
      const key = prKey(pr);

      // Link PR to its branch
      if (stores.branches.has(pr.headRef)) {
        relations.link('branchToPr', pr.headRef, key);
      }

      // Parse headRef for Linear issue pattern
      const headRefIssue = parseLinearIssueId(pr.headRef);
      if (headRefIssue) {
        relations.link('prToLinear', key, headRefIssue);
      }

      // Parse title for Linear issue pattern
      const titleIssue = parseLinearIssueId(pr.title);
      if (titleIssue && titleIssue !== headRefIssue) {
        relations.link('prToLinear', key, titleIssue);
      }

      // Link to checkouts by repoId match
      for (const checkout of stores.checkouts.values()) {
        if (checkout.repoId === pr.repoId || checkout.repoId === pr.forkRepoId) {
          relations.link('checkoutToPr', checkout.path, key);
        }
      }
    }),
  );

  // Branch discovered → link to Linear by name pattern, link to existing PRs
  unsubs.push(
    bus.on('branch:discovered', (branch) => {
      const issueId = parseLinearIssueId(branch.name);
      if (issueId) {
        relations.link('branchToLinear', branch.name, issueId);
      }

      // Link to PRs whose headRef matches
      for (const pr of stores.prs.values()) {
        if (pr.headRef === branch.name) {
          relations.link('branchToPr', branch.name, prKey(pr));
        }
      }
    }),
  );

  // Linear issue discovered → link to branches/PRs that reference it
  unsubs.push(
    bus.on('linear:issue:discovered', (issue) => {
      for (const branch of stores.branches.values()) {
        const parsed = parseLinearIssueId(branch.name);
        if (parsed === issue.identifier) {
          relations.link('branchToLinear', branch.name, issue.identifier);
        }
      }
      for (const pr of stores.prs.values()) {
        const headRefIssue = parseLinearIssueId(pr.headRef);
        const titleIssue = parseLinearIssueId(pr.title);
        if (headRefIssue === issue.identifier || titleIssue === issue.identifier) {
          relations.link('prToLinear', prKey(pr), issue.identifier);
        }
      }
    }),
  );

  // Linear attachment discovered → link PR URL to Linear issue
  unsubs.push(
    bus.on('linear:attachment:discovered', ({ prUrl, issueIdentifier }) => {
      // Find PR by URL
      for (const pr of stores.prs.values()) {
        if (pr.url === prUrl) {
          relations.link('prToLinear', prKey(pr), issueIdentifier);
          break;
        }
      }
    }),
  );

  // Checkout discovered → link to branches and PRs
  unsubs.push(
    bus.on('checkout:discovered', (checkout) => {
      // Link to current branch
      if (stores.branches.has(checkout.currentBranch)) {
        relations.link('checkoutToBranch', checkout.path, checkout.currentBranch);
      }

      // Link to PRs by repoId match
      if (checkout.repoId) {
        for (const pr of stores.prs.values()) {
          if (pr.repoId === checkout.repoId || pr.forkRepoId === checkout.repoId) {
            relations.link('checkoutToPr', checkout.path, prKey(pr));
          }
        }
      }
    }),
  );

  return () => unsubs.forEach((fn) => fn());
}

/**
 * Relation effects: when a relation is created, check if the target entity exists.
 * If not, emit the appropriate fetch command.
 */
export function registerRelationEffects(
  bus: EventBus<DataEventMap>,
  stores: Stores,
): () => void {
  return bus.on('relation:created', ({ type, sourceKey, targetKey }) => {
    switch (type) {
      case 'prToLinear':
      case 'branchToLinear': {
        if (!stores.linearIssues.has(targetKey)) {
          bus.emit('linear:issue:fetch', { identifier: targetKey });
        }
        break;
      }
      case 'branchToPr': {
        if (!stores.prs.has(targetKey)) {
          const [repoId, numStr] = targetKey.split('#');
          const number = parseInt(numStr, 10);
          if (repoId && !isNaN(number)) {
            bus.emit('pr:fetchDetail', { repoId, number });
          }
        }
        break;
      }
      // checkoutToPr and checkoutToBranch — these are created from data
      // we already have, so the target always exists. No fetch needed.
    }
  });
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/git-switchboard && bun test src/data/effects.test.ts`
Expected: All 10 tests PASS

**Step 5: Run typecheck**

Run: `cd packages/git-switchboard && npx tsc --noEmit`
Expected: No type errors

**Step 6: Commit**

```bash
git add packages/git-switchboard/src/data/effects.ts packages/git-switchboard/src/data/effects.test.ts
git commit -m "feat(data): add discovery and relation effects"
```

---

### Task 7: Data Layer Wiring (index.ts)

Wire everything together: create the singleton instances, register effects, and export the public `DataLayer` API.

**Files:**
- Create: `packages/git-switchboard/src/data/index.ts`
- Test: `packages/git-switchboard/src/data/index.test.ts`

**Step 1: Write the failing tests**

Test the full wiring — ingest data, verify relations form, verify fetch commands fire for missing entities.

```typescript
// index.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDataLayer } from './index.js';
import type { PR, LinearIssue, Branch, LocalCheckout } from './entities.js';
import type { DataEventMap } from './events.js';

function makePR(overrides: Partial<PR> = {}): PR {
  return {
    nodeId: 'PR_1', number: 1, title: 'Test PR', state: 'OPEN',
    draft: false, repoOwner: 'acme', repoName: 'api', repoId: 'acme/api',
    forkRepoId: null, headRef: 'feat/ENG-123-auth',
    url: 'https://github.com/acme/api/pull/1',
    author: 'dev', role: 'author', updatedAt: '2026-04-08T00:00:00Z',
    ...overrides,
  };
}

describe('DataLayer integration', () => {
  it('ingesting a PR with a Linear pattern in headRef creates prToLinear relation', () => {
    const layer = createDataLayer();

    layer.ingest.ingestPRs([makePR()]);

    const issues = layer.query.linearIssuesForPr('acme/api#1');
    // Issue not in store yet, but relation exists
    assert.equal(layer.relations.prToLinear.has('acme/api#1', 'ENG-123'), true);
  });

  it('relation:created for missing Linear issue triggers linear:issue:fetch', () => {
    const layer = createDataLayer();
    const fetches: DataEventMap['linear:issue:fetch'][] = [];
    layer.bus.on('linear:issue:fetch', (p) => fetches.push(p));

    layer.ingest.ingestPRs([makePR()]);

    assert.equal(fetches.length, 1);
    assert.deepEqual(fetches[0], { identifier: 'ENG-123' });
  });

  it('no fetch emitted when Linear issue already in store', () => {
    const layer = createDataLayer();
    const fetches: DataEventMap['linear:issue:fetch'][] = [];

    // Pre-populate Linear issue
    layer.ingest.ingestLinearData({
      issues: [{
        id: 'li1', identifier: 'ENG-123', title: 'Auth',
        status: 'In Progress', priority: 1, assignee: null,
        url: 'https://linear.app/eng/ENG-123', teamKey: 'ENG',
      }],
      attachments: [],
    });

    layer.bus.on('linear:issue:fetch', (p) => fetches.push(p));
    layer.ingest.ingestPRs([makePR()]);

    assert.equal(fetches.length, 0);
  });

  it('query resolves across entity stores and relations', () => {
    const layer = createDataLayer();

    layer.ingest.ingestLinearData({
      issues: [{
        id: 'li1', identifier: 'ENG-123', title: 'Auth',
        status: 'In Progress', priority: 1, assignee: null,
        url: 'https://linear.app/eng/ENG-123', teamKey: 'ENG',
      }],
      attachments: [],
    });
    layer.ingest.ingestPRs([makePR()]);

    const issues = layer.query.linearIssuesForPr('acme/api#1');
    assert.equal(issues.length, 1);
    assert.equal(issues[0].identifier, 'ENG-123');
  });

  it('destroy() stops all effects', () => {
    const layer = createDataLayer();
    const fetches: DataEventMap['linear:issue:fetch'][] = [];
    layer.bus.on('linear:issue:fetch', (p) => fetches.push(p));

    layer.destroy();
    layer.ingest.ingestPRs([makePR()]);

    // Effects are unregistered — no fetch emitted
    // (relation still won't be created because discovery effects are gone)
    assert.equal(fetches.length, 0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/git-switchboard && bun test src/data/index.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// index.ts
import { createEventBus } from './event-bus.js';
import { createEntityStore } from './entity-store.js';
import { createRelations, createQueryAPI } from './relations.js';
import { createIngester } from './ingest.js';
import { registerDiscoveryEffects, registerRelationEffects } from './effects.js';
import { prKey, linearKey, branchKey, checkoutKey } from './entities.js';
import type { EventBus } from './event-bus.js';
import type { DataEventMap } from './events.js';
import type { PR, LinearIssue, Branch, LocalCheckout } from './entities.js';
import type { EntityStore } from './entity-store.js';
import type { Relations, QueryAPI } from './relations.js';
import type { Ingester } from './ingest.js';

export interface DataLayer {
  bus: EventBus<DataEventMap>;
  stores: {
    prs: EntityStore<PR>;
    linearIssues: EntityStore<LinearIssue>;
    branches: EntityStore<Branch>;
    checkouts: EntityStore<LocalCheckout>;
  };
  relations: Relations;
  query: QueryAPI;
  ingest: Ingester;
  destroy(): void;
}

export function createDataLayer(): DataLayer {
  const bus = createEventBus<DataEventMap>();

  const stores = {
    prs: createEntityStore<PR>(prKey),
    linearIssues: createEntityStore<LinearIssue>(linearKey),
    branches: createEntityStore<Branch>(branchKey),
    checkouts: createEntityStore<LocalCheckout>(checkoutKey),
  };

  const relations = createRelations(bus);
  const query = createQueryAPI(stores, relations);
  const ingest = createIngester(bus, stores);

  const cleanupDiscovery = registerDiscoveryEffects(bus, stores, relations);
  const cleanupRelation = registerRelationEffects(bus, stores);

  function destroy(): void {
    cleanupDiscovery();
    cleanupRelation();
  }

  return { bus, stores, relations, query, ingest, destroy };
}

// Re-export key types for consumers
export type { DataEventMap, RelationType } from './events.js';
export type { PR, LinearIssue, Branch, LocalCheckout } from './entities.js';
export { prKey, linearKey, branchKey, checkoutKey } from './entities.js';
export type { EventBus } from './event-bus.js';
export type { EntityStore } from './entity-store.js';
export type { Relations, QueryAPI } from './relations.js';
export type { Ingester } from './ingest.js';
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/git-switchboard && bun test src/data/index.test.ts`
Expected: All 5 tests PASS

**Step 5: Run full test suite**

Run: `cd packages/git-switchboard && bun test src/data/`
Expected: All tests in all data/ files PASS

**Step 6: Commit**

```bash
git add packages/git-switchboard/src/data/index.ts packages/git-switchboard/src/data/index.test.ts
git commit -m "feat(data): wire up DataLayer with full event-driven pipeline"
```

---

### Task 8: Persistence Layer

Subscriber that writes entity stores and relations to disk. Two-phase hydration: silently populate stores, then emit discovery events.

**Files:**
- Create: `packages/git-switchboard/src/data/persistence.ts`
- Test: `packages/git-switchboard/src/data/persistence.test.ts`

**Step 1: Write the failing tests**

Test serialization/deserialization and the two-phase hydration logic. Use a temporary directory for cache files.

```typescript
// persistence.test.ts
import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDataLayer } from './index.js';
import { createPersistence } from './persistence.js';
import type { PR, LinearIssue } from './entities.js';
import type { DataEventMap } from './events.js';

function makePR(overrides: Partial<PR> = {}): PR {
  return {
    nodeId: 'PR_1', number: 1, title: 'Test PR', state: 'OPEN',
    draft: false, repoOwner: 'acme', repoName: 'api', repoId: 'acme/api',
    forkRepoId: null, headRef: 'feat/ENG-123-auth',
    url: 'https://github.com/acme/api/pull/1',
    author: 'dev', role: 'author', updatedAt: '2026-04-08T00:00:00Z',
    ...overrides,
  };
}

describe('Persistence', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'gsb-test-'));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true });
  });

  it('persist() writes data, hydrate() restores it to a new layer', async () => {
    // Layer 1: ingest data, persist
    const layer1 = createDataLayer();
    const persistence1 = createPersistence(layer1.bus, layer1.stores, layer1.relations, cacheDir);

    layer1.ingest.ingestLinearData({
      issues: [{
        id: 'li1', identifier: 'ENG-123', title: 'Auth',
        status: 'In Progress', priority: 1, assignee: null,
        url: 'https://linear.app/eng/ENG-123', teamKey: 'ENG',
      }],
      attachments: [],
    });
    layer1.ingest.ingestPRs([makePR()]);
    await persistence1.persist();

    // Layer 2: hydrate from disk
    const layer2 = createDataLayer();
    layer2.destroy(); // Remove effects so we can test hydration in isolation
    const persistence2 = createPersistence(layer2.bus, layer2.stores, layer2.relations, cacheDir);
    await persistence2.hydrate();

    assert.equal(layer2.stores.prs.has('acme/api#1'), true);
    assert.equal(layer2.stores.linearIssues.has('ENG-123'), true);
  });

  it('hydration does NOT trigger fetch commands for existing entities', async () => {
    // Layer 1: build up relations between PR and Linear
    const layer1 = createDataLayer();
    const persistence1 = createPersistence(layer1.bus, layer1.stores, layer1.relations, cacheDir);

    layer1.ingest.ingestLinearData({
      issues: [{
        id: 'li1', identifier: 'ENG-123', title: 'Auth',
        status: 'Done', priority: 1, assignee: null,
        url: 'https://linear.app/eng/ENG-123', teamKey: 'ENG',
      }],
      attachments: [],
    });
    layer1.ingest.ingestPRs([makePR()]);
    await persistence1.persist();

    // Layer 2: hydrate with effects active
    const layer2 = createDataLayer();
    const fetches: DataEventMap['linear:issue:fetch'][] = [];
    layer2.bus.on('linear:issue:fetch', (p) => fetches.push(p));
    const persistence2 = createPersistence(layer2.bus, layer2.stores, layer2.relations, cacheDir);
    await persistence2.hydrate();

    // Both sides exist — no fetch should fire
    assert.equal(fetches.length, 0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/git-switchboard && bun test src/data/persistence.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// persistence.ts
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { EventBus } from './event-bus.js';
import type { DataEventMap } from './events.js';
import type { PR, LinearIssue, Branch, LocalCheckout } from './entities.js';
import { prKey, linearKey, branchKey, checkoutKey } from './entities.js';
import type { EntityStore } from './entity-store.js';
import type { Relations } from './relations.js';

interface Stores {
  prs: EntityStore<PR>;
  linearIssues: EntityStore<LinearIssue>;
  branches: EntityStore<Branch>;
  checkouts: EntityStore<LocalCheckout>;
}

interface CachePayload {
  version: 1;
  prs: PR[];
  linearIssues: LinearIssue[];
  branches: Branch[];
  checkouts: LocalCheckout[];
  relations: {
    prToLinear: [string, string[]][];
    branchToPr: [string, string[]][];
    branchToLinear: [string, string[]][];
    checkoutToPr: [string, string[]][];
    checkoutToBranch: [string, string[]][];
  };
}

export interface Persistence {
  persist(): Promise<void>;
  hydrate(): Promise<void>;
}

const CACHE_FILE = 'data-layer.json';

export function createPersistence(
  bus: EventBus<DataEventMap>,
  stores: Stores,
  relations: Relations,
  cacheDir: string,
): Persistence {
  const cachePath = join(cacheDir, CACHE_FILE);

  function serializeRelationMap(map: { entries(): Iterable<[string, Set<string>]> }): [string, string[]][] {
    const result: [string, string[]][] = [];
    for (const [key, set] of map.entries()) {
      result.push([key, [...set]]);
    }
    return result;
  }

  async function persist(): Promise<void> {
    const payload: CachePayload = {
      version: 1,
      prs: stores.prs.getAll(),
      linearIssues: stores.linearIssues.getAll(),
      branches: stores.branches.getAll(),
      checkouts: stores.checkouts.getAll(),
      relations: {
        prToLinear: serializeRelationMap(relations.prToLinear),
        branchToPr: serializeRelationMap(relations.branchToPr),
        branchToLinear: serializeRelationMap(relations.branchToLinear),
        checkoutToPr: serializeRelationMap(relations.checkoutToPr),
        checkoutToBranch: serializeRelationMap(relations.checkoutToBranch),
      },
    };

    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, JSON.stringify(payload));
  }

  async function hydrate(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(cachePath, 'utf-8');
    } catch {
      return; // No cache file — nothing to hydrate
    }

    const payload: CachePayload = JSON.parse(raw);
    if (payload.version !== 1) return;

    // Phase 1: Silent populate — fill stores and relations without emitting events
    for (const pr of payload.prs) {
      stores.prs.setByKey(prKey(pr), pr);
    }
    for (const issue of payload.linearIssues) {
      stores.linearIssues.setByKey(linearKey(issue), issue);
    }
    for (const branch of payload.branches) {
      stores.branches.setByKey(branchKey(branch), branch);
    }
    for (const checkout of payload.checkouts) {
      stores.checkouts.setByKey(checkoutKey(checkout), checkout);
    }

    // Restore relations silently (no events)
    for (const [source, targets] of payload.relations.prToLinear) {
      for (const target of targets) {
        relations.prToLinear.add(source, target);
        relations.linearToPr.add(target, source);
      }
    }
    for (const [source, targets] of payload.relations.branchToPr) {
      for (const target of targets) {
        relations.branchToPr.add(source, target);
        relations.prToBranch.add(target, source);
      }
    }
    for (const [source, targets] of payload.relations.branchToLinear) {
      for (const target of targets) {
        relations.branchToLinear.add(source, target);
        relations.linearToBranch.add(target, source);
      }
    }
    for (const [source, targets] of payload.relations.checkoutToPr) {
      for (const target of targets) {
        relations.checkoutToPr.add(source, target);
        relations.prToCheckout.add(target, source);
      }
    }
    for (const [source, targets] of payload.relations.checkoutToBranch) {
      for (const target of targets) {
        relations.checkoutToBranch.add(source, target);
        relations.branchToCheckout.add(target, source);
      }
    }

    // Phase 2: Emit discovery events — all entities are in stores now,
    // so relation effects will see targets as present and skip fetches
    for (const pr of payload.prs) {
      bus.emit('pr:discovered', pr);
    }
    for (const issue of payload.linearIssues) {
      bus.emit('linear:issue:discovered', issue);
    }
    for (const branch of payload.branches) {
      bus.emit('branch:discovered', branch);
    }
    for (const checkout of payload.checkouts) {
      bus.emit('checkout:discovered', checkout);
    }
  }

  return { persist, hydrate };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/git-switchboard && bun test src/data/persistence.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/git-switchboard/src/data/persistence.ts packages/git-switchboard/src/data/persistence.test.ts
git commit -m "feat(data): add persistence with two-phase hydration"
```

---

### Task 9: Fetch Listeners — GitHub

Thin listeners that subscribe to `pr:fetch` and `pr:fetchDetail` command events, batch requests, call existing GitHub API functions, and funnel results through ingestion.

**Files:**
- Create: `packages/git-switchboard/src/data/fetchers/github.ts`
- Test: `packages/git-switchboard/src/data/fetchers/github.test.ts`

**Step 1: Write the failing tests**

Test that fetch commands are batched and that results are ingested. Use mock API functions.

```typescript
// fetchers/github.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDataLayer } from '../index.js';
import { createGithubFetcher } from './github.js';
import type { PR } from '../entities.js';
import type { DataEventMap } from '../events.js';
import type { CIInfo, ReviewInfo, MergeableStatus } from '../../types.js';

function makePR(overrides: Partial<PR> = {}): PR {
  return {
    nodeId: 'PR_1', number: 1, title: 'Test', state: 'OPEN',
    draft: false, repoOwner: 'acme', repoName: 'api', repoId: 'acme/api',
    forkRepoId: null, headRef: 'main',
    url: 'https://github.com/acme/api/pull/1',
    author: 'dev', role: 'author', updatedAt: '2026-04-08T00:00:00Z',
    ...overrides,
  };
}

describe('GitHub Fetch Listener', () => {
  it('pr:fetchDetail batches multiple requests', async () => {
    const layer = createDataLayer();
    const batchCalls: PR[][] = [];

    // Pre-populate PRs so the fetcher can find them
    layer.ingest.ingestPRs([
      makePR({ number: 1, nodeId: 'PR_1' }),
      makePR({ number: 2, nodeId: 'PR_2', url: 'https://github.com/acme/api/pull/2' }),
    ]);

    const cleanup = createGithubFetcher(layer.bus, layer.ingest, layer.stores, {
      fetchPRDetailsBatch: async (prs) => {
        batchCalls.push(prs);
        const result = new Map<string, { ci: CIInfo; review: ReviewInfo; mergeable: MergeableStatus }>();
        for (const pr of prs) {
          result.set(`${pr.repoId}#${pr.number}`, {
            ci: { status: 'passing', checks: [], fetchedAt: Date.now() },
            review: { status: 'approved', reviewers: [], fetchedAt: Date.now() },
            mergeable: 'MERGEABLE',
          });
        }
        return result;
      },
      batchDelayMs: 10,
    });

    // Emit two fetch commands rapidly
    layer.bus.emit('pr:fetchDetail', { repoId: 'acme/api', number: 1 });
    layer.bus.emit('pr:fetchDetail', { repoId: 'acme/api', number: 2 });

    // Wait for batch to process
    await new Promise((r) => setTimeout(r, 50));

    // Should have been batched into a single call
    assert.equal(batchCalls.length, 1);
    assert.equal(batchCalls[0].length, 2);

    // PR should now have CI data
    const pr = layer.stores.prs.get('acme/api#1');
    assert.equal(pr?.ci?.status, 'passing');

    cleanup();
  });

  it('deduplicates concurrent fetch requests for same PR', async () => {
    const layer = createDataLayer();
    let callCount = 0;

    layer.ingest.ingestPRs([makePR()]);

    const cleanup = createGithubFetcher(layer.bus, layer.ingest, layer.stores, {
      fetchPRDetailsBatch: async (prs) => {
        callCount++;
        const result = new Map();
        for (const pr of prs) {
          result.set(`${pr.repoId}#${pr.number}`, {
            ci: { status: 'passing', checks: [], fetchedAt: Date.now() },
            review: { status: 'approved', reviewers: [], fetchedAt: Date.now() },
            mergeable: 'MERGEABLE',
          });
        }
        return result;
      },
      batchDelayMs: 10,
    });

    // Same PR fetched multiple times
    layer.bus.emit('pr:fetchDetail', { repoId: 'acme/api', number: 1 });
    layer.bus.emit('pr:fetchDetail', { repoId: 'acme/api', number: 1 });
    layer.bus.emit('pr:fetchDetail', { repoId: 'acme/api', number: 1 });

    await new Promise((r) => setTimeout(r, 50));

    assert.equal(callCount, 1);
    cleanup();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/git-switchboard && bun test src/data/fetchers/github.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// fetchers/github.ts
import type { EventBus } from '../event-bus.js';
import type { DataEventMap } from '../events.js';
import type { PR } from '../entities.js';
import type { Ingester } from '../ingest.js';
import type { EntityStore } from '../entity-store.js';
import type { CIInfo, ReviewInfo, MergeableStatus } from '../../types.js';

interface GithubFetcherDeps {
  fetchPRDetailsBatch: (
    prs: PR[],
  ) => Promise<Map<string, { ci: CIInfo; review: ReviewInfo; mergeable: MergeableStatus }>>;
  batchDelayMs?: number;
}

interface Stores {
  prs: EntityStore<PR>;
}

export function createGithubFetcher(
  bus: EventBus<DataEventMap>,
  ingester: Ingester,
  stores: Stores,
  deps: GithubFetcherDeps,
): () => void {
  const batchDelay = deps.batchDelayMs ?? 50;
  const pendingDetails = new Map<string, { repoId: string; number: number }>();
  let detailTimer: ReturnType<typeof setTimeout> | null = null;

  async function flushDetailBatch(): Promise<void> {
    const batch = new Map(pendingDetails);
    pendingDetails.clear();
    detailTimer = null;

    // Resolve full PR objects from store for the batch query
    const prsToFetch: PR[] = [];
    for (const [key, { repoId, number }] of batch) {
      const pr = stores.prs.get(key);
      if (pr) prsToFetch.push(pr);
    }

    if (prsToFetch.length === 0) return;

    try {
      const results = await deps.fetchPRDetailsBatch(prsToFetch);

      // Re-ingest PRs with enrichment data
      const enriched: PR[] = [];
      for (const [key, details] of results) {
        const existing = stores.prs.get(key);
        if (existing) {
          enriched.push({
            ...existing,
            ci: details.ci,
            review: details.review,
            mergeable: details.mergeable,
          });
        }
      }

      if (enriched.length > 0) {
        ingester.ingestPRs(enriched);
      }
    } catch {
      // Fetch failed — items can be re-requested later
    }
  }

  const unsubDetail = bus.on('pr:fetchDetail', ({ repoId, number }) => {
    const key = `${repoId}#${number}`;
    if (pendingDetails.has(key)) return;
    pendingDetails.set(key, { repoId, number });

    if (!detailTimer) {
      detailTimer = setTimeout(flushDetailBatch, batchDelay);
    }
  });

  return () => {
    unsubDetail();
    if (detailTimer) clearTimeout(detailTimer);
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/git-switchboard && bun test src/data/fetchers/github.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/git-switchboard/src/data/fetchers/github.ts packages/git-switchboard/src/data/fetchers/github.test.ts
git commit -m "feat(data): add GitHub fetch listener with batching"
```

---

### Task 10: Fetch Listeners — Linear

Subscribes to `linear:issue:fetch`, batches requests, calls existing Linear API, ingests results.

**Files:**
- Create: `packages/git-switchboard/src/data/fetchers/linear.ts`
- Test: `packages/git-switchboard/src/data/fetchers/linear.test.ts`

**Step 1: Write the failing tests**

```typescript
// fetchers/linear.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDataLayer } from '../index.js';
import { createLinearFetcher } from './linear.js';
import type { LinearIssue } from '../entities.js';

describe('Linear Fetch Listener', () => {
  it('batches multiple linear:issue:fetch into one call', async () => {
    const layer = createDataLayer();
    const fetchedIds: string[][] = [];

    const cleanup = createLinearFetcher(layer.bus, layer.ingest, {
      fetchIssuesByIdentifier: async (identifiers) => {
        fetchedIds.push([...identifiers]);
        return identifiers.map((id) => ({
          id: `li-${id}`, identifier: id, title: `Issue ${id}`,
          status: 'In Progress', priority: 1, assignee: null,
          url: `https://linear.app/eng/${id}`, teamKey: id.split('-')[0],
        }));
      },
      batchDelayMs: 10,
    });

    layer.bus.emit('linear:issue:fetch', { identifier: 'ENG-1' });
    layer.bus.emit('linear:issue:fetch', { identifier: 'ENG-2' });
    layer.bus.emit('linear:issue:fetch', { identifier: 'ENG-3' });

    await new Promise((r) => setTimeout(r, 50));

    assert.equal(fetchedIds.length, 1);
    assert.deepEqual(fetchedIds[0].sort(), ['ENG-1', 'ENG-2', 'ENG-3']);

    // Issues should be in the store
    assert.equal(layer.stores.linearIssues.has('ENG-1'), true);
    assert.equal(layer.stores.linearIssues.has('ENG-2'), true);

    cleanup();
  });

  it('deduplicates same identifier in batch window', async () => {
    const layer = createDataLayer();
    let batchSize = 0;

    const cleanup = createLinearFetcher(layer.bus, layer.ingest, {
      fetchIssuesByIdentifier: async (identifiers) => {
        batchSize = identifiers.length;
        return identifiers.map((id) => ({
          id: `li-${id}`, identifier: id, title: `Issue ${id}`,
          status: 'Done', priority: 1, assignee: null,
          url: `https://linear.app/eng/${id}`, teamKey: 'ENG',
        }));
      },
      batchDelayMs: 10,
    });

    layer.bus.emit('linear:issue:fetch', { identifier: 'ENG-1' });
    layer.bus.emit('linear:issue:fetch', { identifier: 'ENG-1' });

    await new Promise((r) => setTimeout(r, 50));

    assert.equal(batchSize, 1);
    cleanup();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/git-switchboard && bun test src/data/fetchers/linear.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// fetchers/linear.ts
import type { EventBus } from '../event-bus.js';
import type { DataEventMap } from '../events.js';
import type { LinearIssue } from '../entities.js';
import type { Ingester } from '../ingest.js';

interface LinearFetcherDeps {
  fetchIssuesByIdentifier: (identifiers: string[]) => Promise<LinearIssue[]>;
  batchDelayMs?: number;
}

export function createLinearFetcher(
  bus: EventBus<DataEventMap>,
  ingester: Ingester,
  deps: LinearFetcherDeps,
): () => void {
  const batchDelay = deps.batchDelayMs ?? 50;
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function flush(): Promise<void> {
    const identifiers = [...pending];
    pending.clear();
    timer = null;

    if (identifiers.length === 0) return;

    try {
      const issues = await deps.fetchIssuesByIdentifier(identifiers);
      if (issues.length > 0) {
        ingester.ingestLinearData({ issues, attachments: [] });
      }
    } catch {
      // Fetch failed — items can be re-requested later
    }
  }

  const unsub = bus.on('linear:issue:fetch', ({ identifier }) => {
    if (pending.has(identifier)) return;
    pending.add(identifier);

    if (!timer) {
      timer = setTimeout(flush, batchDelay);
    }
  });

  return () => {
    unsub();
    if (timer) clearTimeout(timer);
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/git-switchboard && bun test src/data/fetchers/linear.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/git-switchboard/src/data/fetchers/linear.ts packages/git-switchboard/src/data/fetchers/linear.test.ts
git commit -m "feat(data): add Linear fetch listener with batching"
```

---

### Task 11: Full Data Layer Test Suite & Typecheck

Run all tests together and ensure typecheck passes. Fix any issues.

**Step 1: Run the full data layer test suite**

Run: `cd packages/git-switchboard && bun test src/data/`
Expected: All tests across all files PASS

**Step 2: Run typecheck**

Run: `cd packages/git-switchboard && npx tsc --noEmit`
Expected: No type errors

**Step 3: Fix any failures**

If tests or types fail, investigate and fix. Re-run until clean.

**Step 4: Run existing tests to check nothing is broken**

Run: `cd packages/git-switchboard && bun test`
Expected: All existing tests still pass alongside new ones

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(data): address test and type issues from full suite run"
```

Only commit if there were fixes needed. Skip if everything passed.

---

### Task 12: Update DataLayer index.ts with Persistence Wiring

Now wire persistence into `createDataLayer` so it's part of the standard setup.

**Files:**
- Modify: `packages/git-switchboard/src/data/index.ts`
- Update: `packages/git-switchboard/src/data/index.test.ts`

**Step 1: Update index.ts**

Add optional `cacheDir` to `createDataLayer` options. When provided, create persistence and expose `hydrate`/`persist` on the `DataLayer` interface.

```typescript
// Add to DataLayer interface:
export interface DataLayer {
  // ...existing...
  hydrate(): Promise<void>;
  persist(): Promise<void>;
}

// Add to createDataLayer:
export interface DataLayerOptions {
  cacheDir?: string;
}

export function createDataLayer(options: DataLayerOptions = {}): DataLayer {
  // ...existing bus, stores, relations, query, ingest, effects setup...

  let persistence: Persistence | null = null;
  if (options.cacheDir) {
    persistence = createPersistence(bus, stores, relations, options.cacheDir);
  }

  return {
    // ...existing...
    async hydrate() {
      await persistence?.hydrate();
    },
    async persist() {
      await persistence?.persist();
    },
  };
}
```

**Step 2: Run all data layer tests**

Run: `cd packages/git-switchboard && bun test src/data/`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/git-switchboard/src/data/index.ts packages/git-switchboard/src/data/index.test.ts
git commit -m "feat(data): wire persistence into DataLayer factory"
```

---

### Notes for Implementer

**Dependency on existing code:** The `effects.ts` module imports `parseLinearIssueId` from `../linear.ts` (line ~300 in `linear.ts`). Verify this function is exported. If not, add `export` to it.

**What is NOT in this plan (deferred to a follow-up):**
- Migrating `cli.ts` startup sequence to use the new data layer
- Migrating `store.ts` (Zustand) to sit on top of the data layer
- Migrating UI components to use `QueryAPI` instead of `linearCache`
- The `checkout:scan` fetch listener (depends on scanner refactoring)
- The `branch:fetch` fetch listener (branches come from local git, not an API)

These are separate tasks because they involve changing existing code that must continue working. The data layer is fully functional and testable in isolation first.

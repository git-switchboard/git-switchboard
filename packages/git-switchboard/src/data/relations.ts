import type { EventBus } from './event-bus.js';
import type { DataEventMap, RelationType } from './events.js';
import type { PR, LinearIssue, Branch, LocalCheckout, Stores } from './entities.js';
import type { EntityStore } from './entity-store.js';

export type { Stores };

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

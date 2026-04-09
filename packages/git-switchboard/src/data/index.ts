import { createEventBus } from './event-bus.js';
import { createEntityStore } from './entity-store.js';
import { createRelations, createQueryAPI } from './relations.js';
import { createIngester } from './ingest.js';
import { registerDiscoveryEffects, registerRelationEffects } from './effects.js';
import { createPersistence } from './persistence.js';
import { prKey, linearKey, branchKey, checkoutKey } from './entities.js';
import type { EventBus } from './event-bus.js';
import type { DataEventMap } from './events.js';
import type { PR, LinearIssue, Branch, LocalCheckout } from './entities.js';
import type { EntityStore } from './entity-store.js';
import type { Relations, QueryAPI } from './relations.js';
import type { Ingester } from './ingest.js';
import type { Persistence } from './persistence.js';

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
  hydrate(): Promise<void>;
  persist(): Promise<void>;
  destroy(): void;
}

export interface DataLayerOptions {
  cacheDir?: string;
}

export function createDataLayer(options: DataLayerOptions = {}): DataLayer {
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

  let persistence: Persistence | null = null;
  if (options.cacheDir) {
    persistence = createPersistence(bus, stores, relations, options.cacheDir);
  }

  function destroy(): void {
    cleanupDiscovery();
    cleanupRelation();
  }

  return {
    bus, stores, relations, query, ingest, destroy,
    async hydrate() {
      await persistence?.hydrate();
    },
    async persist() {
      await persistence?.persist();
    },
  };
}

// Re-export key types for consumers
export type { DataEventMap, RelationType } from './events.js';
export type { PR, LinearIssue, Branch, LocalCheckout } from './entities.js';
export { prKey, linearKey, branchKey, checkoutKey } from './entities.js';
export type { EventBus, HistoryEntry } from './event-bus.js';
export type { EntityStore } from './entity-store.js';
export type { Relations, QueryAPI } from './relations.js';
export type { Ingester } from './ingest.js';
export type { Persistence } from './persistence.js';

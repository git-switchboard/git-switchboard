import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { EventBus } from './event-bus.js';
import type { DataEventMap } from './events.js';
import type { PR, LinearIssue, Branch, LocalCheckout, Stores } from './entities.js';
import { prKey, linearKey, branchKey, checkoutKey } from './entities.js';
import type { Relations } from './relations.js';

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

    let payload: CachePayload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return; // Corrupted cache — treat as cache miss
    }
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

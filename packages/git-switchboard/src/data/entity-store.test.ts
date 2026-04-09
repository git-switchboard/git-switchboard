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
      [
        { id: 'a', value: 1 },
        { id: 'b', value: 2 },
      ],
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

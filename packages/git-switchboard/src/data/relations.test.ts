import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRelationMap, createRelations, createQueryAPI } from './relations.js';
import { createEventBus } from './event-bus.js';
import { createEntityStore } from './entity-store.js';
import type { DataEventMap } from './events.js';
import type { LinearIssue } from './entities.js';
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

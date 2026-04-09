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

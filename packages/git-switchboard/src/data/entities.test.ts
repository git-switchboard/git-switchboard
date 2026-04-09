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

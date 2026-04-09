import type { EventBus } from './event-bus.js';
import type { DataEventMap } from './events.js';
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

  // PR discovered -> link to branch by headRef, link to Linear by pattern in title/headRef
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

  // PR enriched -> parse body for Linear issue patterns (body only available after detail fetch)
  unsubs.push(
    bus.on('pr:enriched', (pr) => {
      if (!pr.body) return;
      const key = prKey(pr);
      const bodyIssue = parseLinearIssueId(pr.body);
      if (bodyIssue) {
        relations.link('prToLinear', key, bodyIssue);
      }
    }),
  );

  // Branch discovered -> link to Linear by name pattern, link to existing PRs
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

  // Linear issue discovered -> link to branches/PRs that reference it
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

  // Linear attachment discovered -> link PR URL to Linear issue
  unsubs.push(
    bus.on('linear:attachment:discovered', ({ prUrl, issueIdentifier }) => {
      for (const pr of stores.prs.values()) {
        if (pr.url === prUrl) {
          relations.link('prToLinear', prKey(pr), issueIdentifier);
          break;
        }
      }
    }),
  );

  // Checkout discovered -> link to branches and PRs
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
  return bus.on('relation:created', ({ type, targetKey }) => {
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
      // checkoutToPr and checkoutToBranch - targets are created from known data, no fetch needed.
    }
  });
}

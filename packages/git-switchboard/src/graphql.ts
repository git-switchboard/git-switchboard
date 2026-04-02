import { print, type DocumentNode } from 'graphql';
import { initGraphQLTada, type ResultOf, type VariablesOf } from 'gql.tada';
import type { Octokit } from '@octokit/rest';
import type { introspection } from './graphql-env.js';

export const graphql = initGraphQLTada<{
  introspection: introspection;
  scalars: {
    DateTime: string;
    URI: string;
    GitObjectID: string;
    HTML: string;
    Base64String: string;
    GitTimestamp: string;
    PreciseDateTime: string;
    Date: string;
    X509Certificate: string;
    BigInt: string;
  };
}>();

const printCache = new WeakMap<DocumentNode, string>();

/**
 * Execute a gql.tada typed query via octokit.
 * Bridges the gap: gql.tada produces DocumentNode, octokit wants string.
 * Result and variables are fully typed from the query definition.
 */
export async function execute<TDoc extends DocumentNode>(
  octokit: Octokit,
  query: TDoc,
  variables: VariablesOf<TDoc>
): Promise<ResultOf<TDoc>> {
  let queryStr = printCache.get(query);
  if (!queryStr) {
    queryStr = print(query);
    printCache.set(query, queryStr);
  }
  return octokit.graphql<ResultOf<TDoc>>(queryStr, variables as Record<string, unknown>);
}

export type { FragmentOf, ResultOf, VariablesOf } from 'gql.tada';
export { readFragment } from 'gql.tada';

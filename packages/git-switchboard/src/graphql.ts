import { print, type DocumentNode } from 'graphql';
import { initGraphQLTada } from 'gql.tada';
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

/** Cache of printed query strings to avoid re-printing on every call */
const printCache = new WeakMap<DocumentNode, string>();

/** Print a gql.tada DocumentNode to a query string, with caching */
export function printQuery(doc: DocumentNode): string {
  let str = printCache.get(doc);
  if (!str) {
    str = print(doc);
    printCache.set(doc, str);
  }
  return str;
}

export type { FragmentOf, ResultOf, VariablesOf } from 'gql.tada';
export { readFragment } from 'gql.tada';

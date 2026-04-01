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

export type { FragmentOf, ResultOf, VariablesOf } from 'gql.tada';
export { readFragment } from 'gql.tada';

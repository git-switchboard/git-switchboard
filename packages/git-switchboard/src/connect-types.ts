export type ConnectScreen =
  | { type: 'provider-list' }
  | { type: 'provider-detail'; providerName: string }
  | { type: 'setup'; providerName: string };

export interface HistoryEntry {
  timestamp: number;
  event: string;
  summary: string;
  payload: unknown;
}

export interface EventBus<TEventMap> {
  on<K extends keyof TEventMap>(
    event: K,
    handler: (payload: TEventMap[K]) => void
  ): () => void;
  off<K extends keyof TEventMap>(
    event: K,
    handler: (payload: TEventMap[K]) => void
  ): void;
  emit<K extends keyof TEventMap>(event: K, payload: TEventMap[K]): void;
  history: HistoryEntry[];
}

const MAX_HISTORY = 500;

function summarizePayload(payload: unknown): string {
  if (payload === null || payload === undefined) return '';
  if (typeof payload !== 'object') return String(payload);
  const obj = payload as Record<string, unknown>;
  // Pick the most identifying fields
  const parts: string[] = [];
  for (const key of ['source', 'message', 'identifier', 'repoId', 'number', 'name', 'path', 'type', 'sourceKey', 'targetKey', 'prUrl', 'issueIdentifier']) {
    if (key in obj && obj[key] != null) {
      parts.push(`${key}=${obj[key]}`);
    }
  }
  if (parts.length > 0) return parts.join(' ');
  // Fallback: show keys
  const keys = Object.keys(obj);
  return keys.length <= 3 ? keys.join(', ') : `${keys.slice(0, 3).join(', ')}...`;
}

export function createEventBus<
  TEventMap extends Record<string, unknown>,
>(): EventBus<TEventMap> {
  const listeners = new Map<
    keyof TEventMap,
    Set<(payload: unknown) => void>
  >();
  const history: HistoryEntry[] = [];

  return {
    history,

    on<K extends keyof TEventMap>(
      event: K,
      handler: (payload: TEventMap[K]) => void,
    ): () => void {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      const handlerSet = listeners.get(event)!;
      handlerSet.add(handler as (payload: unknown) => void);
      return () => {
        handlerSet.delete(handler as (payload: unknown) => void);
      };
    },

    off<K extends keyof TEventMap>(
      event: K,
      handler: (payload: TEventMap[K]) => void,
    ): void {
      listeners.get(event)?.delete(handler as (payload: unknown) => void);
    },

    emit<K extends keyof TEventMap>(event: K, payload: TEventMap[K]): void {
      history.push({
        timestamp: Date.now(),
        event: event as string,
        summary: summarizePayload(payload),
        payload,
      });
      if (history.length > MAX_HISTORY) {
        history.splice(0, history.length - MAX_HISTORY);
      }

      const handlerSet = listeners.get(event);
      if (!handlerSet) return;
      for (const handler of handlerSet) {
        handler(payload);
      }
    },
  };
}

export interface HistoryEntry {
  id: number;
  timestamp: number;
  event: string;
  summary: string;
  payload: unknown;
  /** ID of the event whose handler emitted this event, or null if top-level */
  causeId: number | null;
  /** Depth in the causality chain (0 = top-level) */
  depth: number;
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
  const parts: string[] = [];
  for (const key of ['source', 'message', 'identifier', 'repoId', 'number', 'name', 'path', 'type', 'sourceKey', 'targetKey', 'prUrl', 'issueIdentifier']) {
    if (key in obj && obj[key] != null) {
      parts.push(`${key}=${obj[key]}`);
    }
  }
  if (parts.length > 0) return parts.join(' ');
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

  // Causality tracking — when a handler emits during processing,
  // the child event records which event caused it
  let nextId = 0;
  let currentEventId: number | null = null;
  let currentDepth = 0;

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
      const id = nextId++;
      const causeId = currentEventId;
      const depth = currentDepth;

      history.push({
        id,
        timestamp: Date.now(),
        event: event as string,
        summary: summarizePayload(payload),
        payload,
        causeId,
        depth,
      });
      if (history.length > MAX_HISTORY) {
        history.splice(0, history.length - MAX_HISTORY);
      }

      const handlerSet = listeners.get(event);
      if (!handlerSet) return;

      // Set this event as the current cause for any emissions from handlers
      const previousEventId = currentEventId;
      const previousDepth = currentDepth;
      currentEventId = id;
      currentDepth = depth + 1;
      try {
        for (const handler of handlerSet) {
          handler(payload);
        }
      } finally {
        currentEventId = previousEventId;
        currentDepth = previousDepth;
      }
    },
  };
}

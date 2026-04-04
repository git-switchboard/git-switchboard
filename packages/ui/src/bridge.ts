/**
 * Bridge abstraction for host communication.
 *
 * The UI doesn't know or care whether it's running inside Electrobun,
 * an iframe on the docs site, or standalone. The bridge handles all
 * communication with the host environment.
 */

import type { IncomingMessage, OutgoingMessage } from './types.js';

export interface Bridge {
  /** Send a message to the host (Electrobun process / parent window) */
  send(msg: OutgoingMessage): void;
  /** Register a handler for messages from the host */
  onMessage(handler: (msg: IncomingMessage) => void): void;
}

// ─── Electrobun bridge ─────────────────────────────────────────
// Communicates via gsb:// URL navigation (outgoing) and
// window.__gsb_receive (incoming, called via executeJavascript).

class ElectrobunBridge implements Bridge {
  private _handler: ((msg: IncomingMessage) => void) | null = null;

  constructor() {
    // Electrobun bun process pushes messages by calling this global
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__gsb_receive = (msg: IncomingMessage) => {
      this._handler?.(msg);
    };
  }

  send(msg: OutgoingMessage): void {
    const payload = encodeURIComponent(JSON.stringify(msg));
    window.location.href = `gsb://msg?d=${payload}`;
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this._handler = handler;
  }
}

// ─── PostMessage bridge (iframe) ───────────────────────────────
// Communicates via window.parent.postMessage (outgoing) and
// window message events (incoming).

class PostMessageBridge implements Bridge {
  private _handler: ((msg: IncomingMessage) => void) | null = null;

  constructor() {
    window.addEventListener('message', (event: MessageEvent) => {
      // Only accept messages that look like ours
      if (event.data && typeof event.data === 'object' && 'type' in event.data) {
        this._handler?.(event.data as IncomingMessage);
      }
    });
  }

  send(msg: OutgoingMessage): void {
    window.parent.postMessage(msg, '*');
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this._handler = handler;
  }
}

// ─── Standalone bridge (dev / direct open) ─────────────────────
// Loads mock data locally — no external host needed.

class StandaloneBridge implements Bridge {
  private _handler: ((msg: IncomingMessage) => void) | null = null;

  send(msg: OutgoingMessage): void {
    // In standalone mode, actions just log + show toast
    console.log('[standalone]', msg.type, msg);
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this._handler = handler;
    // Send mock data on next tick so the handler is registered first
    queueMicrotask(async () => {
      const { getMockInitData } = await import('./mock-data.js');
      this._handler?.({ type: 'init', data: getMockInitData() });
    });
  }
}

// ─── Bridge detection ──────────────────────────────────────────

export type BridgeMode = 'electrobun' | 'iframe' | 'standalone';

export function detectMode(): BridgeMode {
  // URL param override for testing
  const params = new URLSearchParams(window.location.search);
  const forced = params.get('bridge');
  if (forced === 'electrobun' || forced === 'iframe' || forced === 'standalone') {
    return forced;
  }

  // Electrobun injects this before the page loads
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).__electrobun_mode) {
    return 'electrobun';
  }

  // If we're in an iframe, use postMessage
  if (window.parent !== window) {
    return 'iframe';
  }

  return 'standalone';
}

export function createBridge(mode?: BridgeMode): { bridge: Bridge; mode: BridgeMode } {
  const resolved = mode ?? detectMode();
  switch (resolved) {
    case 'electrobun':
      return { bridge: new ElectrobunBridge(), mode: resolved };
    case 'iframe':
      return { bridge: new PostMessageBridge(), mode: resolved };
    case 'standalone':
      return { bridge: new StandaloneBridge(), mode: resolved };
  }
}

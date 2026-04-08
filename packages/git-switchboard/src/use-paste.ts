import { useEffect } from 'react';
import { useRenderer } from '@opentui/react';
import { decodePasteBytes } from '@opentui/core';

/**
 * Subscribe to terminal paste events (bracketed paste mode).
 * The handler receives the pasted text as a string.
 *
 * For terminals without bracketed paste support, paste arrives as
 * rapid key events — text input handlers should also accept
 * multi-character key.raw strings to cover that case.
 */
export function usePaste(handler: (text: string) => void): void {
  const renderer = useRenderer();

  useEffect(() => {
    // Access the key handler via the renderer's internal event system.
    // The renderer emits stdin events including paste.
    const onPaste = (event: { bytes: Uint8Array }) => {
      const text = decodePasteBytes(event.bytes);
      if (text) handler(text);
    };

    // The CliRenderer's root renderable can receive paste events
    // via the key handler's event emitter. We listen on the stdin directly.
    const keyHandler = (renderer as unknown as { _keyHandler?: { on: (event: string, fn: (...args: unknown[]) => void) => void; off: (event: string, fn: (...args: unknown[]) => void) => void } })._keyHandler;
    if (keyHandler) {
      keyHandler.on('paste', onPaste as (...args: unknown[]) => void);
      return () => {
        keyHandler.off('paste', onPaste as (...args: unknown[]) => void);
      };
    }
  }, [renderer, handler]);
}

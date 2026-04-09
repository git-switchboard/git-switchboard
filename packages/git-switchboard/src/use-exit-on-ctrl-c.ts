import { useRenderer } from '@opentui/react';
import { useFocusedKeyboard } from './focus-stack.js';

/**
 * Exit the process on Ctrl+C.
 * Restores terminal state (alt screen, mouse tracking) before exiting.
 */
export function useExitOnCtrlC(): void {
  const renderer = useRenderer();

  useFocusedKeyboard((key) => {
    if (key.ctrl && key.name === 'c') {
      try {
        renderer.destroy();
      } catch {
        // yoga crash during teardown — ignore, we're exiting anyway
      }
      process.exit(0);
    }
  }, { global: true });
}

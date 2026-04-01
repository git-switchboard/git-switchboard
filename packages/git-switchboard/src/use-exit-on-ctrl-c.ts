import { useKeyboard } from '@opentui/react';

/**
 * Exit the process on Ctrl+C.
 * Needed because exitOnCtrlC is disabled on the renderer
 * to avoid yoga-layout WASM crashes during React unmount.
 */
export function useExitOnCtrlC(): void {
  useKeyboard((key) => {
    if (key.ctrl && key.name === 'c') {
      process.exit(0);
    }
  });
}

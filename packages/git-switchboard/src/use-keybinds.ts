import { useKeyboard } from '@opentui/react';
import type { Keybind, KeyMatcher } from './view.js';

export interface KeyInput {
  readonly name: string;
  readonly ctrl: boolean;
  readonly raw: string;
}

function matchesKey(matcher: KeyMatcher, key: KeyInput): boolean {
  if (typeof matcher === 'string') return key.name === matcher;
  if ('ctrl' in matcher) return key.ctrl && key.name === matcher.name;
  return key.raw === matcher.raw;
}

/**
 * Wire a view's keybind definitions to action handlers.
 *
 * Registers a `useKeyboard` handler that matches incoming key events against
 * each keybind's `keys` array and calls the corresponding handler.
 *
 * - Conditional keybinds are skipped unless their key is `true` in `options.show`.
 * - A handler returning `false` passes the event to the next matching keybind.
 * - Any other return value (including `void`) consumes the event.
 *
 * Because `useKeyboard` is LIFO, call `useKeybinds` BEFORE registering any
 * higher-priority `useKeyboard` handlers (e.g. text input modes) so those
 * fire first and can consume events before the keybinds see them.
 *
 * ```ts
 * useKeybinds(keybinds, {
 *   navigate: (key) => moveTo(key.name === 'up' || key.name === 'k' ? idx - 1 : idx + 1),
 *   quit: () => onExit(),
 * });
 *
 * // Registered after → fires first. Consumes events in input mode.
 * useKeyboard((key) => {
 *   if (inputMode) { handleInput(key); return true; }
 * });
 * ```
 */
export function useKeybinds<TKeybinds extends Record<string, Keybind>>(
  keybinds: TKeybinds,
  handlers: Partial<{ [K in keyof TKeybinds]: (event: KeyInput) => boolean | void }>,
  options?: { show?: Partial<Record<string, boolean>> }
): void {
  useKeyboard((key) => {
    const input: KeyInput = {
      name: key.name ?? '',
      ctrl: !!key.ctrl,
      raw: key.raw ?? '',
    };

    for (const [action, keybind] of Object.entries(keybinds)) {
      if (keybind.conditional && options?.show?.[action] !== true) continue;

      const matched = keybind.keys.some((m) => matchesKey(m, input));
      if (!matched) continue;

      const handler = handlers[action as keyof TKeybinds];
      if (!handler) continue;

      const result = handler(input);
      if (result !== false) return true;
    }
  });
}

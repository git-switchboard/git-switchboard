import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useKeyboard } from '@opentui/react';
import type { KeyEvent } from '@opentui/core';

// ─── Focus stack context ─────────────────────────────────────────────────────

interface FocusStackValue {
  readonly stack: readonly string[];
  push: (id: string) => void;
  pop: (id: string) => void;
}

const FocusStackCtx = createContext<FocusStackValue | null>(null);

export const FocusStackProvider = FocusStackCtx.Provider;

/**
 * Create the value for a `FocusStackProvider`.
 *
 * Call this once in the component that owns the provider (e.g. `TuiRouter`)
 * and pass the result as the context value.
 */
export function useFocusStackValue(): FocusStackValue {
  const [stack, setStack] = useState<string[]>([]);

  const push = useCallback((id: string) => {
    setStack((s) => [...s, id]);
  }, []);

  const pop = useCallback((id: string) => {
    setStack((s) => {
      if (s.length === 0 || s[s.length - 1] !== id) return s;
      return s.slice(0, -1);
    });
  }, []);

  return useMemo(() => ({ stack, push, pop }), [stack, push, pop]);
}

// ─── Consumer hooks ──────────────────────────────────────────────────────────

/** Read the focus stack. Throws if called outside a FocusStackProvider. */
export function useFocusStack(): FocusStackValue {
  const ctx = useContext(FocusStackCtx);
  if (!ctx) throw new Error('useFocusStack must be called inside a <FocusStackProvider>');
  return ctx;
}

/**
 * Declaratively own focus while `active` is true.
 *
 * Pushes `id` onto the stack when `active` flips to `true` and pops it when
 * `active` flips to `false` or the component unmounts.
 */
export function useFocusOwner(id: string, active: boolean): void {
  const { push, pop } = useFocusStack();
  useEffect(() => {
    if (active) push(id);
    return () => {
      if (active) pop(id);
    };
  }, [active, id, push, pop]);
}

// ─── Focus-aware keyboard hook ───────────────────────────────────────────────

interface FocusedKeyboardOptions {
  /** Only fire when this ID is on top of the focus stack. */
  focusId?: string;
  /** Always fire regardless of focus state (e.g. Ctrl+C handler). */
  global?: boolean;
}

/**
 * A focus-aware wrapper around `useKeyboard`.
 *
 * - No options → fires only when the focus stack is empty (default mode).
 * - `{ focusId }` → fires only when that ID is on top of the stack.
 * - `{ global: true }` → always fires.
 */
export function useFocusedKeyboard(
  handler: (key: KeyEvent) => boolean | void,
  options?: FocusedKeyboardOptions
): void {
  const ctx = useContext(FocusStackCtx);

  useKeyboard((key) => {
    // No provider (e.g. component outside TuiRouter) — always fire.
    if (!ctx) return handler(key);

    if (options?.global) return handler(key);

    const top = ctx.stack.length > 0 ? ctx.stack[ctx.stack.length - 1] : null;

    if (options?.focusId) {
      if (top !== options.focusId) return;
    } else {
      if (top !== null) return;
    }

    return handler(key);
  });
}

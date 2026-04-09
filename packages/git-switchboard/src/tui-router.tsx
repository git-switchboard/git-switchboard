import { useState, useCallback, useMemo, createContext, useContext } from 'react';
import type React from 'react';
import type { View } from './view.js';
import { FocusStackProvider, useFocusStackValue } from './focus-stack.js';

// ─── Internal navigation context ──────────────────────────────────────────────

interface NavigationCtxValue {
  navigate: (screen: { type: string; [k: string]: unknown }) => void;
  goBack: () => void;
  canGoBack: boolean;
}

const NavigationCtx = createContext<NavigationCtxValue | null>(null);

// ─── TuiRouter ────────────────────────────────────────────────────────────────

/**
 * Generic TUI screen router with built-in navigation history.
 *
 * Accepts a `views` record whose keys are screen `type` strings and values are
 * `View<TScreen>` objects with a `render` function. This is the same shape as
 * `CommandTui.views`, so you can pass a command's views directly:
 *
 * ```tsx
 * <TuiRouter views={MY_COMMAND.views} initialScreen={{ type: 'main' }} />
 * ```
 *
 * Owns screen state via `useState` — no external store needed for routing.
 * Provides `NavigationCtx` so child components can call `useNavigate()` /
 * `useHistory()` without threading navigation callbacks through props.
 * An optional overlay (e.g. a modal) is rendered inside the provider so it
 * can also call `useNavigate()` / `useHistory()`.
 */
export function TuiRouter<TScreen extends { type: string }>({
  views,
  initialScreen,
  overlay,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  views: Record<string, View<TScreen, any>>;
  initialScreen: TScreen;
  overlay?: React.ReactNode;
}) {
  const [screen, setScreen] = useState<TScreen>(initialScreen);
  const [history, setHistory] = useState<TScreen[]>([]);

  const navigate = useCallback(
    (next: TScreen) => {
      setHistory((h) => [...h, screen]);
      setScreen(next);
    },
    [screen]
  );

  const goBack = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1] as TScreen;
      setScreen(prev);
      return h.slice(0, -1);
    });
  }, []);

  const ctx: NavigationCtxValue = useMemo(
    () => ({
      navigate: navigate as NavigationCtxValue['navigate'],
      goBack,
      canGoBack: history.length > 0,
    }),
    [navigate, goBack, history.length]
  );

  const focusStack = useFocusStackValue();

  const view = views[screen.type];
  if (!view) return null;

  return (
    <NavigationCtx.Provider value={ctx}>
      <FocusStackProvider value={focusStack}>
        {view.render(screen, view.keybinds)}
        {overlay}
      </FocusStackProvider>
    </NavigationCtx.Provider>
  );
}

// ─── Navigation hooks ─────────────────────────────────────────────────────────

/**
 * Returns a typed navigate function for the given screen union.
 *
 * ```ts
 * const navigate = useNavigate<PrScreen>();
 * navigate({ type: 'pr-detail', pr, matches });
 * ```
 *
 * Must be called from a component rendered inside `<TuiRouter>`.
 */
export function useNavigate<TScreen extends { type: string } = { type: string }>(): (
  screen: TScreen
) => void {
  const ctx = useContext(NavigationCtx);
  if (!ctx) throw new Error('useNavigate must be called inside a <TuiRouter>');
  return ctx.navigate as (screen: TScreen) => void;
}

/**
 * Returns history helpers for going back.
 *
 * ```ts
 * const { canGoBack, goBack } = useHistory();
 * ```
 *
 * Must be called from a component rendered inside `<TuiRouter>`.
 */
export function useHistory(): { canGoBack: boolean; goBack: () => void } {
  const ctx = useContext(NavigationCtx);
  if (!ctx) throw new Error('useHistory must be called inside a <TuiRouter>');
  return { canGoBack: ctx.canGoBack, goBack: ctx.goBack };
}

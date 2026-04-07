import type React from 'react';

/**
 * Core interfaces for the View/CommandTui abstraction.
 *
 * Use `defineView<TScreen>()({...})` to define a view — TypeScript infers the
 * exact keybind shape, and the `render` function receives that narrow type so
 * you can access `keybinds.navigate` etc. without widening to Record.
 *
 * Use `defineCommand<TScreen>()({...})` to group views — the per-key types on
 * every view's `keybinds` are preserved for typed external access.
 *
 * Collection constraints (`CommandTui.views`, `TuiRouter` props) use
 * `View<TScreen, any>` so that narrow-keybind views can be placed in maps
 * alongside views with different keybind shapes. The `any` is confined to the
 * constraint; inferred types on individual views remain fully typed.
 */

/**
 * Specifies a key combination that triggers a keybind action.
 *
 * - `string` — matches `key.name` (e.g. `'up'`, `'return'`, `'escape'`, `'q'`)
 * - `{ ctrl: true; name: string }` — matches `key.ctrl && key.name`
 * - `{ raw: string }` — matches `key.raw` (for characters like `'/'` or shift-`'R'`)
 */
export type KeyMatcher =
  | string
  | { readonly ctrl: true; readonly name: string }
  | { readonly raw: string };

export interface Keybind {
  /**
   * Key combinations that trigger this action. Used both to wire up the
   * in-TUI keyboard handler (via `useKeybinds`) and to derive the docs label.
   */
  keys: readonly KeyMatcher[];
  /** Human-readable key label for docs. E.g. "j/k or Up/Down" */
  label: string;
  /** What the key does — shown in docs and used as the terminal description fallback. */
  description: string;
  /**
   * Full terminal footer part override. Uses Unicode symbols and the `[key]action`
   * shorthand style. Falls back to `[label] description` when absent.
   */
  terminal?: string;
  /**
   * When true, this keybind is conditional (only active when a runtime condition
   * is met). It is still listed in docs but is only shown in the footer when the
   * caller passes `{ [actionKey]: true }` to `footerParts()`.
   * In `useKeybinds`, conditional keybinds are skipped unless their key is
   * `true` in the `show` option.
   */
  conditional?: boolean;
}

/**
 * A screen or mode within a TUI command.
 *
 * `TKeybinds` is inferred from the literal `keybinds` object when you use
 * `defineView<TScreen>()({...})`, giving the render function (and any component
 * it delegates to) a strongly typed keybinds value.
 */
export interface View<
  TScreen = unknown,
  TKeybinds extends Record<string, Keybind> = Record<string, Keybind>
> {
  keybinds: TKeybinds;
  render: (screen: TScreen, keybinds: TKeybinds) => React.ReactNode;
}

/**
 * Extract the exact keybind type from a `View` or any object with a `keybinds`
 * property:
 *
 * ```ts
 * type NavKb = KeybindsOf<typeof myView>;
 * // { navigate: Keybind; select: Keybind; ... }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type KeybindsOf<TView> = TView extends View<any, infer K> ? K : Record<string, Keybind>;

/**
 * Props interface for components that receive a view's keybinds.
 *
 * Generic so the keybind type can be preserved:
 * ```ts
 * function MyScreen({ keybinds }: ViewProps<typeof myView>) {
 *   keybinds.navigate; // Keybind — not Record<string, Keybind>
 * }
 * ```
 */
export interface ViewProps<TView = View> {
  keybinds: KeybindsOf<TView>;
}

/**
 * A top-level CLI command, grouping its views.
 *
 * `TViews` is inferred from the literal `views` object when you use
 * `defineCommand<TScreen>()({...})` — this preserves per-view, per-key types.
 *
 * The `TViews` constraint uses `View<TScreen, any>` (not `View<TScreen>`) so
 * that views with narrow keybind types can coexist in the same map.
 */
export interface CommandTui<
  TScreen = unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TViews extends Record<string, View<TScreen, any>> = Record<string, View<TScreen>>
> {
  /** The CLI subcommand name, e.g. "pr". Use "default" for the root command. */
  name: string;
  description?: string;
  views: TViews;
  /** @internal Phantom type marker — never set at runtime. */
  readonly _screen?: TScreen;
}

/** Extract the screen union type from a `CommandTui<TScreen>` type. */
export type ScreenOf<T> = T extends CommandTui<infer S> ? S : never;

/**
 * Define a view with fully inferred, strongly typed keybinds.
 *
 * The curried form lets TypeScript infer `TKeybinds` from the literal keybinds
 * object without requiring an explicit second type argument. The `render`
 * callback receives `keybinds: TKeybinds`, so you can access named keys
 * directly and pass the value to any component accepting `Record<string, Keybind>`
 * (because `TKeybinds extends Record<string, Keybind>`):
 *
 * ```ts
 * defineView<MyScreen>()({
 *   keybinds: {
 *     navigate: { label: 'j/k', description: 'Navigate' },
 *     quit:     { label: 'q',   description: 'Quit' },
 *   },
 *   render: (_, keybinds) => {
 *     keybinds.navigate;     // Keybind ✓
 *     keybinds.nonexistent;  // TypeScript error ✓
 *     return <MyComponent keybinds={keybinds} />; // passes to Record<string,Keybind> param ✓
 *   },
 * });
 * ```
 */
export function defineView<TScreen>() {
  return function <TKeybinds extends Record<string, Keybind>>(view: {
    keybinds: TKeybinds;
    render: (screen: TScreen, keybinds: TKeybinds) => React.ReactNode;
  }): View<TScreen, TKeybinds> {
    return view;
  };
}

/**
 * Define a command with fully inferred view and keybind types.
 *
 * ```ts
 * export const MY_COMMAND = defineCommand<MyScreen>()({
 *   name: 'my-cmd',
 *   views: {
 *     'main': defineView<MyScreen>()({
 *       keybinds: { navigate: { label: 'j/k', description: 'Navigate' } },
 *       render: (_, keybinds) => <MainView keybinds={keybinds} />,
 *     }),
 *   },
 * });
 * // MY_COMMAND.views['main'].keybinds.navigate  → Keybind ✓
 * ```
 */
export function defineCommand<TScreen>() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function <TViews extends Record<string, View<TScreen, any>>>(cmd: {
    name: string;
    description?: string;
    views: TViews;
  }): CommandTui<TScreen, TViews> {
    return cmd;
  };
}

/**
 * Derive terminal footer part strings from a view's keybinds.
 *
 * @param keybinds  - The view's keybind map (from `View.keybinds` or `ViewProps.keybinds`).
 * @param show      - Optional map of action keys → boolean. Conditional keybinds are
 *                    only included when their key is `true` here.
 */
export function footerParts(
  keybinds: Record<string, Keybind>,
  show?: Partial<Record<string, boolean>>
): string[] {
  return Object.entries(keybinds)
    .filter(([key, kb]) => !kb.conditional || show?.[key] === true)
    .map(([, kb]) => kb.terminal ?? `[${kb.label}] ${kb.description}`);
}

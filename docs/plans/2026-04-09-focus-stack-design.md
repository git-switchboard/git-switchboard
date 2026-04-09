# Focus Stack Design

## Problem

Keyboard event handlers across the app use ad-hoc guards (`if (searchMode)`, `if (modalActive)`, `if (inputMode)`) to avoid firing when another component should own focus. This is error-prone — forgetting a guard or getting event ordering wrong causes keys to reach the wrong handler.

## Solution

A focus stack in `TuiRouter` that `useKeyboard` and `useKeybinds` check automatically. Components declare focus ownership; hooks self-guard.

## Architecture

### Focus Stack Context (`focus-stack.ts`)

A new file exporting:

- **`FocusStackProvider`** — React context provider wrapping `TuiRouter` children. Holds a `string[]` stack via `useState`.
- **`useFocusStack()`** — Returns `{ stack, push, pop }`. `pop(id)` only pops if `id` matches the top (safety check).
- **`useFocusOwner(id, active)`** — Declarative hook. Pushes `id` when `active` becomes `true`, pops on `false` or unmount via effect cleanup.
- **`useFocusedKeyboard(handler, options?)`** — Wraps `@opentui/react`'s `useKeyboard` with focus check:
  - `{ global: true }` — always fires (e.g., Ctrl+C)
  - `{ focusId: 'x' }` — fires only when `'x'` is on top of the stack
  - No options — fires only when stack is empty (default/unfocused mode)

### Hook Changes

- **`useKeybinds`** — Internal `useKeyboard` call becomes `useFocusedKeyboard`. Accepts optional `focusId` in its options. No API change for most callers — keybinds without a `focusId` automatically only fire when stack is empty.
- **`useExitOnCtrlC`** — Uses `useFocusedKeyboard(handler, { global: true })`.

### TuiRouter Integration

`TuiRouter` wraps its children in `<FocusStackProvider>`. Every screen rendered through the router automatically has access to the focus stack.

## Migration Per Component

### app.tsx (branch picker)
- Add `useFocusOwner('branch-search', searchMode)`
- Search text handler: `useFocusedKeyboard(handler, { focusId: 'branch-search' })`
- Remove `if (searchMode)` guard from `select` handler
- `useKeybinds` call unchanged — auto-suppressed when focus is claimed

### pr-app.tsx (PR list)
- Add `useFocusOwner('pr-search', searchMode)` and `useFocusOwner('sort-modal', sortModal)`
- Search/sort handlers get their respective `focusId`
- Remove manual `searchMode`/`sortModal` guards from keybind handlers

### pr-router.tsx
- Replace `modalActive` context (`PrInfraCtx`) with:
  - `useFocusOwner('editor-modal', !!editorModal)`
  - `useFocusOwner('provider-status', showProviderStatus)`
- Remove `PrInfraCtx` entirely
- Remove all `modalActive` checks in child components (`pr-app.tsx`, `pr-detail.tsx`)

### worktree-conflict.tsx, connect-setup.tsx, clone-prompt.tsx
- Add `useFocusOwner('input', inputMode)` for text input modes
- Input handlers: `useFocusedKeyboard(handler, { focusId: 'input' })`
- Remove manual `inputMode` guards from keybind handlers

### provider-status.tsx, editor-prompt.tsx
- Mount/unmount overlays: `useFocusOwner('modal', true)` — pushes on mount, pops on unmount

### use-exit-on-ctrl-c.ts
- Change to `useFocusedKeyboard(handler, { global: true })`

## Key Decisions

- **Opt-out focus**: Handlers without a `focusId` only fire when the stack is empty. Safer by default.
- **Stack, not token**: Supports returning focus to the previous owner via pop.
- **Declarative ownership**: `useFocusOwner(id, boolean)` ties focus to existing state — no manual push/pop calls.
- **Per-router scope**: Each `TuiRouter` has its own stack. Router trees are never co-mounted so sharing is unnecessary.
- **`pop(id)` safety**: Only pops if the ID matches the top, preventing stack corruption from out-of-order cleanup.

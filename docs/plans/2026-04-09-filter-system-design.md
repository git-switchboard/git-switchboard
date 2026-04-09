# PR Filter System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a structured filter modal to the PR list view with string filters (fuzzy/exact), multiselect status filters, and saveable presets — all composable with the existing freetext search.

**Architecture:** Filter state (`FilterState`) lives in the Zustand store as session-only state alongside `listSearchQuery`. A two-level modal (field list → sub-picker) lets users build filters. String fields (org, repo, author, linear) use a fuzzy autocomplete picker with exact/fuzzy toggle. Status fields (role, review, ci, merge) use a multiselect checkbox picker. Presets serialize `FilterState` to `config.json` for persistence across sessions. The `filteredPRs` useMemo applies structured filters AND freetext search (AND logic).

**Tech Stack:** React (opentui), Zustand, TypeScript, Node fs for config persistence

---

### Task 1: Define FilterState types

**Files:**
- Modify: `packages/git-switchboard/src/types.ts`

**Step 1: Add filter types after the column types section**

```typescript
// ─── Filter types (shared between pr-app and store) ─────────────────────────

export type StringMatchMode = 'fuzzy' | 'exact';

export interface StringFilter {
  value: string;
  mode: StringMatchMode;
}

export interface FilterState {
  org?: StringFilter;
  repo?: StringFilter;
  author?: StringFilter;
  linear?: StringFilter;
  role?: PRRole[];
  review?: ReviewStatus[];
  ci?: CIStatus[];
  merge?: MergeableStatus[];
}

export const EMPTY_FILTERS: FilterState = {};

export type FilterFieldId = keyof FilterState;

export interface FilterFieldDef {
  id: FilterFieldId;
  label: string;
  type: 'string' | 'multiselect';
}

export const FILTER_FIELD_DEFS: FilterFieldDef[] = [
  { id: 'org', label: 'Organization', type: 'string' },
  { id: 'repo', label: 'Repository', type: 'string' },
  { id: 'author', label: 'Author', type: 'string' },
  { id: 'linear', label: 'Linear Issue', type: 'string' },
  { id: 'role', label: 'Role', type: 'multiselect' },
  { id: 'review', label: 'Review Status', type: 'multiselect' },
  { id: 'ci', label: 'CI Status', type: 'multiselect' },
  { id: 'merge', label: 'Merge Status', type: 'multiselect' },
];
```

Use arrays instead of Sets for multiselect values — Sets don't serialize to JSON and are harder to compare in React.

**Step 2: Add filter preset type**

```typescript
export interface FilterPreset {
  label: string;
  filters: FilterState;
}
```

**Step 3: Verify build**

Run: `npx tsc --noEmit -p packages/git-switchboard/tsconfig.json`
Expected: Clean (no errors)

**Step 4: Commit**

```
feat: add FilterState types and field definitions
```

---

### Task 2: Add filter state to store

**Files:**
- Modify: `packages/git-switchboard/src/store.ts`
- Modify: `packages/git-switchboard/src/store.test.ts`

**Step 1: Add filter state to PrStore interface**

In `store.ts`, add to the `PrStore` interface after `listColumns`:

```typescript
  listFilters: FilterState;
  setListFilters: (filters: FilterState | ((prev: FilterState) => FilterState)) => void;
```

Import `FilterState` and `EMPTY_FILTERS` from `./types.js`.

**Step 2: Initialize filter state in createPrStore**

In the store initialization block (after `listColumns: initial.columns`):

```typescript
      listFilters: EMPTY_FILTERS,
      setListFilters: (filters) =>
        set((s) => ({
          listFilters: typeof filters === 'function' ? filters(s.listFilters) : filters,
        })),
```

**Step 3: Verify build**

Run: `npx tsc --noEmit -p packages/git-switchboard/tsconfig.json`
Expected: Clean

**Step 4: Commit**

```
feat: add listFilters state to PrStore
```

---

### Task 3: Add preset persistence to config

**Files:**
- Modify: `packages/git-switchboard/src/config.ts`

**Step 1: Extend Config interface**

Add to the `Config` interface:

```typescript
  /** Saved filter presets. Key is the view name (e.g. 'pr-list'). */
  filterPresets?: Record<string, FilterPreset[]>;
```

Import `FilterPreset` from `./types.js`.

**Step 2: Add preset read/write helpers**

After the `writeColumnConfig` function:

```typescript
export async function readFilterPresets(viewName: string): Promise<FilterPreset[]> {
  const config = await readConfig();
  return config.filterPresets?.[viewName] ?? [];
}

export async function writeFilterPresets(
  viewName: string,
  presets: FilterPreset[],
): Promise<void> {
  const config = await readConfig();
  config.filterPresets ??= {};
  config.filterPresets[viewName] = presets;
  await writeConfig(config);
}
```

**Step 3: Verify build**

Run: `npx tsc --noEmit -p packages/git-switchboard/tsconfig.json`
Expected: Clean

**Step 4: Commit**

```
feat: add filter preset persistence to config
```

---

### Task 4: Wire filter state through to PrApp

**Files:**
- Modify: `packages/git-switchboard/src/pr-router.tsx`
- Modify: `packages/git-switchboard/src/pr-app.tsx`

**Step 1: Add filter keybind to pr-list view in pr-router.tsx**

Add after the `columns` keybind:

```typescript
filter: { keys: ['f'], label: 'f', description: 'Open filter modal', terminal: '[f]ilter' },
```

Note: `f` is available (not used by any existing keybind).

**Step 2: Wire filter state from store to PrApp in PrListScreen**

In `PrListScreen`, add store selectors:

```typescript
  const filters = useStore(store, (s) => s.listFilters);
```

Pass to `PrApp`:

```typescript
      filters={filters}
      setFilters={store.getState().setListFilters}
```

**Step 3: Add filter props to PrAppProps interface in pr-app.tsx**

After the `setColumns` prop:

```typescript
  filters: FilterState;
  setFilters: (filters: FilterState | ((prev: FilterState) => FilterState)) => void;
```

Import `FilterState`, `FILTER_FIELD_DEFS`, `FilterFieldDef`, `FilterPreset` from `./types.js`.

**Step 4: Destructure new props in PrApp component**

Add `filters`, `setFilters` to the destructured props.

**Step 5: Verify build**

Run: `npx tsc --noEmit -p packages/git-switchboard/tsconfig.json`
Expected: Clean

**Step 6: Commit**

```
feat: wire filter state from store through to PrApp
```

---

### Task 5: Implement filter logic in filteredPRs

**Files:**
- Modify: `packages/git-switchboard/src/pr-app.tsx`

**Step 1: Create applyFilters helper function**

Add before the `PrApp` component (after the `COLUMN_HEADERS` definition):

```typescript
function matchesStringFilter(value: string, filter: StringFilter): boolean {
  if (filter.mode === 'exact') return value.toLowerCase() === filter.value.toLowerCase();
  return value.toLowerCase().includes(filter.value.toLowerCase());
}

function applyFilters(pr: PR, filters: FilterState, dataLayer: DataLayer): boolean {
  if (filters.org && !matchesStringFilter(pr.repoOwner, filters.org)) return false;
  if (filters.repo && !matchesStringFilter(pr.repoId, filters.repo)) return false;
  if (filters.author && !matchesStringFilter(pr.author, filters.author)) return false;
  if (filters.linear) {
    const linearIssues = dataLayer.query.linearIssuesForPr(`${pr.repoId}#${pr.number}`);
    const linearIssue = linearIssues[0];
    if (!linearIssue || !matchesStringFilter(linearIssue.identifier, filters.linear)) return false;
  }
  if (filters.role && filters.role.length > 0 && !filters.role.includes(pr.role)) return false;
  if (filters.review && filters.review.length > 0) {
    if (!pr.review?.status || !filters.review.includes(pr.review.status)) return false;
  }
  if (filters.ci && filters.ci.length > 0) {
    if (!pr.ci?.status || !filters.ci.includes(pr.ci.status)) return false;
  }
  if (filters.merge && filters.merge.length > 0) {
    if (!pr.mergeable || !filters.merge.includes(pr.mergeable)) return false;
  }
  return true;
}
```

**Step 2: Update filteredPRs useMemo to apply structured filters**

Replace the current filter block in the `filteredPRs` useMemo. The new logic:
1. First apply structured filters
2. Then apply freetext search on the remaining set

```typescript
  const filteredPRs = useMemo(() => {
    // Apply structured filters first
    let result = prs.filter((pr) => applyFilters(pr, filters, dataLayer));

    // Then apply freetext search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((pr) => {
        const linearIssues = dataLayer.query.linearIssuesForPr(`${pr.repoId}#${pr.number}`);
        const linearIssue = linearIssues[0];
        return (
          pr.title.toLowerCase().includes(q) ||
          pr.repoId.includes(q) ||
          pr.headRef.toLowerCase().includes(q) ||
          pr.author.toLowerCase().includes(q) ||
          (linearIssue?.identifier.toLowerCase().includes(q) ?? false)
        );
      });
    }

    // Sort
    result.sort((a, b) => {
      // ... existing sort logic unchanged ...
    });
    return result;
  }, [prs, searchQuery, filters, dataLayer, sortLayers]);
```

Add `filters` to the dependency array.

**Step 3: Verify build**

Run: `npx tsc --noEmit -p packages/git-switchboard/tsconfig.json`
Expected: Clean

**Step 4: Commit**

```
feat: apply structured filters in filteredPRs computation
```

---

### Task 6: Build the filter modal — field list level

**Files:**
- Modify: `packages/git-switchboard/src/pr-app.tsx`

This is the top-level modal showing the list of filter fields and presets.

**Step 1: Add filter modal state**

After the `columnModal` state:

```typescript
  const [filterModal, setFilterModal] = useState<{
    level: 'fields';
    selectedIndex: number;
  } | {
    level: 'string-picker';
    fieldId: FilterFieldId;
    inputValue: string;
    mode: StringMatchMode;
    selectedIndex: number;
  } | {
    level: 'multiselect-picker';
    fieldId: FilterFieldId;
    selected: string[];
    selectedIndex: number;
  } | {
    level: 'save-preset';
    inputValue: string;
  } | null>(null);

  useFocusOwner('filter-modal', !!filterModal);
```

**Step 2: Load presets state**

```typescript
  const [filterPresets, setFilterPresets] = useState<FilterPreset[]>([]);
  // Load presets on mount
  useEffect(() => {
    void readFilterPresets(PR_VIEW_NAME).then(setFilterPresets);
  }, []);
```

Import `readFilterPresets`, `writeFilterPresets` from `./config.js`.

**Step 3: Compute active filter count for display**

```typescript
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.org) count++;
    if (filters.repo) count++;
    if (filters.author) count++;
    if (filters.linear) count++;
    if (filters.role && filters.role.length > 0) count++;
    if (filters.review && filters.review.length > 0) count++;
    if (filters.ci && filters.ci.length > 0) count++;
    if (filters.merge && filters.merge.length > 0) count++;
    return count;
  }, [filters]);
```

**Step 4: Add filter keybind handler**

In the `useKeybinds` call, add:

```typescript
    filter: () => setFilterModal({ level: 'fields', selectedIndex: 0 }),
```

**Step 5: Build the field-level items list**

Before the keyboard handler, compute the items shown in the field list:

```typescript
  const filterFieldItems = useMemo(() => {
    const items: { type: 'preset'; index: number; preset: FilterPreset }[] |
      { type: 'field'; def: FilterFieldDef }[] |
      { type: 'clear' }[] |
      { type: 'save' }[] = [];

    // Presets section
    for (let i = 0; i < filterPresets.length; i++) {
      items.push({ type: 'preset', index: i, preset: filterPresets[i] });
    }

    // Field section
    for (const def of FILTER_FIELD_DEFS) {
      items.push({ type: 'field', def });
    }

    // Actions
    if (activeFilterCount > 0) {
      items.push({ type: 'clear' });
      items.push({ type: 'save' });
    }

    return items;
  }, [filterPresets, activeFilterCount]);
```

Use a discriminated union type for the items:

```typescript
  type FilterMenuItem =
    | { type: 'preset'; index: number; preset: FilterPreset }
    | { type: 'field'; def: FilterFieldDef }
    | { type: 'clear' }
    | { type: 'save' };
```

Place this type definition before the component.

**Step 6: Add field-level keyboard handler**

```typescript
  useFocusedKeyboard((key) => {
    key.stopPropagation();
    if (!filterModal) return true;

    if (filterModal.level === 'fields') {
      const items = filterFieldItems;
      switch (key.name) {
        case 'up':
        case 'k':
          setFilterModal({ ...filterModal, selectedIndex: Math.max(0, filterModal.selectedIndex - 1) });
          break;
        case 'down':
        case 'j':
          setFilterModal({ ...filterModal, selectedIndex: Math.min(items.length - 1, filterModal.selectedIndex + 1) });
          break;
        case 'return': {
          const item = items[filterModal.selectedIndex];
          if (!item) break;
          if (item.type === 'preset') {
            setFilters(item.preset.filters);
            setFilterModal(null);
          } else if (item.type === 'field') {
            if (item.def.type === 'string') {
              const current = filters[item.def.id] as StringFilter | undefined;
              setFilterModal({
                level: 'string-picker',
                fieldId: item.def.id,
                inputValue: current?.value ?? '',
                mode: current?.mode ?? 'fuzzy',
                selectedIndex: 0,
              });
            } else {
              const current = (filters[item.def.id] as string[] | undefined) ?? [];
              setFilterModal({
                level: 'multiselect-picker',
                fieldId: item.def.id,
                selected: [...current],
                selectedIndex: 0,
              });
            }
          } else if (item.type === 'clear') {
            setFilters(EMPTY_FILTERS);
          } else if (item.type === 'save') {
            setFilterModal({ level: 'save-preset', inputValue: '' });
          }
          break;
        }
        case 'escape':
        case 'q':
          setFilterModal(null);
          break;
        default:
          if (key.raw === 'f' || key.raw === 'F') {
            setFilterModal(null);
          } else if (key.raw === 'd' || key.raw === 'D') {
            // Delete preset
            const item = items[filterModal.selectedIndex];
            if (item?.type === 'preset') {
              const next = filterPresets.filter((_, idx) => idx !== item.index);
              setFilterPresets(next);
              void writeFilterPresets(PR_VIEW_NAME, next);
              setFilterModal({
                ...filterModal,
                selectedIndex: Math.min(filterModal.selectedIndex, items.length - 2),
              });
            }
          }
          break;
      }
    }

    // ... string-picker, multiselect-picker, save-preset handlers in subsequent tasks

    return true;
  }, { focusId: 'filter-modal' });
```

**Step 7: Render the field-level modal**

Add after the column modal render block:

```typescript
      {/* Filter modal */}
      {filterModal?.level === 'fields' && (
        <box
          style={{
            position: 'absolute',
            top: Math.floor(height / 2) - Math.floor((filterFieldItems.length + 4) / 2),
            left: Math.floor(width / 2) - 22,
            width: 44,
            height: filterFieldItems.length + 4,
          }}
        >
          <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text
                content={activeFilterCount > 0 ? ` Filters (${activeFilterCount} active)` : ' Filters'}
                fg="#7aa2f7"
              />
            </box>
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text content={'─'.repeat(44)} fg="#292e42" />
            </box>
            {filterFieldItems.map((item, i) => {
              const isActive = i === filterModal.selectedIndex;
              let label: string;
              let valueText = '';
              let fg: string;

              if (item.type === 'preset') {
                label = `★ ${item.preset.label}`;
                fg = isActive ? '#e0af68' : '#bb9af7';
              } else if (item.type === 'field') {
                label = item.def.label;
                const val = filters[item.def.id];
                if (item.def.type === 'string' && val && typeof val === 'object' && 'value' in val) {
                  valueText = ` = ${(val as StringFilter).mode === 'exact' ? '"' : ''}${(val as StringFilter).value}${(val as StringFilter).mode === 'exact' ? '"' : ''}`;
                } else if (Array.isArray(val) && val.length > 0) {
                  valueText = ` = ${val.join(', ')}`;
                }
                fg = valueText
                  ? (isActive ? '#c0caf5' : '#7aa2f7')
                  : (isActive ? '#a9b1d6' : '#565f89');
              } else if (item.type === 'clear') {
                label = '✗ Clear all filters';
                fg = isActive ? '#f7768e' : '#565f89';
              } else {
                label = '+ Save as preset';
                fg = isActive ? '#9ece6a' : '#565f89';
              }

              const itemKey = item.type === 'field' ? item.def.id
                : item.type === 'preset' ? `preset-${item.index}`
                : item.type;

              return (
                <box
                  key={itemKey}
                  style={{
                    height: 1,
                    width: '100%',
                    backgroundColor: isActive ? '#292e42' : '#1a1b26',
                  }}
                >
                  <text
                    content={` ${isActive ? '>' : ' '} ${label}${valueText}`}
                    fg={fg}
                  />
                </box>
              );
            })}
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text content=" Enter select | d delete preset | Esc close" fg="#565f89" />
            </box>
          </box>
        </box>
      )}
```

**Step 8: Verify build**

Run: `npx tsc --noEmit -p packages/git-switchboard/tsconfig.json`
Expected: Clean

**Step 9: Commit**

```
feat: add filter modal field list with preset support
```

---

### Task 7: Build string-picker sub-level (fuzzy autocomplete)

**Files:**
- Modify: `packages/git-switchboard/src/pr-app.tsx`

**Step 1: Compute distinct values for string fields**

Add a `useMemo` that builds lookup tables:

```typescript
  const stringFieldValues = useMemo(() => {
    const orgs = [...new Set(prs.map((pr) => pr.repoOwner))].sort();
    const repos = [...new Set(prs.map((pr) => pr.repoId))].sort();
    const authors = [...new Set(prs.map((pr) => pr.author))].sort();
    const linearIds: string[] = [];
    for (const pr of prs) {
      const issues = dataLayer.query.linearIssuesForPr(`${pr.repoId}#${pr.number}`);
      for (const issue of issues) {
        if (!linearIds.includes(issue.identifier)) linearIds.push(issue.identifier);
      }
    }
    return { org: orgs, repo: repos, author: authors, linear: linearIds.sort() };
  }, [prs, dataLayer]);
```

**Step 2: Add string-picker keyboard handler**

Inside the `useFocusedKeyboard` for filter-modal, add handling for the `string-picker` level:

```typescript
    if (filterModal.level === 'string-picker') {
      const allValues = stringFieldValues[filterModal.fieldId as keyof typeof stringFieldValues] ?? [];
      const query = filterModal.inputValue.toLowerCase();
      const suggestions = query
        ? allValues.filter((v) => v.toLowerCase().includes(query))
        : allValues;

      switch (key.name) {
        case 'up':
        case 'k':
          // Only navigate when not typing (shift+k)
          if (key.raw === 'k') break;  // let it type
          setFilterModal({ ...filterModal, selectedIndex: Math.max(0, filterModal.selectedIndex - 1) });
          break;
        case 'down':
        case 'j':
          if (key.raw === 'j') break;  // let it type
          setFilterModal({ ...filterModal, selectedIndex: Math.min(suggestions.length - 1, filterModal.selectedIndex + 1) });
          break;
        case 'up':
          setFilterModal({ ...filterModal, selectedIndex: Math.max(0, filterModal.selectedIndex - 1) });
          break;
        case 'down':
          setFilterModal({ ...filterModal, selectedIndex: Math.min(suggestions.length - 1, filterModal.selectedIndex + 1) });
          break;
        case 'tab':
          // Toggle fuzzy/exact
          setFilterModal({
            ...filterModal,
            mode: filterModal.mode === 'fuzzy' ? 'exact' : 'fuzzy',
          });
          break;
        case 'return': {
          // If a suggestion is selected, use it; otherwise use typed value
          const value = suggestions[filterModal.selectedIndex] ?? filterModal.inputValue;
          if (value) {
            setFilters((prev) => ({
              ...prev,
              [filterModal.fieldId]: { value, mode: filterModal.mode },
            }));
          } else {
            // Empty value = clear the filter
            setFilters((prev) => {
              const next = { ...prev };
              delete next[filterModal.fieldId];
              return next;
            });
          }
          setFilterModal({ level: 'fields', selectedIndex: 0 });
          break;
        }
        case 'escape':
        case 'backspace':
          if (key.name === 'backspace') {
            setFilterModal({ ...filterModal, inputValue: filterModal.inputValue.slice(0, -1), selectedIndex: 0 });
          } else {
            setFilterModal({ level: 'fields', selectedIndex: 0 });
          }
          break;
        default:
          if (key.raw && key.raw.length >= 1 && key.raw >= ' ') {
            setFilterModal({
              ...filterModal,
              inputValue: filterModal.inputValue + key.raw,
              selectedIndex: 0,
            });
          }
          break;
      }
    }
```

Note: In the string picker, up/down use arrow keys only (not j/k) since the user is typing. j/k get typed as text.

**Step 3: Render the string-picker modal**

Add after the fields-level render:

```typescript
      {filterModal?.level === 'string-picker' && (() => {
        const allValues = stringFieldValues[filterModal.fieldId as keyof typeof stringFieldValues] ?? [];
        const query = filterModal.inputValue.toLowerCase();
        const suggestions = query
          ? allValues.filter((v) => v.toLowerCase().includes(query))
          : allValues;
        const maxVisible = Math.min(suggestions.length, 10);
        const fieldDef = FILTER_FIELD_DEFS.find((d) => d.id === filterModal.fieldId);
        const modalHeight = maxVisible + 5; // header + divider + input + suggestions + footer

        return (
          <box
            style={{
              position: 'absolute',
              top: Math.floor(height / 2) - Math.floor(modalHeight / 2),
              left: Math.floor(width / 2) - 22,
              width: 44,
              height: modalHeight,
            }}
          >
            <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
              <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
                <text content={` ${fieldDef?.label ?? filterModal.fieldId} (${filterModal.mode})`} fg="#7aa2f7" />
              </box>
              <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
                <text content={'─'.repeat(44)} fg="#292e42" />
              </box>
              {/* Input line */}
              <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
                <text
                  content={` > ${filterModal.inputValue}█`}
                  fg="#c0caf5"
                />
              </box>
              {/* Suggestions */}
              {suggestions.slice(0, maxVisible).map((val, i) => {
                const isActive = i === filterModal.selectedIndex;
                return (
                  <box
                    key={val}
                    style={{
                      height: 1,
                      width: '100%',
                      backgroundColor: isActive ? '#292e42' : '#1a1b26',
                    }}
                  >
                    <text
                      content={`   ${isActive ? '>' : ' '} ${val}`}
                      fg={isActive ? '#c0caf5' : '#a9b1d6'}
                    />
                  </box>
                );
              })}
              <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
                <text content=" Tab fuzzy/exact | Enter confirm | Esc back" fg="#565f89" />
              </box>
            </box>
          </box>
        );
      })()}
```

**Step 4: Verify build**

Run: `npx tsc --noEmit -p packages/git-switchboard/tsconfig.json`
Expected: Clean

**Step 5: Commit**

```
feat: add string-picker sub-level with fuzzy autocomplete
```

---

### Task 8: Build multiselect-picker sub-level

**Files:**
- Modify: `packages/git-switchboard/src/pr-app.tsx`

**Step 1: Define multiselect option lists**

Add before the component:

```typescript
const MULTISELECT_OPTIONS: Record<string, { value: string; label: string }[]> = {
  role: [
    { value: 'author', label: 'Author' },
    { value: 'assigned', label: 'Assigned' },
    { value: 'both', label: 'Both' },
  ],
  review: [
    { value: 'approved', label: 'Approved' },
    { value: 'changes-requested', label: 'Changes Requested' },
    { value: 're-review-needed', label: 'Re-review Needed' },
    { value: 'needs-review', label: 'Needs Review' },
    { value: 'commented', label: 'Commented' },
    { value: 'dismissed', label: 'Dismissed' },
  ],
  ci: [
    { value: 'passing', label: 'Passing' },
    { value: 'failing', label: 'Failing' },
    { value: 'pending', label: 'Pending' },
    { value: 'mixed', label: 'Mixed' },
    { value: 'unknown', label: 'Unknown' },
  ],
  merge: [
    { value: 'MERGEABLE', label: 'Mergeable' },
    { value: 'CONFLICTING', label: 'Conflicting' },
    { value: 'UNKNOWN', label: 'Unknown' },
  ],
};
```

**Step 2: Add multiselect-picker keyboard handler**

Inside the `useFocusedKeyboard` for filter-modal:

```typescript
    if (filterModal.level === 'multiselect-picker') {
      const options = MULTISELECT_OPTIONS[filterModal.fieldId] ?? [];

      switch (key.name) {
        case 'up':
        case 'k':
          setFilterModal({ ...filterModal, selectedIndex: Math.max(0, filterModal.selectedIndex - 1) });
          break;
        case 'down':
        case 'j':
          setFilterModal({ ...filterModal, selectedIndex: Math.min(options.length - 1, filterModal.selectedIndex + 1) });
          break;
        case 'return':
        case 'space': {
          // Toggle the option at selectedIndex
          const opt = options[filterModal.selectedIndex];
          if (opt) {
            const sel = filterModal.selected;
            const next = sel.includes(opt.value)
              ? sel.filter((v) => v !== opt.value)
              : [...sel, opt.value];
            setFilterModal({ ...filterModal, selected: next });
          }
          break;
        }
        case 'escape': {
          // Apply and go back
          const selected = filterModal.selected;
          if (selected.length > 0) {
            setFilters((prev) => ({ ...prev, [filterModal.fieldId]: selected }));
          } else {
            setFilters((prev) => {
              const next = { ...prev };
              delete next[filterModal.fieldId];
              return next;
            });
          }
          setFilterModal({ level: 'fields', selectedIndex: 0 });
          break;
        }
      }
    }
```

Note: Space or Enter toggles; Escape applies and goes back to field list.

**Step 3: Render the multiselect-picker modal**

```typescript
      {filterModal?.level === 'multiselect-picker' && (() => {
        const options = MULTISELECT_OPTIONS[filterModal.fieldId] ?? [];
        const fieldDef = FILTER_FIELD_DEFS.find((d) => d.id === filterModal.fieldId);
        const modalHeight = options.length + 4;

        return (
          <box
            style={{
              position: 'absolute',
              top: Math.floor(height / 2) - Math.floor(modalHeight / 2),
              left: Math.floor(width / 2) - 22,
              width: 44,
              height: modalHeight,
            }}
          >
            <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
              <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
                <text content={` ${fieldDef?.label ?? filterModal.fieldId}`} fg="#7aa2f7" />
              </box>
              <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
                <text content={'─'.repeat(44)} fg="#292e42" />
              </box>
              {options.map((opt, i) => {
                const isActive = i === filterModal.selectedIndex;
                const isChecked = filterModal.selected.includes(opt.value);
                return (
                  <box
                    key={opt.value}
                    style={{
                      height: 1,
                      width: '100%',
                      backgroundColor: isActive ? '#292e42' : '#1a1b26',
                    }}
                  >
                    <text
                      content={` ${isActive ? '>' : ' '} [${isChecked ? '✓' : ' '}] ${opt.label}`}
                      fg={isChecked ? (isActive ? '#c0caf5' : '#7aa2f7') : (isActive ? '#a9b1d6' : '#565f89')}
                    />
                  </box>
                );
              })}
              <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
                <text content=" Enter/Space toggle | Esc apply & back" fg="#565f89" />
              </box>
            </box>
          </box>
        );
      })()}
```

**Step 4: Verify build**

Run: `npx tsc --noEmit -p packages/git-switchboard/tsconfig.json`
Expected: Clean

**Step 5: Commit**

```
feat: add multiselect-picker for status field filters
```

---

### Task 9: Build save-preset sub-level

**Files:**
- Modify: `packages/git-switchboard/src/pr-app.tsx`

**Step 1: Add save-preset keyboard handler**

Inside the `useFocusedKeyboard` for filter-modal:

```typescript
    if (filterModal.level === 'save-preset') {
      switch (key.name) {
        case 'return': {
          if (filterModal.inputValue.trim()) {
            const preset: FilterPreset = {
              label: filterModal.inputValue.trim(),
              filters: { ...filters },
            };
            const next = [...filterPresets, preset];
            setFilterPresets(next);
            void writeFilterPresets(PR_VIEW_NAME, next);
          }
          setFilterModal({ level: 'fields', selectedIndex: 0 });
          break;
        }
        case 'escape':
          setFilterModal({ level: 'fields', selectedIndex: 0 });
          break;
        case 'backspace':
          setFilterModal({ ...filterModal, inputValue: filterModal.inputValue.slice(0, -1) });
          break;
        default:
          if (key.raw && key.raw.length >= 1 && key.raw >= ' ') {
            setFilterModal({ ...filterModal, inputValue: filterModal.inputValue + key.raw });
          }
          break;
      }
    }
```

**Step 2: Render save-preset modal**

```typescript
      {filterModal?.level === 'save-preset' && (
        <box
          style={{
            position: 'absolute',
            top: Math.floor(height / 2) - 2,
            left: Math.floor(width / 2) - 22,
            width: 44,
            height: 4,
          }}
        >
          <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text content=" Save Filter Preset" fg="#7aa2f7" />
            </box>
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text content={'─'.repeat(44)} fg="#292e42" />
            </box>
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text content={` Name: ${filterModal.inputValue}█`} fg="#c0caf5" />
            </box>
            <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
              <text content=" Enter save | Esc cancel" fg="#565f89" />
            </box>
          </box>
        </box>
      )}
```

**Step 3: Verify build**

Run: `npx tsc --noEmit -p packages/git-switchboard/tsconfig.json`
Expected: Clean

**Step 4: Commit**

```
feat: add save-preset flow to filter modal
```

---

### Task 10: Update header to show active filter count

**Files:**
- Modify: `packages/git-switchboard/src/pr-app.tsx`

**Step 1: Update the header text**

Find the `headerText` const and add filter indicator:

```typescript
  const headerText = ` git-switchboard pr${repoMode ? ` ${repoMode}` : ''}  ${
    searchQuery ? `${filteredPRs.length}/${prs.length}` : String(filteredPRs.length)
  } open PRs${activeFilterCount > 0 ? ` | ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''}` : ''}${
    searchQuery ? ` | Search: ${searchQuery}` : ''
  }${searchMode ? ` | (type to search, [${RETURN_SYMBOL}] confirm)` : ''}`;
```

Since filters now reduce the total count shown, change the PR count logic to show the filtered vs. total when either search or filters are active:

```typescript
  const isFiltered = activeFilterCount > 0 || !!searchQuery;
  const headerText = ` git-switchboard pr${repoMode ? ` ${repoMode}` : ''}  ${
    isFiltered ? `${filteredPRs.length}/${prs.length}` : String(filteredPRs.length)
  } open PRs${activeFilterCount > 0 ? ` | ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''}` : ''}${
    searchQuery ? ` | Search: ${searchQuery}` : ''
  }${searchMode ? ` | (type to search, [${RETURN_SYMBOL}] confirm)` : ''}`;
```

**Step 2: Verify build**

Run: `npx tsc --noEmit -p packages/git-switchboard/tsconfig.json`
Expected: Clean

**Step 3: Commit**

```
feat: show active filter count in header
```

---

### Task 11: Final verification

**Step 1: Full type-check**

Run: `npx tsc --noEmit -p packages/git-switchboard/tsconfig.json`
Expected: Clean

**Step 2: Run tests**

Run: `npx tsx --test packages/git-switchboard/src/store.test.ts`
Expected: All pass

**Step 3: Verify no unused imports**

Scan `pr-app.tsx` for unused imports and remove any.

**Step 4: Final commit**

```
chore: clean up unused imports and verify build
```

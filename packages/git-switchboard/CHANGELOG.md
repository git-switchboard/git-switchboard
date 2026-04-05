## 0.0.0-beta.8 (2026-04-05)

This was a version bump only for git-switchboard to align it with other projects, there were no code changes.

## 0.1.2-beta.2 (2026-04-04)

This was a version bump only for git-switchboard to align it with other projects, there were no code changes.

## 0.1.2-beta.0 (2026-04-04)

This was a version bump only for git-switchboard to align it with other projects, there were no code changes.

## 0.1.1 (2026-04-04)

### 🩹 Fixes

- restore windows-arm64 target, update @opentui to 0.1.96 ([e80dddc](https://github.com/git-switchboard/git-switchboard/commit/e80dddc))

### ❤️ Thank You

- Claude

## 0.0.1-beta.3 (2026-04-04)

### 🩹 Fixes

- restore windows-arm64 target, update @opentui to 0.1.96 ([e80dddc](https://github.com/git-switchboard/git-switchboard/commit/e80dddc))

### ❤️ Thank You

- Claude

## 0.1.0 (2026-04-04)

### 🚀 Features

- chunked PR refresh and viewport-aware prefetching ([ec84e00](https://github.com/git-switchboard/git-switchboard/commit/ec84e00))
- add refreshPRs, lazy repo scan, and cache persistence to store ([04a9dd6](https://github.com/git-switchboard/git-switchboard/commit/04a9dd6))
- improve PR cache with snapshot reads and cache merging ([0eb9c27](https://github.com/git-switchboard/git-switchboard/commit/0eb9c27))
- more work on pr dashboard + some docs-site stuff ([6c8027f](https://github.com/git-switchboard/git-switchboard/commit/6c8027f))
- add auto-generated CLI docs and terminal demo captures ([3ff005d](https://github.com/git-switchboard/git-switchboard/commit/3ff005d))
- add inline editor opening and PR refresh to TUI ([42b3b57](https://github.com/git-switchboard/git-switchboard/commit/42b3b57))
- cross-compilation build scripts and JS bundle fallback ([89928f9](https://github.com/git-switchboard/git-switchboard/commit/89928f9))
- **git-switchboard:** sort PR list by review status then updated ([4a2ca36](https://github.com/git-switchboard/git-switchboard/commit/4a2ca36))
- **git-switchboard:** include PRs assigned to me alongside authored ([10391ea](https://github.com/git-switchboard/git-switchboard/commit/10391ea))
- **git-switchboard:** show GitHub API rate limit in footer ([04adae9](https://github.com/git-switchboard/git-switchboard/commit/04adae9))
- **git-switchboard:** seed CI + review caches from initial search query ([30212ec](https://github.com/git-switchboard/git-switchboard/commit/30212ec))
- **git-switchboard:** animate spinner for pending checks in PR list ([62cf391](https://github.com/git-switchboard/git-switchboard/commit/62cf391))
- **git-switchboard:** gql.tada type inference, fork detection, scalar config ([710f8af](https://github.com/git-switchboard/git-switchboard/commit/710f8af))
- **git-switchboard:** GraphQL migration, CI summary, review detail ([ea099b4](https://github.com/git-switchboard/git-switchboard/commit/ea099b4))
- **git-switchboard:** add review status column to PR dashboard ([8b27f0e](https://github.com/git-switchboard/git-switchboard/commit/8b27f0e))
- **git-switchboard:** style check rows by status, sort, spinner, time formatting ([0680725](https://github.com/git-switchboard/git-switchboard/commit/0680725))
- **git-switchboard:** open PR in browser action, check timestamps, layout polish ([1be2f65](https://github.com/git-switchboard/git-switchboard/commit/1be2f65))
- **git-switchboard:** copy check logs, refresh CI with spinner, use clipboardy ([97e082d](https://github.com/git-switchboard/git-switchboard/commit/97e082d))
- **git-switchboard:** actions block in detail view, clipboard copy ([0b02dd8](https://github.com/git-switchboard/git-switchboard/commit/0b02dd8))
- **git-switchboard:** wire CI detail view, watch polling, and exports ([1325b24](https://github.com/git-switchboard/git-switchboard/commit/1325b24))
- **git-switchboard:** add CI column, sort by updated, c hotkey ([a038989](https://github.com/git-switchboard/git-switchboard/commit/a038989))
- **git-switchboard:** add CI checks, PR detail view, and notifications ([aa4f6bc](https://github.com/git-switchboard/git-switchboard/commit/aa4f6bc))
- **git-switchboard:** add Updated column to PR dashboard ([58d7cf8](https://github.com/git-switchboard/git-switchboard/commit/58d7cf8))
- **git-switchboard:** add progress gauge for repo scanning ([beb0265](https://github.com/git-switchboard/git-switchboard/commit/beb0265))
- **git-switchboard:** detailed progress gauges during PR fetch and scan ([3e419c5](https://github.com/git-switchboard/git-switchboard/commit/3e419c5))
- **git-switchboard:** add loading screen during PR fetch and repo scan ([3fb1d9e](https://github.com/git-switchboard/git-switchboard/commit/3fb1d9e))
- **git-switchboard:** resolve GitHub token from gh CLI as fallback ([44c6c40](https://github.com/git-switchboard/git-switchboard/commit/44c6c40))
- **git-switchboard:** wire up PR subcommand with full workflow ([587576f](https://github.com/git-switchboard/git-switchboard/commit/587576f))
- **git-switchboard:** add PR dashboard, clone selection, and editor TUI components ([8c5b06a](https://github.com/git-switchboard/git-switchboard/commit/8c5b06a))
- **git-switchboard:** add scanner, editor detection, and global PR listing ([22835ad](https://github.com/git-switchboard/git-switchboard/commit/22835ad))
- **git-switchboard:** add CLI entry point ([4bf9e55](https://github.com/git-switchboard/git-switchboard/commit/4bf9e55))
- **git-switchboard:** add TUI application component ([e564539](https://github.com/git-switchboard/git-switchboard/commit/e564539))
- **git-switchboard:** add GitHub PR enrichment ([06bc2c8](https://github.com/git-switchboard/git-switchboard/commit/06bc2c8))
- **git-switchboard:** add git data layer ([bb56c40](https://github.com/git-switchboard/git-switchboard/commit/bb56c40))
- **git-switchboard:** scaffold package structure ([c31cd57](https://github.com/git-switchboard/git-switchboard/commit/c31cd57))

### 🩹 Fixes

- resolve CI pipeline failures ([#2](https://github.com/git-switchboard/git-switchboard/pull/2), [#9151](https://github.com/git-switchboard/git-switchboard/issues/9151))
- **repo:** setup native release matrix ([7362c35](https://github.com/git-switchboard/git-switchboard/commit/7362c35))
- add invalid target error and update repo URLs ([c6ff429](https://github.com/git-switchboard/git-switchboard/commit/c6ff429))
- **git-switchboard:** preserve PR list state when fetching CI ([1283a7b](https://github.com/git-switchboard/git-switchboard/commit/1283a7b))
- **git-switchboard:** restore Ctrl+C exit via useExitOnCtrlC hook ([2656977](https://github.com/git-switchboard/git-switchboard/commit/2656977))
- **git-switchboard:** fix search, header alignment, rate limit positioning ([d8a8541](https://github.com/git-switchboard/git-switchboard/commit/d8a8541))
- **git-switchboard:** fix infinite recursion in createOctokit ([95ca0e2](https://github.com/git-switchboard/git-switchboard/commit/95ca0e2))
- **git-switchboard:** handle Ctrl+C without yoga WASM crash ([5d1ce60](https://github.com/git-switchboard/git-switchboard/commit/5d1ce60))
- **git-switchboard:** fix GraphQL query variable name collision ([9f15cca](https://github.com/git-switchboard/git-switchboard/commit/9f15cca))
- **git-switchboard:** fix yoga-layout WASM crash on view transitions ([589a202](https://github.com/git-switchboard/git-switchboard/commit/589a202))
- **git-switchboard:** fix column alignment and author filter matching ([eee45d1](https://github.com/git-switchboard/git-switchboard/commit/eee45d1))
- **git-switchboard:** spacing, back navigation, and branch detection ([171ea32](https://github.com/git-switchboard/git-switchboard/commit/171ea32))
- **git-switchboard:** fix scroll navigation and add padding ([92bbce4](https://github.com/git-switchboard/git-switchboard/commit/92bbce4))
- **git-switchboard:** surface actionable error info for GitHub API failures ([cd959d9](https://github.com/git-switchboard/git-switchboard/commit/cd959d9))
- **git-switchboard:** replace scrollbox with manual scroll for keyboard control ([a644d8e](https://github.com/git-switchboard/git-switchboard/commit/a644d8e))
- **git-switchboard:** fix garbled text in header and footer ([c50e1e4](https://github.com/git-switchboard/git-switchboard/commit/c50e1e4))
- **git-switchboard:** resolve type errors and build configuration ([01cdac6](https://github.com/git-switchboard/git-switchboard/commit/01cdac6))

### 🔥 Performance

- **git-switchboard:** optimize scanner for speed ([e571bd9](https://github.com/git-switchboard/git-switchboard/commit/e571bd9))

### ❤️ Thank You

- Claude
- Craigory Coppola @AgentEnder

## 0.0.1-beta.1 (2026-04-04)

### 🚀 Features

- chunked PR refresh and viewport-aware prefetching ([ec84e00](https://github.com/git-switchboard/git-switchboard/commit/ec84e00))
- add refreshPRs, lazy repo scan, and cache persistence to store ([04a9dd6](https://github.com/git-switchboard/git-switchboard/commit/04a9dd6))
- improve PR cache with snapshot reads and cache merging ([0eb9c27](https://github.com/git-switchboard/git-switchboard/commit/0eb9c27))
- more work on pr dashboard + some docs-site stuff ([6c8027f](https://github.com/git-switchboard/git-switchboard/commit/6c8027f))
- add auto-generated CLI docs and terminal demo captures ([3ff005d](https://github.com/git-switchboard/git-switchboard/commit/3ff005d))
- add inline editor opening and PR refresh to TUI ([42b3b57](https://github.com/git-switchboard/git-switchboard/commit/42b3b57))
- cross-compilation build scripts and JS bundle fallback ([89928f9](https://github.com/git-switchboard/git-switchboard/commit/89928f9))
- **git-switchboard:** sort PR list by review status then updated ([4a2ca36](https://github.com/git-switchboard/git-switchboard/commit/4a2ca36))
- **git-switchboard:** include PRs assigned to me alongside authored ([10391ea](https://github.com/git-switchboard/git-switchboard/commit/10391ea))
- **git-switchboard:** show GitHub API rate limit in footer ([04adae9](https://github.com/git-switchboard/git-switchboard/commit/04adae9))
- **git-switchboard:** seed CI + review caches from initial search query ([30212ec](https://github.com/git-switchboard/git-switchboard/commit/30212ec))
- **git-switchboard:** animate spinner for pending checks in PR list ([62cf391](https://github.com/git-switchboard/git-switchboard/commit/62cf391))
- **git-switchboard:** gql.tada type inference, fork detection, scalar config ([710f8af](https://github.com/git-switchboard/git-switchboard/commit/710f8af))
- **git-switchboard:** GraphQL migration, CI summary, review detail ([ea099b4](https://github.com/git-switchboard/git-switchboard/commit/ea099b4))
- **git-switchboard:** add review status column to PR dashboard ([8b27f0e](https://github.com/git-switchboard/git-switchboard/commit/8b27f0e))
- **git-switchboard:** style check rows by status, sort, spinner, time formatting ([0680725](https://github.com/git-switchboard/git-switchboard/commit/0680725))
- **git-switchboard:** open PR in browser action, check timestamps, layout polish ([1be2f65](https://github.com/git-switchboard/git-switchboard/commit/1be2f65))
- **git-switchboard:** copy check logs, refresh CI with spinner, use clipboardy ([97e082d](https://github.com/git-switchboard/git-switchboard/commit/97e082d))
- **git-switchboard:** actions block in detail view, clipboard copy ([0b02dd8](https://github.com/git-switchboard/git-switchboard/commit/0b02dd8))
- **git-switchboard:** wire CI detail view, watch polling, and exports ([1325b24](https://github.com/git-switchboard/git-switchboard/commit/1325b24))
- **git-switchboard:** add CI column, sort by updated, c hotkey ([a038989](https://github.com/git-switchboard/git-switchboard/commit/a038989))
- **git-switchboard:** add CI checks, PR detail view, and notifications ([aa4f6bc](https://github.com/git-switchboard/git-switchboard/commit/aa4f6bc))
- **git-switchboard:** add Updated column to PR dashboard ([58d7cf8](https://github.com/git-switchboard/git-switchboard/commit/58d7cf8))
- **git-switchboard:** add progress gauge for repo scanning ([beb0265](https://github.com/git-switchboard/git-switchboard/commit/beb0265))
- **git-switchboard:** detailed progress gauges during PR fetch and scan ([3e419c5](https://github.com/git-switchboard/git-switchboard/commit/3e419c5))
- **git-switchboard:** add loading screen during PR fetch and repo scan ([3fb1d9e](https://github.com/git-switchboard/git-switchboard/commit/3fb1d9e))
- **git-switchboard:** resolve GitHub token from gh CLI as fallback ([44c6c40](https://github.com/git-switchboard/git-switchboard/commit/44c6c40))
- **git-switchboard:** wire up PR subcommand with full workflow ([587576f](https://github.com/git-switchboard/git-switchboard/commit/587576f))
- **git-switchboard:** add PR dashboard, clone selection, and editor TUI components ([8c5b06a](https://github.com/git-switchboard/git-switchboard/commit/8c5b06a))
- **git-switchboard:** add scanner, editor detection, and global PR listing ([22835ad](https://github.com/git-switchboard/git-switchboard/commit/22835ad))
- **git-switchboard:** add CLI entry point ([4bf9e55](https://github.com/git-switchboard/git-switchboard/commit/4bf9e55))
- **git-switchboard:** add TUI application component ([e564539](https://github.com/git-switchboard/git-switchboard/commit/e564539))
- **git-switchboard:** add GitHub PR enrichment ([06bc2c8](https://github.com/git-switchboard/git-switchboard/commit/06bc2c8))
- **git-switchboard:** add git data layer ([bb56c40](https://github.com/git-switchboard/git-switchboard/commit/bb56c40))
- **git-switchboard:** scaffold package structure ([c31cd57](https://github.com/git-switchboard/git-switchboard/commit/c31cd57))

### 🩹 Fixes

- resolve CI pipeline failures ([#2](https://github.com/git-switchboard/git-switchboard/pull/2), [#9151](https://github.com/git-switchboard/git-switchboard/issues/9151))
- **repo:** setup native release matrix ([7362c35](https://github.com/git-switchboard/git-switchboard/commit/7362c35))
- add invalid target error and update repo URLs ([c6ff429](https://github.com/git-switchboard/git-switchboard/commit/c6ff429))
- **git-switchboard:** preserve PR list state when fetching CI ([1283a7b](https://github.com/git-switchboard/git-switchboard/commit/1283a7b))
- **git-switchboard:** restore Ctrl+C exit via useExitOnCtrlC hook ([2656977](https://github.com/git-switchboard/git-switchboard/commit/2656977))
- **git-switchboard:** fix search, header alignment, rate limit positioning ([d8a8541](https://github.com/git-switchboard/git-switchboard/commit/d8a8541))
- **git-switchboard:** fix infinite recursion in createOctokit ([95ca0e2](https://github.com/git-switchboard/git-switchboard/commit/95ca0e2))
- **git-switchboard:** handle Ctrl+C without yoga WASM crash ([5d1ce60](https://github.com/git-switchboard/git-switchboard/commit/5d1ce60))
- **git-switchboard:** fix GraphQL query variable name collision ([9f15cca](https://github.com/git-switchboard/git-switchboard/commit/9f15cca))
- **git-switchboard:** fix yoga-layout WASM crash on view transitions ([589a202](https://github.com/git-switchboard/git-switchboard/commit/589a202))
- **git-switchboard:** fix column alignment and author filter matching ([eee45d1](https://github.com/git-switchboard/git-switchboard/commit/eee45d1))
- **git-switchboard:** spacing, back navigation, and branch detection ([171ea32](https://github.com/git-switchboard/git-switchboard/commit/171ea32))
- **git-switchboard:** fix scroll navigation and add padding ([92bbce4](https://github.com/git-switchboard/git-switchboard/commit/92bbce4))
- **git-switchboard:** surface actionable error info for GitHub API failures ([cd959d9](https://github.com/git-switchboard/git-switchboard/commit/cd959d9))
- **git-switchboard:** replace scrollbox with manual scroll for keyboard control ([a644d8e](https://github.com/git-switchboard/git-switchboard/commit/a644d8e))
- **git-switchboard:** fix garbled text in header and footer ([c50e1e4](https://github.com/git-switchboard/git-switchboard/commit/c50e1e4))
- **git-switchboard:** resolve type errors and build configuration ([01cdac6](https://github.com/git-switchboard/git-switchboard/commit/01cdac6))

### 🔥 Performance

- **git-switchboard:** optimize scanner for speed ([e571bd9](https://github.com/git-switchboard/git-switchboard/commit/e571bd9))

### ❤️ Thank You

- Claude
- Craigory Coppola @AgentEnder
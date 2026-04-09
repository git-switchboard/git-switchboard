## 0.3.0 (2026-04-09)

### 🚀 Features

- add focus stack for scoped keyboard event handling ([0db3311](https://github.com/git-switchboard/git-switchboard/commit/0db3311))
- reactive data layer, StatusContext CI checks, and filter system ([#12](https://github.com/git-switchboard/git-switchboard/pull/12))

### 🩹 Fixes

- bad choco config ([e6918f4](https://github.com/git-switchboard/git-switchboard/commit/e6918f4))
- scope keyboard handlers with focus stack ([f07ed2d](https://github.com/git-switchboard/git-switchboard/commit/f07ed2d))

### ❤️ Thank You

- Claude
- Craigory Coppola @AgentEnder

## 0.2.0 (2026-04-09)

### 🚀 Features

- persist PR list filter/sort/selection across navigation ([d91833c](https://github.com/git-switchboard/git-switchboard/commit/d91833c))

### ❤️ Thank You

- Claude
- Craigory Coppola @AgentEnder

## 0.1.0 (2026-04-08)

### 🚀 Features

- add config module for ~/.config/git-switchboard ([#11](https://github.com/git-switchboard/git-switchboard/pull/11))
- add `connect` subcommand with provider setup TUI ([#11](https://github.com/git-switchboard/git-switchboard/pull/11))
- add crypto module for AES-256-GCM token encryption ([#11](https://github.com/git-switchboard/git-switchboard/pull/11))
- add TokenStore with multi-strategy token resolution ([#11](https://github.com/git-switchboard/git-switchboard/pull/11))
- add GitHub and Linear provider definitions ([#11](https://github.com/git-switchboard/git-switchboard/pull/11))
- add Linear API client with caching and issue matching ([#11](https://github.com/git-switchboard/git-switchboard/pull/11))
- add provider status modal for rate limit display ([#11](https://github.com/git-switchboard/git-switchboard/pull/11))
- add Linear enrichment columns and `p` keybind to all views ([#11](https://github.com/git-switchboard/git-switchboard/pull/11))
- show token resolution source in connect views ([#11](https://github.com/git-switchboard/git-switchboard/pull/11))
- add whoami validation for provider connections ([#11](https://github.com/git-switchboard/git-switchboard/pull/11))
- add `reset-terminal` command ([#11](https://github.com/git-switchboard/git-switchboard/pull/11))
- **git-switchboard:** worktree conflict resolution, dirty-checkout guards, and branch validation ([#10](https://github.com/git-switchboard/git-switchboard/pull/10))

### 🩹 Fixes

- guard select action against firing during search/sort modal ([2915fa8](https://github.com/git-switchboard/git-switchboard/commit/2915fa8))
- improve Windows and Linux container compatibility ([#11](https://github.com/git-switchboard/git-switchboard/pull/11))
- properly destroy renderer on connect exit ([#11](https://github.com/git-switchboard/git-switchboard/pull/11))
- support paste in all text input fields ([#11](https://github.com/git-switchboard/git-switchboard/pull/11))
- ensure parent directory exists before writing encrypted files ([#11](https://github.com/git-switchboard/git-switchboard/pull/11))
- **docs-site:** docs 404 for guide/pr-workflow by adding workflow pages to prerender routes ([#9](https://github.com/git-switchboard/git-switchboard/pull/9))

### ❤️ Thank You

- Claude
- Craigory Coppola @AgentEnder

## 0.0.2 (2026-04-07)

### 🚀 Features

- cross-compilation build scripts and JS bundle fallback ([89928f9](https://github.com/git-switchboard/git-switchboard/commit/89928f9))
- add packaging configs for brew, chocolatey, and install script ([b5b7424](https://github.com/git-switchboard/git-switchboard/commit/b5b7424))
- add Vike docs site with installation and usage docs ([5d7c08a](https://github.com/git-switchboard/git-switchboard/commit/5d7c08a))
- add e2e test suite with verdaccio and PTY harness ([#7](https://github.com/git-switchboard/git-switchboard/pull/7))
- EJS-based README templates with shared usage partial and validate-readme target ([#1](https://github.com/git-switchboard/git-switchboard/pull/1))
- add inline editor opening and PR refresh to TUI ([42b3b57](https://github.com/git-switchboard/git-switchboard/commit/42b3b57))
- add auto-generated CLI docs and terminal demo captures ([3ff005d](https://github.com/git-switchboard/git-switchboard/commit/3ff005d))
- redesign docs site with Terminal Luxe theme ([9f8f2c7](https://github.com/git-switchboard/git-switchboard/commit/9f8f2c7))
- more work on pr dashboard + some docs-site stuff ([6c8027f](https://github.com/git-switchboard/git-switchboard/commit/6c8027f))
- improve PR cache with snapshot reads and cache merging ([0eb9c27](https://github.com/git-switchboard/git-switchboard/commit/0eb9c27))
- add refreshPRs, lazy repo scan, and cache persistence to store ([04a9dd6](https://github.com/git-switchboard/git-switchboard/commit/04a9dd6))
- chunked PR refresh and viewport-aware prefetching ([ec84e00](https://github.com/git-switchboard/git-switchboard/commit/ec84e00))
- polish docs-site and extract keybinds from the app ([31421aa](https://github.com/git-switchboard/git-switchboard/commit/31421aa))
- pagefind search with scoped content indexing ([25a1f87](https://github.com/git-switchboard/git-switchboard/commit/25a1f87))
- code block copy buttons and contained horizontal scrolling ([9e3a83e](https://github.com/git-switchboard/git-switchboard/commit/9e3a83e))
- **git-switchboard:** scaffold package structure ([c31cd57](https://github.com/git-switchboard/git-switchboard/commit/c31cd57))
- **git-switchboard:** add git data layer ([bb56c40](https://github.com/git-switchboard/git-switchboard/commit/bb56c40))
- **git-switchboard:** add GitHub PR enrichment ([06bc2c8](https://github.com/git-switchboard/git-switchboard/commit/06bc2c8))
- **git-switchboard:** add TUI application component ([e564539](https://github.com/git-switchboard/git-switchboard/commit/e564539))
- **git-switchboard:** add CLI entry point ([4bf9e55](https://github.com/git-switchboard/git-switchboard/commit/4bf9e55))
- **git-switchboard:** add scanner, editor detection, and global PR listing ([22835ad](https://github.com/git-switchboard/git-switchboard/commit/22835ad))
- **git-switchboard:** add PR dashboard, clone selection, and editor TUI components ([8c5b06a](https://github.com/git-switchboard/git-switchboard/commit/8c5b06a))
- **git-switchboard:** wire up PR subcommand with full workflow ([587576f](https://github.com/git-switchboard/git-switchboard/commit/587576f))
- **git-switchboard:** resolve GitHub token from gh CLI as fallback ([44c6c40](https://github.com/git-switchboard/git-switchboard/commit/44c6c40))
- **git-switchboard:** add loading screen during PR fetch and repo scan ([3fb1d9e](https://github.com/git-switchboard/git-switchboard/commit/3fb1d9e))
- **git-switchboard:** detailed progress gauges during PR fetch and scan ([3e419c5](https://github.com/git-switchboard/git-switchboard/commit/3e419c5))
- **git-switchboard:** add progress gauge for repo scanning ([beb0265](https://github.com/git-switchboard/git-switchboard/commit/beb0265))
- **git-switchboard:** add Updated column to PR dashboard ([58d7cf8](https://github.com/git-switchboard/git-switchboard/commit/58d7cf8))
- **git-switchboard:** add CI checks, PR detail view, and notifications ([aa4f6bc](https://github.com/git-switchboard/git-switchboard/commit/aa4f6bc))
- **git-switchboard:** add CI column, sort by updated, c hotkey ([a038989](https://github.com/git-switchboard/git-switchboard/commit/a038989))
- **git-switchboard:** wire CI detail view, watch polling, and exports ([1325b24](https://github.com/git-switchboard/git-switchboard/commit/1325b24))
- **git-switchboard:** actions block in detail view, clipboard copy ([0b02dd8](https://github.com/git-switchboard/git-switchboard/commit/0b02dd8))
- **git-switchboard:** copy check logs, refresh CI with spinner, use clipboardy ([97e082d](https://github.com/git-switchboard/git-switchboard/commit/97e082d))
- **git-switchboard:** open PR in browser action, check timestamps, layout polish ([1be2f65](https://github.com/git-switchboard/git-switchboard/commit/1be2f65))
- **git-switchboard:** style check rows by status, sort, spinner, time formatting ([0680725](https://github.com/git-switchboard/git-switchboard/commit/0680725))
- **git-switchboard:** add review status column to PR dashboard ([8b27f0e](https://github.com/git-switchboard/git-switchboard/commit/8b27f0e))
- **git-switchboard:** GraphQL migration, CI summary, review detail ([ea099b4](https://github.com/git-switchboard/git-switchboard/commit/ea099b4))
- **git-switchboard:** gql.tada type inference, fork detection, scalar config ([710f8af](https://github.com/git-switchboard/git-switchboard/commit/710f8af))
- **git-switchboard:** animate spinner for pending checks in PR list ([62cf391](https://github.com/git-switchboard/git-switchboard/commit/62cf391))
- **git-switchboard:** seed CI + review caches from initial search query ([30212ec](https://github.com/git-switchboard/git-switchboard/commit/30212ec))
- **git-switchboard:** show GitHub API rate limit in footer ([04adae9](https://github.com/git-switchboard/git-switchboard/commit/04adae9))
- **git-switchboard:** include PRs assigned to me alongside authored ([10391ea](https://github.com/git-switchboard/git-switchboard/commit/10391ea))
- **git-switchboard:** sort PR list by review status then updated ([4a2ca36](https://github.com/git-switchboard/git-switchboard/commit/4a2ca36))
- **repo:** merge main from /Users/agentender/repos/craigory-dev ([7f719b1](https://github.com/git-switchboard/git-switchboard/commit/7f719b1))

### 🩹 Fixes

- add invalid target error and update repo URLs ([c6ff429](https://github.com/git-switchboard/git-switchboard/commit/c6ff429))
- add npm auth token, fix docs path resolution, install nx-github-pages ([cf54ced](https://github.com/git-switchboard/git-switchboard/commit/cf54ced))
- resolve CI pipeline failures ([#2](https://github.com/git-switchboard/git-switchboard/pull/2), [#9151](https://github.com/git-switchboard/git-switchboard/issues/9151))
- add bun setup to deploy-docs and release version jobs ([#3](https://github.com/git-switchboard/git-switchboard/pull/3))
- remove unsupported --yes flag from nx release subcommands ([#4](https://github.com/git-switchboard/git-switchboard/pull/4))
- remove duplicate shebang causing syntax error on install ([#7](https://github.com/git-switchboard/git-switchboard/pull/7))
- render blank terminal frame lines with correct height ([d71ea0c](https://github.com/git-switchboard/git-switchboard/commit/d71ea0c))
- anchor sidebar to viewport edge and restore grid background ([a55b7b5](https://github.com/git-switchboard/git-switchboard/commit/a55b7b5))
- ensure generated/ directory exists before each generate script ([#8](https://github.com/git-switchboard/git-switchboard/pull/8))
- **ci:** add git push after versioning, fix choco publish on ubuntu ([e2a721d](https://github.com/git-switchboard/git-switchboard/commit/e2a721d))
- **ci:** work around npm self-upgrade crash in CI workflows ([#9151](https://github.com/git-switchboard/git-switchboard/issues/9151))
- **git-switchboard:** resolve type errors and build configuration ([01cdac6](https://github.com/git-switchboard/git-switchboard/commit/01cdac6))
- **git-switchboard:** fix garbled text in header and footer ([c50e1e4](https://github.com/git-switchboard/git-switchboard/commit/c50e1e4))
- **git-switchboard:** replace scrollbox with manual scroll for keyboard control ([a644d8e](https://github.com/git-switchboard/git-switchboard/commit/a644d8e))
- **git-switchboard:** surface actionable error info for GitHub API failures ([cd959d9](https://github.com/git-switchboard/git-switchboard/commit/cd959d9))
- **git-switchboard:** fix scroll navigation and add padding ([92bbce4](https://github.com/git-switchboard/git-switchboard/commit/92bbce4))
- **git-switchboard:** spacing, back navigation, and branch detection ([171ea32](https://github.com/git-switchboard/git-switchboard/commit/171ea32))
- **git-switchboard:** fix column alignment and author filter matching ([eee45d1](https://github.com/git-switchboard/git-switchboard/commit/eee45d1))
- **git-switchboard:** fix yoga-layout WASM crash on view transitions ([589a202](https://github.com/git-switchboard/git-switchboard/commit/589a202))
- **git-switchboard:** fix GraphQL query variable name collision ([9f15cca](https://github.com/git-switchboard/git-switchboard/commit/9f15cca))
- **git-switchboard:** handle Ctrl+C without yoga WASM crash ([5d1ce60](https://github.com/git-switchboard/git-switchboard/commit/5d1ce60))
- **git-switchboard:** fix infinite recursion in createOctokit ([95ca0e2](https://github.com/git-switchboard/git-switchboard/commit/95ca0e2))
- **git-switchboard:** fix search, header alignment, rate limit positioning ([d8a8541](https://github.com/git-switchboard/git-switchboard/commit/d8a8541))
- **git-switchboard:** restore Ctrl+C exit via useExitOnCtrlC hook ([2656977](https://github.com/git-switchboard/git-switchboard/commit/2656977))
- **git-switchboard:** preserve PR list state when fetching CI ([1283a7b](https://github.com/git-switchboard/git-switchboard/commit/1283a7b))
- **repo:** setup native release matrix ([7362c35](https://github.com/git-switchboard/git-switchboard/commit/7362c35))

### 🔥 Performance

- **git-switchboard:** optimize scanner for speed ([e571bd9](https://github.com/git-switchboard/git-switchboard/commit/e571bd9))

### ❤️ Thank You

- Claude
- Craigory Coppola @AgentEnder
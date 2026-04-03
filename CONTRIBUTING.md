# Contributing to git-switchboard

## Prerequisites

- [Bun](https://bun.sh) — runtime and bundler
- [pnpm](https://pnpm.io) (v10.24+) — package manager
- [Node.js](https://nodejs.org) (v22+) — required by Nx and some tooling

## Getting Started

```bash
pnpm install
```

## Monorepo Structure

This is a pnpm workspace monorepo managed by [Nx](https://nx.dev).

```
packages/
  git-switchboard/     # Main CLI + TUI application
docs-site/             # Vike-based documentation site
docs/                  # Markdown documentation source
packaging/             # Distribution configs (Homebrew, Chocolatey, install script)
```

## Using Nx

Nx is the build orchestrator. It handles caching, task dependencies, and running scripts across packages. You do **not** need to install Nx globally — use `npx nx` or `pnpm nx`.

### Common Commands

| Command | What it does |
|---------|-------------|
| `npx nx git-switchboard` | Run the CLI in development (via `bun`) |
| `npx nx run git-switchboard:build` | Build the CLI to `dist/` |
| `npx nx run git-switchboard:typecheck` | Type-check without emitting |
| `npx nx run-many -t typecheck` | Type-check all packages |
| `npx nx run-many -t build` | Build all packages |

> When you point `nx` at just a project name (e.g. `nx git-switchboard`), it runs the `run` target automatically.

You can also run the CLI directly with Bun, bypassing Nx entirely:

```bash
bun run ./packages/git-switchboard/src/cli.ts
bun run ./packages/git-switchboard/src/cli.ts pr
bun run ./packages/git-switchboard/src/cli.ts pr --editor code
```

Or use the package-level scripts:

```bash
cd packages/git-switchboard
pnpm dev          # bun run src/cli.ts
pnpm build        # bun build → dist/git-switchboard.js
pnpm typecheck    # tsc --noEmit
```

### Nx Caching

`build` and `typecheck` targets are cached. If inputs haven't changed, Nx replays the output instantly. The cache lives in `.nx/` (gitignored). To clear it:

```bash
npx nx reset
```

### Viewing the Project Graph

```bash
npx nx graph
```

This opens a browser visualization of the dependency graph between packages and their targets.

### Listing Projects

```bash
npx nx show projects --json
```

## Development Workflow

### Running the TUI Locally

```bash
# Branch picker mode (run from a git repo)
npx nx git-switchboard

# PR dashboard mode
npx nx git-switchboard pr

# With arguments
npx nx git-switchboard pr --editor code --search-root ~/repos

# Or directly with Bun (no Nx overhead)
bun run ./packages/git-switchboard/src/cli.ts pr
```

Use `--` only if an argument conflicts with an Nx flag (e.g. `--help`).

### Tech Stack

- **Runtime:** Bun
- **TUI framework:** [@opentui/react](https://github.com/nicktomlin/opentui) (React for terminals)
- **State management:** Zustand
- **CLI parsing:** cli-forge
- **GitHub API:** @octokit/rest + GraphQL via gql.tada

### TypeScript

Strict mode is enabled. The project uses:

- `moduleResolution: "Bundler"` — ESM with `.js` extensions in imports
- `jsx: "react-jsx"` with `@opentui/react` as the JSX source
- gql.tada for type-safe GraphQL (schema types in `src/graphql-env.d.ts`)

### Tests

Tests use the built-in `node:test` runner:

```bash
bun test packages/git-switchboard/src/store.test.ts
```

## Docs Site

The docs site uses Vike (Vite SSR) with React, Tailwind CSS, and Pagefind for search.

```bash
cd docs-site
pnpm dev           # Dev server
pnpm build         # Production build (runs generate first)
```

The `generate` step auto-generates:
- CLI documentation from cli-forge introspection
- TUI demo frame screenshots from @opentui/react test-utils

Generated files go to `docs-site/generated/` (gitignored).

## Native Builds

Standalone binaries are compiled for 6 platform/arch targets:

```bash
# Build for a specific target
npx nx run git-switchboard:build:native -- bun-darwin-arm64

# Available targets:
# bun-darwin-arm64, bun-darwin-x64
# bun-linux-x64, bun-linux-arm64
# bun-windows-x64, bun-windows-arm64
```

Output goes to `native-builds/` (gitignored).

## CI

Three GitHub Actions workflows:

- **ci.yml** — Runs `typecheck` and `build` on PRs
- **release.yml** — Versioning (conventional commits), native builds, npm publish, Homebrew/Chocolatey distribution
- **deploy-docs.yml** — Deploys docs site to GitHub Pages on push to main

## Releases

Releases use Nx Release with conventional commits:

```bash
# Dry-run version bump
npx nx release version --dry-run

# Full release (CI handles this via release.yml)
npx nx release
```

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` — minor version bump
- `fix:` — patch version bump
- `feat!:` or `BREAKING CHANGE:` — major version bump

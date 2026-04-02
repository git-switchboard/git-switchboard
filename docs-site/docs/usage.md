---
title: Usage
order: 2
---

# Usage

## Branch Picker (default)

Launch the interactive branch picker:

```sh
git-switchboard
```

### Options

| Flag | Description |
|------|-------------|
| `-r, --remote` | Include remote branches |
| `-a, --author <name>` | Filter by author name(s) |
| `--github-token <token>` | GitHub token for PR enrichment |
| `--no-pr` | Skip PR enrichment |

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| Up/Down or j/k | Navigate |
| Enter | Checkout selected branch |
| / | Search |
| q or Esc | Quit |

## PR Dashboard

Browse your open PRs across all GitHub repos:

```sh
git-switchboard pr
```

### Options

| Flag | Description |
|------|-------------|
| `--search-root <dir>` | Directories to scan for git repos (default: ~/repos) |
| `--search-depth <n>` | Max scan depth (default: 3) |
| `--editor <cmd>` | Editor to open repos in |
| `--github-token <token>` | GitHub token |

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| Up/Down or j/k | Navigate |
| Enter | Select PR (choose clone, checkout, open in editor) |
| c | Fetch/refresh CI status |
| / | Search |
| q or Esc | Quit |

### PR Detail View

| Key | Action |
|-----|--------|
| Enter | Open in editor |
| c | Copy check logs |
| r | Refresh CI |
| t | Retry failed checks |
| w | Toggle watch mode |
| Left or Esc | Back to list |

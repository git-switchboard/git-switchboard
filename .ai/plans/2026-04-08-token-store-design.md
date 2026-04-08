# TokenStore & `connect` Command Design

**Date**: 2026-04-08
**Status**: Approved

## Overview

A generalized token management system for git-switchboard that supports multiple providers (GitHub, Linear) with pluggable storage strategies. Includes a `connect` subcommand with an interactive TUI for managing provider tokens.

## Architecture

### Token Resolution Chain

For each provider, tokens resolve in order:

1. **CLI flag** (e.g., `--github-token <val>`)
2. **TokenStore strategies** from `config.json` — tried in key order (includes `env`, `encrypted`, `password`, `command`)
3. **Provider-specific fallbacks** (e.g., `gh auth token` for GitHub)
4. If all fail and token is required → error

### Storage Strategies

| Strategy    | Config value  | Storage                          | On launch                     |
| ----------- | ------------- | -------------------------------- | ----------------------------- |
| `env`       | var name      | Nothing stored — reads env var   | Read env var                  |
| `encrypted` | file path     | AES-256-GCM with machine key    | Auto-decrypt, no prompt       |
| `password`  | file path     | AES-256-GCM with user password  | Prompt for password           |
| `command`   | shell command | Nothing stored — runs command    | Execute command, use stdout   |

### Machine Key Derivation

`SHA-256(hostname + username + hardcoded-salt)` → used as AES-256-GCM key.

Machine-specific: `.enc` files are useless if copied to another machine.

### Password Strategy Validation

When encrypting with a password:
- Store `SHA-256(raw_token)` alongside the ciphertext in the `.enc` file
- On decrypt: hash the result and compare — mismatch means wrong password

### File Layout

```
~/.config/git-switchboard/
├── config.json
└── credentials/
    ├── github.enc
    └── linear.enc
```

### config.json Format

```json
{
  "tokens": {
    "github": {
      "env": "GH_TOKEN",
      "encrypted": "~/.config/git-switchboard/credentials/github.enc",
      "command": "gh auth token"
    },
    "linear": {
      "env": "LINEAR_TOKEN",
      "password": "~/.config/git-switchboard/credentials/linear.enc"
    }
  }
}
```

Key order in the strategy object = priority order. First one that succeeds wins. If all throw, fail.

## CLI Changes

### New: `connect` subcommand

- `git-switchboard connect` — provider list view (interactive)
- `git-switchboard connect <provider>` — setup flow for a specific provider

### Existing flags unchanged

- `--github-token` still works as highest-priority override
- `GH_TOKEN`, `GITHUB_TOKEN`, `LINEAR_TOKEN` env vars still work
- `gh auth token` fallback still works for GitHub

### Linear enrichment

Activated automatically when a Linear token resolves (no `--linear` flag). Similar to how GitHub PR enrichment works when a GitHub token is available.

## TUI Views

### Provider List (`connect` with no args)

```
Manage Connections

> github   ✓ connected (encrypted)
  linear   ✗ not configured

[enter] view details  [q] quit
```

Selecting a provider opens the provider detail view.

### Provider Detail View

```
GitHub

  Status: ✓ connected (encrypted)
  Settings: https://github.com/settings/tokens

  [s] setup new token  [d] disconnect  [backspace] back
```

For Linear:
```
Linear

  Status: ✗ not configured
  Settings: https://linear.app/settings/account/security/api-keys/new

  [s] setup new token  [backspace] back
```

### Setup Flow (multi-step)

**Step 1 — Strategy selection:**
```
How would you like to store your Linear token?

> Environment variable
  Encrypted (machine-locked, no password needed)
  Encrypted (password-protected)
  Shell command
```

**Step 2 — Token/command/var input:**
- `env`: text input for the environment variable name (e.g., `LINEAR_TOKEN`)
- `encrypted` / `password`: masked text input for the API token
  - Show a fixed indicator (e.g., blinking cursor or `●`) that doesn't reveal token length
- `command`: visible text input for the shell command

**Step 3 — Password input** (only for `password` strategy):
- Masked input for password (same fixed-length indicator)
- Confirm password (enter twice)

**Step 4 — Validation & confirmation:**
- Validate the token (Linear: `viewer` query, GitHub: `/user` endpoint)
- Show: "Linear connected as [display name]. Token saved."
- Return to provider detail view

### Disconnect Flow

From provider detail, pressing `d`:
- Confirm: "Remove GitHub token? [y/n]"
- Deletes `.enc` file and removes provider entry from `config.json`

## New Source Files

| File                       | Purpose                                        |
| -------------------------- | ---------------------------------------------- |
| `src/token-store.ts`       | Core TokenStore: encrypt/decrypt/resolve/config |
| `src/connect-router.tsx`   | Router for connect subcommand views             |
| `src/connect-list.tsx`     | Provider list view                              |
| `src/connect-detail.tsx`   | Provider detail view                            |
| `src/connect-setup.tsx`    | Multi-step setup flow                           |
| `src/linear.ts`            | Linear API client (GraphQL, viewer query)       |

## Provider Registry

Each provider defines:
- `name`: display name
- `envVars`: list of env var names to check
- `cliFlag`: flag name (if applicable)
- `fallback`: function to try (e.g., `gh auth token`)
- `validate`: function to test a token (returns display name or throws)
- `settingsUrl`: link to provider's token management page

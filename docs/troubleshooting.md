---
title: Troubleshooting
order: 10
---

# Troubleshooting

## Terminal stuck in mouse mode / broken after exit

If git-switchboard exits unexpectedly (crash, `kill`, etc.), your terminal may be left in a bad state where mouse clicks produce garbage characters or the cursor is hidden.

**Quick fix:**

```sh
git-switchboard reset-terminal
```

This sends the ANSI escape sequences to disable mouse tracking and restore the cursor. Safe to run at any time.

**Manual fix** (if `git-switchboard` itself won't run):

```sh
printf '\e[?1000l\e[?1002l\e[?1003l\e[?1006l\e[?25h\e[0m'
```

Or just close and reopen your terminal tab.

## Token not detected

If `git-switchboard connect` shows a provider as "not configured" but you expected it to work:

- **GitHub**: The tool checks in order: `--github-token` flag, configured strategies in `~/.config/git-switchboard/config.json`, `GH_TOKEN` env var, `GITHUB_TOKEN` env var, then `gh auth token` (GitHub CLI fallback).
- **Linear**: Checks: configured strategies in config.json, then `LINEAR_TOKEN` env var.

Run `git-switchboard connect` and select a provider to see its current resolution status and authenticated identity.

## Provider shows "connected" but validation fails

The detail view in `git-switchboard connect` validates the token live. If you see a red error after "Status: connected", the stored token may have been revoked or expired. Press `s` to set up a new token.

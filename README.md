# git-switchboard

Monorepo for [git-switchboard](./packages/git-switchboard/) — an interactive TUI for browsing and checking out git branches.

## Usage

### Branch picker

```sh
git-switchboard              # local branches
git-switchboard -r           # include remote branches
git-switchboard -a "Alice"   # filter by author
```

### PR dashboard

```sh
git-switchboard pr           # list your open PRs across GitHub
```

Scans your local repos, matches PRs to clones, shows CI status and reviews. Select a PR to checkout the branch and open in your editor.

See [packages/git-switchboard/README.md](./packages/git-switchboard/README.md) for installation and usage.

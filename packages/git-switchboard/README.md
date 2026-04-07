# git-switchboard

Interactive TUI for browsing and checking out git branches, with GitHub PR integration.

## Install

**Homebrew** (macOS / Linux):
```sh
brew tap git-switchboard/tap && brew install git-switchboard
```

**Chocolatey** (Windows):
```sh
choco install git-switchboard
```

**Install script** (macOS / Linux):
```sh
curl -fsSL https://raw.githubusercontent.com/git-switchboard/git-switchboard/main/packaging/install.sh | sh
```

**npm** (requires [Bun](https://bun.sh)):
```sh
npx git-switchboard
```

**GitHub Releases**: Download binaries from [Releases](https://github.com/git-switchboard/git-switchboard/releases).

## Usage

### Branch Picker

```sh
git-switchboard              # local branches
git-switchboard -r           # include remote branches
git-switchboard -a "Alice"   # filter by author
```

### PR Dashboard

```sh
git-switchboard pr           # list your open PRs across GitHub
```

Scans your local repos, matches PRs to clones, shows CI status and reviews. Select a PR to checkout the branch and open in your editor.

## Documentation

Full docs: [git-switchboard.com](https://git-switchboard.com)

## License

MIT

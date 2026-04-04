#!/usr/bin/env bun

if (typeof Bun === 'undefined') {
  console.error(
    'git-switchboard requires the Bun runtime.\n' +
    'Install Bun: https://bun.sh\n' +
    'Or download a standalone binary: https://github.com/git-switchboard/git-switchboard/releases'
  );
  process.exit(1);
}

import { cli } from 'cli-forge';

const gitSwitchboard = cli('git-switchboard', {
  description: 'Interactive TUI for browsing and checking out git branches',
  builder: (args) =>
    args
      .option('remote', {
        type: 'boolean',
        alias: ['r'],
        description: 'Include remote branches',
        default: false,
      })
      .option('author', {
        type: 'array',
        items: 'string',
        alias: ['a'],
        description: 'Filter by author name(s)',
      })
      .option('github-token', {
        type: 'string',
        description:
          'GitHub token for PR enrichment (falls back to GH_TOKEN / GITHUB_TOKEN)',
      })
      .option('no-pr', {
        type: 'boolean',
        description: 'Skip PR enrichment even if a token is available',
        default: false,
      })
      .option('ui', {
        type: 'boolean',
        description:
          'Open in a native desktop window (via Electrobun) instead of the terminal TUI',
        default: false,
      })
      .command('pr', {
        description: 'Browse your open PRs, checkout and open in editor',
        builder: (c) =>
          c
            .option('search-root', {
              type: 'array',
              items: 'string',
              description: 'Directories to scan for git repos',
              default: [process.env.HOME ? `${process.env.HOME}/repos` : '.'],
            })
            .option('search-depth', {
              type: 'number',
              description: 'Max directory depth when scanning for repos',
              default: 3,
            })
            .option('editor', {
              type: 'string',
              description:
                'Editor command to open the repo (e.g. code, nvim, zed)',
            })
            .option('github-token', {
              type: 'string',
              description:
                'GitHub token (falls back to GH_TOKEN / GITHUB_TOKEN)',
            })
            .option('repo', {
              type: 'string',
              description:
                'Show all PRs for a specific repo (owner/name) instead of user PRs',
            })
            .option('ui', {
              type: 'boolean',
              description:
                'Open in a native desktop window (via Electrobun) instead of the terminal TUI',
              default: false,
            }),
        handler: async (args) => {
          // Dynamic imports
          const { createCliRenderer } = await import('@opentui/core');
          const { createRoot } = await import('@opentui/react');
          const React = await import('react');
          const { createElement } = React;
          const { execSync } = await import('node:child_process');
          const { resolve } = await import('node:path');

          const {
            resolveGitHubToken,
            fetchUserPRs,
            fetchRepoPRs,
            readCachedPRsSnapshot,
          } =
            await import('./github.js');
          const { scanForRepos } = await import('./scanner.js');
          const { resolveEditor, findInstalledEditors, openInEditor, openInEditorDetached } =
            await import('./editor.js');
          const { Loading } = await import('./loading.js');
          const { copyToClipboard } = await import(
            './notify.js'
          );

          // 1. Resolve token
          const token = resolveGitHubToken(args['github-token']);
          if (!token) {
            console.error(
              'GitHub token required. Set GH_TOKEN, GITHUB_TOKEN, or use --github-token'
            );
            process.exit(1);
          }

          // ── Electrobun UI path ──────────────────────────────
          if (args.ui) {
            const repoMode = args.repo ?? null;
            const cachedPRs = await readCachedPRsSnapshot(token, repoMode ?? undefined);
            console.log('Fetching PRs...');
            const prResult = cachedPRs
              ? cachedPRs.result
              : await (repoMode
                  ? fetchRepoPRs(token, repoMode)
                  : fetchUserPRs(token));
            const { prs } = prResult;
            if (prs.length === 0) {
              console.log('No open PRs found.');
              process.exit(0);
            }

            const ciCacheObj: Record<string, import('./types.js').CIInfo> = {};
            for (const [k, v] of prResult.ciCache) ciCacheObj[k] = v;
            const reviewCacheObj: Record<string, import('./types.js').ReviewInfo> = {};
            for (const [k, v] of prResult.reviewCache) reviewCacheObj[k] = v;
            const mergeableCacheObj: Record<string, import('./types.js').MergeableStatus> = {};
            for (const [k, v] of prResult.mergeableCache) mergeableCacheObj[k] = v;

            const { buildPRDashboardHTML } = await import('./ui-html.js');
            const { openPRDashboardWindow } = await import('./ui-window.js');

            const html = buildPRDashboardHTML({
              prs,
              ciCache: ciCacheObj,
              reviewCache: reviewCacheObj,
              mergeableCache: mergeableCacheObj,
              repoMode,
            });

            const result = await openPRDashboardWindow(html);
            if (!result.selectedPR) process.exit(0);

            // Attempt to checkout the selected PR's branch in a matching local repo
            const localRepos = await scanForRepos(
              args['search-root'],
              args['search-depth']
            );
            const pr = result.selectedPR;
            const matchingRepo = localRepos.find(
              (r) =>
                r.repoId === pr.repoId ||
                (pr.forkRepoId != null && r.repoId === pr.forkRepoId)
            );
            if (matchingRepo) {
              try {
                execSync(`git fetch origin ${pr.headRef}`, {
                  cwd: matchingRepo.path,
                  stdio: 'pipe',
                });
                execSync(`git checkout ${pr.headRef}`, {
                  cwd: matchingRepo.path,
                  stdio: 'inherit',
                });
                console.log(`Checked out ${pr.headRef} in ${matchingRepo.path}`);
              } catch {
                console.error(`Failed to checkout ${pr.headRef}`);
                process.exit(1);
              }
            } else {
              console.log(
                `No local clone found for ${pr.repoId}. PR: ${pr.url}`
              );
            }
            return;
          }

          // ── Terminal TUI path ────────────────────────────────

          // Handle Ctrl+C cleanly — bypass React unmount to avoid yoga WASM crash
          const sigintHandler = () => {
            process.exit(0);
          };
          process.on('SIGINT', sigintHandler);

          // 2. Show loading screen while fetching PRs and scanning repos
          const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true });
          const root = createRoot(renderer);

          let prProgress: import('./github.js').PRFetchProgress = {
            phase: 'authenticating',
            totalPRs: 0,
            fetchedPRs: 0,
            currentRepo: '',
            failedRepos: [],
          };
          let scanProgress: import('./scanner.js').ScanProgress | null = null;
          let scanDone = false;
          let loadingActive = true;

          const renderLoading = () => {
            if (!loadingActive) return;
            root.render(
              createElement(Loading, {
                prProgress: { ...prProgress },
                scanProgress: scanProgress ? { ...scanProgress } : null,
                scanDone,
              }) as React.ReactNode
            );
          };
          renderLoading();

          const repoMode = args.repo ?? null;

          const scanPromise = scanForRepos(
            args['search-root'],
            args['search-depth'],
            (p) => {
              scanProgress = { ...p };
              renderLoading();
            }
          ).then((repos) => {
            scanDone = true;
            renderLoading();
            return repos;
          }).catch(() => {
            scanDone = true;
            renderLoading();
            return [];
          });

          // Check for cached PR data for instant startup, including stale snapshots.
          const cachedPRs = await readCachedPRsSnapshot(token, repoMode ?? undefined);
          let usedCache = false;

          // Use cached PRs immediately when available and revalidate in the background later.
          const prPromise = cachedPRs
            ? Promise.resolve(cachedPRs.result)
            : repoMode
              ? fetchRepoPRs(token, repoMode, (p) => {
                  prProgress = { ...p };
                  renderLoading();
                })
              : fetchUserPRs(token, (p) => {
                  prProgress = { ...p };
                  renderLoading();
                });
          if (cachedPRs) usedCache = true;

          const prResult = await prPromise.catch((error: unknown) => {
            try {
              renderer.destroy();
            } catch {
              // ignore teardown failures while aborting startup
            }
            console.error(
              error instanceof Error ? error.message : String(error)
            );
            process.exit(1);
          });
          const { prs } = prResult;

          // Seed caches from the initial search query
          const ciCache = new Map(prResult.ciCache);
          const reviewCache = new Map(prResult.reviewCache);
          const mergeableCache = new Map(prResult.mergeableCache);

          if (prs.length === 0) {
            renderer.destroy();
            console.log('No open PRs found.');
            process.exit(0);
          }

          // 3. Resolve editor up-front so we can open from within the TUI
          let editor = resolveEditor(args.editor);
          const installedEditors = findInstalledEditors();
          const selectableEditors = installedEditors.filter((e) => !e.disabled);
          if (!editor && selectableEditors.length === 1) {
            editor = {
              command: selectableEditors[0].command,
              dirArg: selectableEditors[0].dirArg,
              source: 'prompt',
            };
          }

          // 4. Launch PR router TUI (single React tree via zustand store)
          const { PrRouter } = await import('./pr-router.js');
          const { createPrStore } = await import('./store.js');
          const { promise, resolve: done } =
            Promise.withResolvers<
              import('./store.js').PrRouterResult | null
            >();

          const initialLocalRepos = scanDone ? await scanPromise : [];

          const store = createPrStore({
            prs,
            localRepos: initialLocalRepos,
            repoScanDone: scanDone,
            ciCache,
            reviewCache,
            mergeableCache,
            repoMode,
            token,
            copyToClipboard,
            editor,
            installedEditors,
            waitForLocalRepos: () => scanPromise,
            onDone: (result) => {
              try {
                renderer.destroy();
              } catch {
                // yoga crash during teardown — ignore
              }
              done(result);
            },
            openEditorForPR: async (pr, repo, skipCheckout) => {
              const currentEditor = store.getState().editor;
              if (!currentEditor) {
                return 'No editor detected. Use --editor to specify one.';
              }
              if (!skipCheckout) {
                try {
                  execSync(`git fetch origin ${pr.headRef}`, {
                    cwd: repo.path,
                    stdio: 'pipe',
                  });
                  execSync(`git checkout ${pr.headRef}`, {
                    cwd: repo.path,
                    stdio: 'pipe',
                  });
                } catch {
                  return 'Failed to checkout branch';
                }
              }
              openInEditorDetached(currentEditor, repo.path);
              return `Opened ${repo.path} in ${currentEditor.command}`;
            },
          });

          if (!scanDone) {
            void scanPromise.then((repos) => {
              store.getState().setLocalRepos(repos, true);
            });
          }

          loadingActive = false;
          root.render(
            createElement(PrRouter, { store }) as React.ReactNode
          );

          // If we used cached data, trigger a background refresh
          if (usedCache) {
            store.getState().refreshAllPRs();
          }

          const result = await promise;
          process.removeListener('SIGINT', sigintHandler);
          if (!result) process.exit(0);

          const { selectedPR, newWorktreePath } = result;

          // 5. Handle worktree creation (the only remaining exit-to-shell path)
          if (!newWorktreePath) return;

          const absPath = resolve(newWorktreePath);
          const sourceMatches = store.getState().localRepos.filter(
            (r) =>
              r.repoId === selectedPR.repoId ||
              (selectedPR.forkRepoId &&
                r.repoId === selectedPR.forkRepoId)
          );
          const sourceRepo = sourceMatches[0];
          if (!sourceRepo) {
            console.error('No local clone available to create worktree from');
            process.exit(1);
          }

          try {
            execSync(
              `git worktree add "${absPath}" -b "${selectedPR.headRef}" "origin/${selectedPR.headRef}"`,
              { cwd: sourceRepo.path, stdio: 'inherit' }
            );
          } catch {
            console.error('Failed to create worktree');
            process.exit(1);
          }

          const finalEditor = store.getState().editor;
          if (finalEditor) {
            console.log(`Opening ${absPath} in ${finalEditor.command}...`);
            openInEditor(finalEditor, absPath);
          } else {
            console.log(`Worktree created at: ${absPath}`);
          }
        },
      }),
  handler: async (args) => {
    const { createCliRenderer } = await import('@opentui/core');
    const { createRoot } = await import('@opentui/react');
    const React = await import('react');
    const { createElement } = React;
    const { App } = await import('./app.js');
    const {
      getBranches,
      getCurrentUser,
      getCurrentUserAliases,
      getRepoRemoteUrl,
      parseGitHubRemote,
    } = await import('./git.js');
    const { resolveGitHubToken, fetchOpenPRs } = await import('./github.js');
    const { execSync } = await import('node:child_process');

    const currentUser = getCurrentUser();
    const currentUserAliases = getCurrentUserAliases();
    const authorList = args.author ?? [];

    // Fetch initial branch data
    let branches: import('./types.js').BranchWithPR[] = getBranches(
      args.remote
    ).map((b) => ({ ...b, pr: undefined }));

    // Enrich with PR data if possible
    if (!args['no-pr']) {
      const token = resolveGitHubToken(args['github-token']);
      if (token) {
        const remoteUrl = getRepoRemoteUrl();
        if (remoteUrl) {
          const remote = parseGitHubRemote(remoteUrl);
          if (remote) {
            const prMap = await fetchOpenPRs(remote.owner, remote.repo, token);
            branches = branches.map((b) => ({
              ...b,
              pr:
                prMap.get(b.name) ?? prMap.get(b.name.replace(/^origin\//, '')),
            }));
          }
        }
      }
    }

    const fetchBranchesWithPRs = (
      includeRemote: boolean
    ): import('./types.js').BranchWithPR[] => {
      return getBranches(includeRemote).map((b) => {
        const existing = branches.find((eb) => eb.name === b.name);
        return { ...b, pr: existing?.pr };
      });
    };

    // ── Electrobun UI path ──────────────────────────────────
    if (args.ui) {
      const { buildBranchPickerHTML } = await import('./ui-html.js');
      const { openBranchPickerWindow } = await import('./ui-window.js');

      const html = buildBranchPickerHTML({
        branches,
        currentUser,
        showRemote: args.remote,
      });

      const result = await openBranchPickerWindow(html, fetchBranchesWithPRs);

      if (result.selectedBranch) {
        console.log(`Switching to branch: ${result.selectedBranch}`);
        try {
          execSync(`git checkout ${result.selectedBranch}`, {
            stdio: 'inherit',
          });
        } catch {
          process.exit(1);
        }
      }
      return;
    }

    // ── Terminal TUI path ───────────────────────────────────

    // Handle Ctrl+C cleanly — bypass React unmount to avoid yoga WASM crash
    process.on('SIGINT', () => process.exit(0));

    // Launch TUI
    const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true });

    let selectedBranch: string | undefined;
    const { promise, resolve } = Promise.withResolvers<void>();

    const element = createElement(App, {
      branches,
      currentUser,
      currentUserAliases,
      authorList,
      initialShowRemote: args.remote,
      fetchBranches: fetchBranchesWithPRs,
      onSelect: (branch: import('./types.js').BranchWithPR) => {
        selectedBranch = branch.isRemote
          ? branch.name.replace(/^origin\//, '')
          : branch.name;
        renderer.destroy();
        resolve();
      },
      onExit: () => {
        renderer.destroy();
        resolve();
      },
    });

    createRoot(renderer).render(element as React.ReactNode);

    // Wait for the user to select a branch or exit
    await promise;

    if (selectedBranch) {
      console.log(`Switching to branch: ${selectedBranch}`);
      try {
        execSync(`git checkout ${selectedBranch}`, { stdio: 'inherit' });
      } catch {
        process.exit(1);
      }
    }
  },
});

export default gitSwitchboard;

if (import.meta.main) {
  gitSwitchboard.forge();
}

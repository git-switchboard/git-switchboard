#!/usr/bin/env node

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
            }),
        handler: async (args) => {
          // Dynamic imports
          const { createCliRenderer } = await import('@opentui/core');
          const { createRoot } = await import('@opentui/react');
          const React = await import('react');
          const { createElement } = React;
          const { execSync } = await import('node:child_process');
          const { resolve } = await import('node:path');

          const { resolveGitHubToken, fetchUserPRs } =
            await import('./github.js');
          const { scanForRepos } = await import('./scanner.js');
          const { resolveEditor, findInstalledEditors, openInEditor } =
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

          // Handle Ctrl+C cleanly — bypass React unmount to avoid yoga WASM crash
          const sigintHandler = () => {
            process.exit(0);
          };
          process.on('SIGINT', sigintHandler);

          // 2. Show loading screen while fetching PRs and scanning repos
          const renderer = await createCliRenderer({ exitOnCtrlC: false });
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

          const renderLoading = () => {
            root.render(
              createElement(Loading, {
                prProgress: { ...prProgress },
                scanProgress: scanProgress ? { ...scanProgress } : null,
                scanDone,
              }) as React.ReactNode
            );
          };
          renderLoading();

          // Run PR fetch and repo scan in parallel
          const prPromise = fetchUserPRs(token, (p) => {
            prProgress = { ...p };
            renderLoading();
          });

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
          });

          const [prResult, localRepos] = await Promise.all([
            prPromise,
            scanPromise,
          ]);
          const { prs } = prResult;

          // Seed caches from the initial search query
          const ciCache = new Map(prResult.ciCache);
          const reviewCache = new Map(prResult.reviewCache);

          if (prs.length === 0) {
            renderer.destroy();
            console.log('No open PRs found.');
            process.exit(0);
          }

          // 3. Launch PR router TUI (single React tree, no swapRoot)
          const { PrRouter } = await import('./pr-router.js');
          const { promise, resolve: done } =
            Promise.withResolvers<
              import('./pr-router.js').PrRouterResult | null
            >();

          root.render(
            createElement(PrRouter, {
              prs,
              localRepos,
              initialCICache: ciCache,
              initialReviewCache: reviewCache,
              token,
              onDone: (result) => {
                renderer.destroy();
                done(result);
              },
              findInstalledEditors,
              resolveEditor,
              editorFlag: args.editor,
              copyToClipboard,
            }) as React.ReactNode
          );

          const result = await promise;
          if (!result) return;

          const { selectedPR, selectedRepo, skipCheckout, newWorktreePath } =
            result;

          // 4. Handle worktree creation if needed
          let targetDir: string;

          if (newWorktreePath) {
            const absPath = resolve(newWorktreePath);
            const sourceMatches = localRepos.filter(
              (r) =>
                r.repoId === selectedPR.repoId ||
                (selectedPR.forkRepoId &&
                  r.repoId === selectedPR.forkRepoId)
            );
            const sourceRepo = sourceMatches[0];
            if (sourceRepo) {
              try {
                execSync(
                  `git worktree add "${absPath}" -b "${selectedPR.headRef}" "origin/${selectedPR.headRef}"`,
                  { cwd: sourceRepo.path, stdio: 'inherit' }
                );
                targetDir = absPath;
              } catch {
                console.error('Failed to create worktree');
                process.exit(1);
              }
            } else {
              console.error('No local clone available to create worktree from');
              process.exit(1);
            }
          } else if (selectedRepo) {
            targetDir = selectedRepo.path;
            if (skipCheckout) {
              console.log(
                `Branch ${selectedPR.headRef} already checked out at ${targetDir}`
              );
            } else {
              try {
                execSync(`git fetch origin ${selectedPR.headRef}`, {
                  cwd: targetDir,
                  stdio: 'inherit',
                });
                execSync(`git checkout ${selectedPR.headRef}`, {
                  cwd: targetDir,
                  stdio: 'inherit',
                });
              } catch {
                console.error('Failed to checkout branch');
                process.exit(1);
              }
            }
          } else {
            console.log('No local clone selected.');
            return;
          }

          // 5. Open in editor
          let editor = resolveEditor(args.editor);
          if (!editor) {
            const installed = findInstalledEditors();
            if (installed.length === 1) {
              editor = {
                command: installed[0].command,
                dirArg: installed[0].dirArg,
                source: 'prompt',
              };
            } else if (installed.length > 0) {
              console.log('Available editors:');
              installed.forEach((e, i) =>
                console.log(`  ${i + 1}. ${e.name} (${e.command})`)
              );
              console.log(`\nRun again with --editor <command> to select.`);
              console.log(`Branch checked out at: ${targetDir!}`);
              return;
            } else {
              console.log(`Branch checked out at: ${targetDir!}`);
              return;
            }
          }

          console.log(`Opening ${targetDir!} in ${editor.command}...`);
          openInEditor(editor, targetDir!);
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

    // Handle Ctrl+C cleanly — bypass React unmount to avoid yoga WASM crash
    process.on('SIGINT', () => process.exit(0));

    // Launch TUI
    const renderer = await createCliRenderer({ exitOnCtrlC: false });

    let selectedBranch: string | undefined;
    const { promise, resolve } = Promise.withResolvers<void>();

    const fetchBranchesWithPRs = (
      includeRemote: boolean
    ): import('./types.js').BranchWithPR[] => {
      return getBranches(includeRemote).map((b) => {
        const existing = branches.find((eb) => eb.name === b.name);
        return { ...b, pr: existing?.pr };
      });
    };

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

gitSwitchboard.forge();

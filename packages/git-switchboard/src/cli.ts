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

          const { resolveGitHubToken, fetchUserPRs, fetchChecks } =
            await import('./github.js');
          const { scanForRepos } = await import('./scanner.js');
          const { resolveEditor, findInstalledEditors, openInEditor } =
            await import('./editor.js');
          const { PrApp } = await import('./pr-app.js');
          const { PrDetail } = await import('./pr-detail.js');
          const { ClonePrompt } = await import('./clone-prompt.js');
          const { EditorPrompt } = await import('./editor-prompt.js');
          const { Loading } = await import('./loading.js');
          const { openUrl, sendNotification, copyToClipboard } = await import(
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

          // 2. Show loading screen while fetching PRs and scanning repos
          const renderer = await createCliRenderer({ exitOnCtrlC: true });
          let root = createRoot(renderer);

          // Helper: unmount old tree and create fresh root to avoid
          // yoga-layout WASM crash when swapping between different component trees
          const swapRoot = (element: React.ReactNode) => {
            root.unmount();
            root = createRoot(renderer);
            root.render(element);
          };

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

          const [prs, localRepos] = await Promise.all([prPromise, scanPromise]);

          if (prs.length === 0) {
            renderer.destroy();
            console.log('No open PRs found.');
            process.exit(0);
          }

          // 3. Transition to PR dashboard TUI
          const { promise, resolve: done } = Promise.withResolvers<void>();

          let selectedPR: import('./types.js').UserPullRequest | undefined;
          let selectedRepo: import('./scanner.js').LocalRepo | undefined;
          let skipCheckout = false;
          let newWorktreePath: string | undefined;

          // Phase tracking
          let currentMatches: import('./scanner.js').LocalRepo[] = [];
          const ciCache = new Map<string, import('./types.js').CIInfo>();
          const reviewCache = new Map<string, import('./types.js').ReviewInfo>();
          const watchedPRs = new Set<string>();
          let watchInterval: ReturnType<typeof setInterval> | undefined;

          const fetchCIForPR = async (
            pr: import('./types.js').UserPullRequest
          ) => {
            const ci = await fetchChecks(
              token,
              pr.repoOwner,
              pr.repoName,
              pr.headRef
            );
            ciCache.set(`${pr.repoId}#${pr.number}`, ci);
          };

          const renderPRList = () => {
            swapRoot(
              createElement(PrApp, {
                prs,
                localRepos,
                ciCache,
                reviewCache,
                onSelect: (
                  pr: import('./types.js').UserPullRequest,
                  matches: import('./scanner.js').LocalRepo[]
                ) => {
                  selectedPR = pr;
                  currentMatches = matches;
                  renderPRDetail();
                },
                onFetchCI: async (
                  pr: import('./types.js').UserPullRequest
                ) => {
                  await fetchCIForPR(pr);
                  renderPRList();
                },
                onExit: () => {
                  renderer.destroy();
                  done();
                },
              }) as React.ReactNode
            );
          };

          let ciLoadingForDetail = false;

          const renderPRDetail = () => {
            const prKey = `${selectedPR!.repoId}#${selectedPR!.number}`;
            const ci = ciCache.get(prKey) ?? null;

            // Auto-fetch CI if not cached
            if (!ci && !ciLoadingForDetail) {
              ciLoadingForDetail = true;
              fetchCIForPR(selectedPR!).then(() => {
                ciLoadingForDetail = false;
                renderPRDetail();
              });
            }

            swapRoot(
              createElement(PrDetail, {
                pr: selectedPR!,
                ci,
                ciLoading: ciLoadingForDetail,
                matches: currentMatches,
                watched: watchedPRs.has(prKey),
                onOpenInEditor: () => {
                  // Clone selection logic (moved from old onSelect)
                  const matches = currentMatches;
                  const onBranch = matches.filter(
                    (r) => r.currentBranch === selectedPR!.headRef
                  );
                  if (onBranch.length === 1) {
                    selectedRepo = onBranch[0];
                    skipCheckout = true;
                    renderer.destroy();
                    done();
                    return;
                  }
                  const cleanMatches = matches.filter((r) => r.isClean);
                  if (cleanMatches.length === 1) {
                    selectedRepo = cleanMatches[0];
                    renderer.destroy();
                    done();
                    return;
                  }
                  if (matches.length > 0) {
                    renderClonePrompt();
                    return;
                  }
                  currentMatches = [];
                  renderClonePrompt();
                },
                onBack: () => renderPRList(),
                onRefreshCI: () => {
                  ciLoadingForDetail = true;
                  renderPRDetail();
                  fetchCIForPR(selectedPR!).then(() => {
                    ciLoadingForDetail = false;
                    renderPRDetail();
                  });
                },
                onWatch: () => {
                  if (watchedPRs.has(prKey)) {
                    watchedPRs.delete(prKey);
                  } else {
                    watchedPRs.add(prKey);
                  }
                  renderPRDetail();
                },
                onOpenUrl: (url: string) => openUrl(url),
                onCopyLogs: async (
                  check: import('./types.js').CheckRun
                ): Promise<string> => {
                  const { fetchCheckLogs } = await import('./github.js');
                  const logs = await fetchCheckLogs(
                    token,
                    selectedPR!.repoOwner,
                    selectedPR!.repoName,
                    check.id
                  );
                  if (!logs) return 'No logs available (may not be a GitHub Action)';
                  const ok = await copyToClipboard(logs);
                  return ok
                    ? `Copied ${logs.length} chars of logs to clipboard`
                    : 'Failed to copy to clipboard';
                },
                onExit: () => {
                  renderer.destroy();
                  done();
                },
              }) as React.ReactNode
            );
          };

          const renderClonePrompt = () => {
            swapRoot(
              createElement(ClonePrompt, {
                repoId: selectedPR!.repoId,
                branchName: selectedPR!.headRef,
                matches: currentMatches,
                onSelect: (
                  repo: import('./scanner.js').LocalRepo,
                  alreadyCheckedOut: boolean
                ) => {
                  selectedRepo = repo;
                  skipCheckout = alreadyCheckedOut;
                  renderer.destroy();
                  done();
                },
                onCreateWorktree: (path: string) => {
                  newWorktreePath = path;
                  renderer.destroy();
                  done();
                },
                onCancel: () => {
                  // Go back to PR list
                  selectedPR = undefined;
                  renderPRList();
                },
              }) as React.ReactNode
            );
          };

          renderPRList();

          watchInterval = setInterval(async () => {
            if (watchedPRs.size === 0) return;
            for (const key of watchedPRs) {
              const match = key.match(/^(.+)#(\d+)$/);
              if (!match) continue;
              const pr = prs.find(
                (p) => p.repoId === match[1] && p.number === Number(match[2])
              );
              if (!pr) continue;
              const oldCI = ciCache.get(key);
              const newCI = await fetchChecks(
                token,
                pr.repoOwner,
                pr.repoName,
                pr.headRef
              );
              ciCache.set(key, newCI);
              if (
                oldCI &&
                oldCI.status === 'pending' &&
                newCI.status !== 'pending' &&
                newCI.status !== 'unknown'
              ) {
                const icon = newCI.status === 'passing' ? '*' : 'x';
                sendNotification(
                  `git-switchboard: CI ${newCI.status}`,
                  `${icon} ${pr.repoOwner}/${pr.repoName}#${pr.number}: ${pr.title}`
                );
              }
            }
          }, 30_000);

          await promise;

          if (watchInterval) clearInterval(watchInterval);

          if (!selectedPR) return;

          // 4. Handle worktree creation if needed
          let targetDir: string;

          if (newWorktreePath) {
            const absPath = resolve(newWorktreePath);
            // Need a source repo to create the worktree from
            const sourceRepo = currentMatches[0];
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
              // Checkout the PR branch
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
              // Launch editor selection TUI
              const editorRenderer = await createCliRenderer({
                exitOnCtrlC: true,
              });
              const { promise: editorPromise, resolve: editorDone } =
                Promise.withResolvers<void>();

              let chosenEditor:
                | import('./editor.js').ResolvedEditor
                | undefined;

              createRoot(editorRenderer).render(
                createElement(EditorPrompt, {
                  editors: installed,
                  onSelect: (editorInfo: import('./editor.js').EditorInfo) => {
                    chosenEditor = {
                      command: editorInfo.command,
                      dirArg: editorInfo.dirArg,
                      source: 'prompt',
                    };
                    editorRenderer.destroy();
                    editorDone();
                  },
                  onCancel: () => {
                    editorRenderer.destroy();
                    editorDone();
                  },
                }) as React.ReactNode
              );

              await editorPromise;

              if (chosenEditor) {
                editor = chosenEditor;
              } else {
                console.log(`Branch checked out at: ${targetDir!}`);
                return;
              }
            } else {
              console.log(`Branch checked out at: ${targetDir!}`);
              return;
            }
          }

          if (editor) {
            console.log(`Opening ${targetDir!} in ${editor.command}...`);
          }
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

    // Launch TUI
    const renderer = await createCliRenderer({ exitOnCtrlC: true });

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

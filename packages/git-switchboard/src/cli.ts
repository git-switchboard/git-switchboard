#!/usr/bin/env node

import { cli } from "cli-forge";

const gitSwitchboard = cli("git-switchboard", {
  description: "Interactive TUI for browsing and checking out git branches",
  builder: (args) =>
    args
      .option("remote", {
        type: "boolean",
        alias: ["r"],
        description: "Include remote branches",
        default: false,
      })
      .option("author", {
        type: "array",
        items: "string",
        alias: ["a"],
        description: "Filter by author name(s)",
      })
      .option("github-token", {
        type: "string",
        description:
          "GitHub token for PR enrichment (falls back to GH_TOKEN / GITHUB_TOKEN)",
      })
      .option("no-pr", {
        type: "boolean",
        description: "Skip PR enrichment even if a token is available",
        default: false,
      }),
  handler: async (args) => {
    const { createCliRenderer } = await import("@opentui/core");
    const { createRoot } = await import("@opentui/react");
    const React = await import("react");
    const { createElement } = React;
    const { App } = await import("./app.js");
    const {
      getBranches,
      getCurrentUser,
      getRepoRemoteUrl,
      parseGitHubRemote,
    } = await import("./git.js");
    const { resolveGitHubToken, fetchOpenPRs } = await import("./github.js");
    const { execSync } = await import("node:child_process");

    const currentUser = getCurrentUser();
    const authorList = args.author ?? [];

    // Fetch initial branch data
    let branches: import("./types.js").BranchWithPR[] = getBranches(args.remote).map(
      (b) => ({ ...b, pr: undefined })
    );

    // Enrich with PR data if possible
    if (!args["no-pr"]) {
      const token = resolveGitHubToken(args["github-token"]);
      if (token) {
        const remoteUrl = getRepoRemoteUrl();
        if (remoteUrl) {
          const remote = parseGitHubRemote(remoteUrl);
          if (remote) {
            const prMap = await fetchOpenPRs(remote.owner, remote.repo, token);
            branches = branches.map((b) => ({
              ...b,
              pr: prMap.get(b.name) ?? prMap.get(b.name.replace(/^origin\//, "")),
            }));
          }
        }
      }
    }

    // Launch TUI
    const renderer = await createCliRenderer({ exitOnCtrlC: true });

    let selectedBranch: string | undefined;
    const { promise, resolve } = Promise.withResolvers<void>();

    const fetchBranchesWithPRs = (includeRemote: boolean): import("./types.js").BranchWithPR[] => {
      return getBranches(includeRemote).map((b) => {
        const existing = branches.find((eb) => eb.name === b.name);
        return { ...b, pr: existing?.pr };
      });
    };

    const element = createElement(App, {
      branches,
      currentUser,
      authorList,
      initialShowRemote: args.remote,
      fetchBranches: fetchBranchesWithPRs,
      onSelect: (branch: import("./types.js").BranchWithPR) => {
        selectedBranch = branch.isRemote
          ? branch.name.replace(/^origin\//, "")
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
        execSync(`git checkout ${selectedBranch}`, { stdio: "inherit" });
      } catch {
        process.exit(1);
      }
    }
  },
});

export default gitSwitchboard;

gitSwitchboard.forge();

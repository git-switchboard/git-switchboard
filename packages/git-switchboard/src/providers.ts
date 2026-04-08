import { ghCliToken } from './github.js';
import type { ProviderDef } from './token-store.js';

async function validateGitHubToken(token: string): Promise<string> {
  const response = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}`);
  }
  const data = (await response.json()) as { login: string };
  return data.login;
}

async function validateLinearToken(token: string): Promise<string> {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify({ query: '{ viewer { name email } }' }),
  });
  if (!response.ok) {
    throw new Error(`Linear API returned ${response.status}`);
  }
  const result = (await response.json()) as {
    data?: { viewer?: { name: string; email: string } };
    errors?: { message: string }[];
  };
  if (result.errors?.length) {
    throw new Error(result.errors[0].message);
  }
  const viewer = result.data?.viewer;
  if (!viewer) {
    throw new Error('Invalid Linear token');
  }
  return viewer.name || viewer.email;
}

export const GITHUB_PROVIDER: ProviderDef = {
  name: 'github',
  envVars: ['GH_TOKEN', 'GITHUB_TOKEN'],
  cliFlag: 'github-token',
  fallback: ghCliToken,
  validate: validateGitHubToken,
  settingsUrl: 'https://github.com/settings/tokens',
};

export const LINEAR_PROVIDER: ProviderDef = {
  name: 'linear',
  envVars: ['LINEAR_TOKEN'],
  validate: validateLinearToken,
  settingsUrl: 'https://linear.app/settings/account/security/api-keys/new',
};

export const ALL_PROVIDERS: ProviderDef[] = [GITHUB_PROVIDER, LINEAR_PROVIDER];

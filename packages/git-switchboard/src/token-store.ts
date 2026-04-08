import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { getTokenConfig, removeTokenConfig, setTokenConfig, CREDENTIALS_DIR } from './config.js';
import type { TokenConfig, TokenStrategy } from './config.js';
import {
  decrypt,
  encrypt,
  machineKey,
  passwordKey,
  readEncryptedFile,
  writeEncryptedFile,
} from './crypto.js';

export interface ProviderDef {
  name: string;
  /** Environment variable names to check (used only as fallback, not via config). */
  envVars: string[];
  /** CLI flag name (e.g., 'github-token'). */
  cliFlag?: string;
  /** Provider-specific fallback (e.g., gh auth token). Returns token or undefined. */
  fallback?: () => string | undefined;
  /** Validate a token. Returns a display name on success, throws on failure. */
  validate: (token: string) => Promise<string>;
  /** URL to the provider's token management page. */
  settingsUrl: string;
}

/** Strategies in the order they appear in the docs. */
export const STRATEGY_ORDER: TokenStrategy[] = ['env', 'encrypted', 'password', 'command'];

export interface ResolveOptions {
  /** Value from CLI flag (highest priority). */
  flagValue?: string;
  /** Callback to prompt user for password (for 'password' strategy). */
  promptPassword?: () => Promise<string>;
}

/**
 * Resolve a token for a provider by trying each source in priority order:
 * 1. CLI flag value
 * 2. Config strategies in key order
 * 3. Provider-specific fallback
 */
export async function resolveToken(
  provider: ProviderDef,
  options: ResolveOptions = {}
): Promise<string | undefined> {
  // 1. CLI flag
  if (options.flagValue) return options.flagValue;

  // 2. Config strategies in key order
  const tokenConfig = await getTokenConfig(provider.name);
  const strategies = Object.keys(tokenConfig) as TokenStrategy[];

  for (const strategy of strategies) {
    const value = tokenConfig[strategy];
    if (!value) continue;
    try {
      const token = await executeStrategy(strategy, value, options);
      if (token) return token;
    } catch {
      // Strategy failed — try next
    }
  }

  // 3. Provider-specific fallback
  if (provider.fallback) {
    const token = provider.fallback();
    if (token) return token;
  }

  return undefined;
}

async function executeStrategy(
  strategy: TokenStrategy,
  value: string,
  options: ResolveOptions
): Promise<string | undefined> {
  switch (strategy) {
    case 'env':
      return process.env[value] || undefined;

    case 'encrypted': {
      const payload = await readEncryptedFile(value);
      return decrypt(payload, machineKey());
    }

    case 'password': {
      if (!options.promptPassword) return undefined;
      const pw = await options.promptPassword();
      const payload = await readEncryptedFile(value);
      return decrypt(payload, passwordKey(pw));
    }

    case 'command': {
      const result = execSync(value, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return result || undefined;
    }
  }
}

/** Default credential file path for a provider. */
export function credentialPath(providerName: string): string {
  return join(CREDENTIALS_DIR, `${providerName}.enc`);
}

/** Store a token using the given strategy. */
export async function storeToken(
  providerName: string,
  strategy: TokenStrategy,
  token: string,
  strategyValue: string,
  password?: string
): Promise<void> {
  if (strategy === 'encrypted') {
    await writeEncryptedFile(strategyValue, encrypt(token, machineKey()));
  } else if (strategy === 'password') {
    if (!password) throw new Error('Password required for password strategy');
    await writeEncryptedFile(strategyValue, encrypt(token, passwordKey(password)));
  }

  // For env and command, we just store the config pointer (no file to write)
  const config: TokenConfig = {};
  config[strategy] = strategyValue;
  await setTokenConfig(providerName, config);
}

/** Remove a provider's token from config and delete the credential file if present. */
export async function removeToken(providerName: string): Promise<void> {
  const tokenConfig = await getTokenConfig(providerName);
  // Delete any credential files
  for (const strategy of ['encrypted', 'password'] as const) {
    const filePath = tokenConfig[strategy];
    if (filePath) {
      try {
        await unlink(filePath);
      } catch {
        // File may not exist
      }
    }
  }
  await removeTokenConfig(providerName);
}

/** Check if a provider has any configured strategies. */
export async function isConfigured(providerName: string): Promise<boolean> {
  const config = await getTokenConfig(providerName);
  return Object.keys(config).length > 0;
}

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

function resolveConfigBase(): string {
  // XDG on Linux/macOS, APPDATA on Windows, fallback to ~/.config
  if (process.env.XDG_CONFIG_HOME) return process.env.XDG_CONFIG_HOME;
  if (process.platform === 'win32' && process.env.APPDATA) return process.env.APPDATA;
  return join(homedir(), '.config');
}

const CONFIG_DIR = join(resolveConfigBase(), 'git-switchboard');

const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const CREDENTIALS_DIR = join(CONFIG_DIR, 'credentials');

export { CONFIG_DIR, CONFIG_FILE, CREDENTIALS_DIR };

export type TokenStrategy = 'env' | 'encrypted' | 'password' | 'command';

/** Token config: strategy key → value (env var name, file path, or command). Key order = priority. */
export type TokenConfig = Partial<Record<TokenStrategy, string>>;

export interface Config {
  tokens?: Record<string, TokenConfig>;
}

async function ensureDirs(): Promise<void> {
  await mkdir(CREDENTIALS_DIR, { recursive: true });
}

export async function readConfig(): Promise<Config> {
  try {
    const raw = await readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as Config;
  } catch {
    return {};
  }
}

export async function writeConfig(config: Config): Promise<void> {
  await ensureDirs();
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

export async function getTokenConfig(provider: string): Promise<TokenConfig> {
  const config = await readConfig();
  return config.tokens?.[provider] ?? {};
}

export async function setTokenConfig(
  provider: string,
  tokenConfig: TokenConfig
): Promise<void> {
  const config = await readConfig();
  config.tokens ??= {};
  config.tokens[provider] = tokenConfig;
  await writeConfig(config);
}

export async function removeTokenConfig(provider: string): Promise<void> {
  const config = await readConfig();
  if (config.tokens) {
    delete config.tokens[provider];
  }
  await writeConfig(config);
}

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
  /** Per-view column order and visibility. Key is the view name (e.g. 'pr-list'). */
  columns?: Record<string, { id: string; visibility: 'auto' | 'visible' | 'hidden' }[]>;
  /** Saved filter presets. Key is the view name (e.g. 'pr-list'). */
  filterPresets?: Record<string, FilterPreset[]>;
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

// ─── Column config helpers ──────────────────────────────────────────────────

import type { ColumnConfig, ColumnDef, FilterPreset } from './types.js';
import { defaultColumns } from './types.js';

/**
 * Read column config for a view, merging saved config with defaults.
 * Handles new columns being added or old ones removed across versions.
 */
export async function readColumnConfig<TId extends string>(
  viewName: string,
  defs: ColumnDef<TId>[],
): Promise<ColumnConfig<TId>[]> {
  const config = await readConfig();
  const saved = config.columns?.[viewName];
  if (!saved) return defaultColumns(defs);

  const validIds = new Set<string>(defs.map((d) => d.id));
  // Keep saved entries that still exist, in saved order
  const result: ColumnConfig<TId>[] = [];
  const seen = new Set<string>();
  for (const entry of saved) {
    if (validIds.has(entry.id) && !seen.has(entry.id)) {
      result.push(entry as ColumnConfig<TId>);
      seen.add(entry.id);
    }
  }
  // Append any new columns not in saved config
  for (const def of defs) {
    if (!seen.has(def.id)) {
      result.push({
        id: def.id,
        visibility: def.supportsAuto ? 'auto' : 'visible',
      });
    }
  }
  return result;
}

export async function writeColumnConfig<TId extends string>(
  viewName: string,
  columns: ColumnConfig<TId>[],
): Promise<void> {
  const config = await readConfig();
  config.columns ??= {};
  config.columns[viewName] = columns;
  await writeConfig(config);
}

// ─── Filter preset helpers ─────────────────────────────────────────────────

export async function readFilterPresets(viewName: string): Promise<FilterPreset[]> {
  const config = await readConfig();
  return config.filterPresets?.[viewName] ?? [];
}

export async function writeFilterPresets(
  viewName: string,
  presets: FilterPreset[],
): Promise<void> {
  const config = await readConfig();
  config.filterPresets ??= {};
  config.filterPresets[viewName] = presets;
  await writeConfig(config);
}

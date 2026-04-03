import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const CACHE_DIR = join(
  process.env.XDG_CACHE_HOME ?? join(process.env.HOME ?? '~', '.cache'),
  'git-switchboard'
);

let dirReady = false;

interface CacheEntry<T> {
  ts: number;
  data: T;
}

async function ensureDir(): Promise<void> {
  if (dirReady) return;
  await mkdir(CACHE_DIR, { recursive: true });
  dirReady = true;
}

/** Hash a string into a short, filesystem-safe key. */
export function hashKey(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * Read a cached JSON value. Returns null if missing, expired, or corrupt.
 * Pass `maxAgeMs` to enforce a TTL; omit for no expiry.
 */
export async function readCacheEntry<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const filePath = join(CACHE_DIR, `${key}.json`);
    const raw = await readFile(filePath, 'utf-8');
    const entry: CacheEntry<T> = JSON.parse(raw);
    return entry;
  } catch {
    return null;
  }
}

/**
 * Read a cached JSON value. Returns null if missing, expired, or corrupt.
 * Pass `maxAgeMs` to enforce a TTL; omit for no expiry.
 */
export async function readCache<T>(
  key: string,
  maxAgeMs?: number
): Promise<T | null> {
  const entry = await readCacheEntry<T>(key);
  if (!entry) {
    return null;
  }
  try {
    if (maxAgeMs !== undefined && Date.now() - entry.ts > maxAgeMs) {
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

/** Write a JSON value to the cache. */
export async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    await ensureDir();
    const filePath = join(CACHE_DIR, `${key}.json`);
    const entry = { ts: Date.now(), data };
    await writeFile(filePath, JSON.stringify(entry));
  } catch {
    // Cache writes are best-effort — never block the user
  }
}

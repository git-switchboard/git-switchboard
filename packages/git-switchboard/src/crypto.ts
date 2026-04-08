import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { hostname, userInfo } from 'node:os';
import { readFile, writeFile, chmod } from 'node:fs/promises';

const SALT = 'git-switchboard-v1';
const ALGORITHM = 'aes-256-gcm';

/** Derive a 32-byte key from arbitrary input. */
function deriveKey(input: string): Buffer {
  return createHash('sha256').update(input).digest();
}

/** Machine-specific key: hash of hostname + username + salt. */
export function machineKey(): Buffer {
  return deriveKey(`${hostname()}:${userInfo().username}:${SALT}`);
}

/** Password-derived key. */
export function passwordKey(password: string): Buffer {
  return deriveKey(`${password}:${SALT}`);
}

/** SHA-256 hash of a token, used for password-strategy validation. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

interface EncryptedPayload {
  /** base64-encoded IV */
  iv: string;
  /** base64-encoded ciphertext */
  data: string;
  /** base64-encoded auth tag */
  tag: string;
  /** SHA-256 hex hash of the plaintext token — used to verify correct decryption */
  hash: string;
}

export function encrypt(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    data: encrypted.toString('base64'),
    tag: tag.toString('base64'),
    hash: tokenHash(plaintext),
  };
}

export function decrypt(payload: EncryptedPayload, key: Buffer): string {
  const iv = Buffer.from(payload.iv, 'base64');
  const data = Buffer.from(payload.data, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  const plaintext = decrypted.toString('utf-8');
  if (tokenHash(plaintext) !== payload.hash) {
    throw new Error('Token hash mismatch — wrong decryption key');
  }
  return plaintext;
}

/** Write encrypted payload to file with 0600 permissions. */
export async function writeEncryptedFile(
  filePath: string,
  payload: EncryptedPayload
): Promise<void> {
  await writeFile(filePath, JSON.stringify(payload));
  await chmod(filePath, 0o600);
}

/** Read encrypted payload from file. */
export async function readEncryptedFile(filePath: string): Promise<EncryptedPayload> {
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw) as EncryptedPayload;
}

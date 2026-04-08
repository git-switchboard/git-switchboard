# TokenStore & `connect` Command — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a generalized token management system with encrypted storage and an interactive `connect` TUI for managing provider tokens (GitHub, Linear).

**Architecture:** A `TokenStore` module handles config read/write and token resolution (env, encrypted, password, command strategies). A `connect` subcommand provides an @opentui-based multi-view TUI for setup/disconnect. Provider definitions are declarative — adding a new provider is just a config object.

**Tech Stack:** TypeScript, Node.js crypto (AES-256-GCM, SHA-256), @opentui/react, cli-forge, Bun runtime

---

### Task 1: Config Module (`config.ts`)

Handles reading/writing `~/.config/git-switchboard/config.json` and the `credentials/` directory.

**Files:**
- Create: `packages/git-switchboard/src/config.ts`

**Step 1: Create the config module**

```typescript
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const CONFIG_DIR = join(
  process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? '~', '.config'),
  'git-switchboard'
);

const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const CREDENTIALS_DIR = join(CONFIG_DIR, 'credentials');

export { CONFIG_DIR, CONFIG_FILE, CREDENTIALS_DIR };

export type TokenStrategy = 'env' | 'encrypted' | 'password' | 'command';

/** Token config: strategy key → value (env var name, file path, or command). Key order = priority. */
export type TokenConfig = Partial<Record<TokenStrategy, string>>;

export interface Config {
  tokens?: Record<string, TokenConfig>;
}

let dirReady = false;

async function ensureDirs(): Promise<void> {
  if (dirReady) return;
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  dirReady = true;
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
```

**Step 2: Verify it typechecks**

Run: `cd packages/git-switchboard && npx tsc --noEmit`
Expected: No errors related to config.ts

**Step 3: Commit**

```bash
git add packages/git-switchboard/src/config.ts
git commit -m "feat: add config module for ~/.config/git-switchboard"
```

---

### Task 2: Crypto Module (`crypto.ts`)

Handles AES-256-GCM encryption/decryption with machine key and password key derivation.

**Files:**
- Create: `packages/git-switchboard/src/crypto.ts`

**Step 1: Create the crypto module**

```typescript
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
```

**Step 2: Verify it typechecks**

Run: `cd packages/git-switchboard && npx tsc --noEmit`
Expected: No errors related to crypto.ts

**Step 3: Commit**

```bash
git add packages/git-switchboard/src/crypto.ts
git commit -m "feat: add crypto module for AES-256-GCM token encryption"
```

---

### Task 3: Token Store (`token-store.ts`)

The core resolution engine. Given a provider name, tries each strategy in config key order.

**Files:**
- Create: `packages/git-switchboard/src/token-store.ts`

**Step 1: Create the token store module**

```typescript
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
const STRATEGY_ORDER: TokenStrategy[] = ['env', 'encrypted', 'password', 'command'];

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
  if (strategy === 'env' || strategy === 'command') {
    config[strategy] = strategyValue;
  } else {
    config[strategy] = strategyValue;
  }
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
```

**Step 2: Verify it typechecks**

Run: `cd packages/git-switchboard && npx tsc --noEmit`
Expected: No errors related to token-store.ts

**Step 3: Commit**

```bash
git add packages/git-switchboard/src/token-store.ts
git commit -m "feat: add TokenStore with multi-strategy token resolution"
```

---

### Task 4: Provider Definitions (`providers.ts`)

Declares GitHub and Linear providers with their validation functions and settings URLs.

**Files:**
- Create: `packages/git-switchboard/src/providers.ts`
- Modify: `packages/git-switchboard/src/github.ts` (extract `ghCliToken` as reusable export)

**Step 1: Export ghCliToken from github.ts**

In `packages/git-switchboard/src/github.ts`, the `ghCliToken` function at line 18 is private. We need to export it so providers.ts can reference it as the GitHub fallback.

Change line 18 from:
```typescript
function ghCliToken(): string | undefined {
```
to:
```typescript
export function ghCliToken(): string | undefined {
```

**Step 2: Create providers.ts**

```typescript
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
```

**Step 3: Verify it typechecks**

Run: `cd packages/git-switchboard && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/git-switchboard/src/providers.ts packages/git-switchboard/src/github.ts
git commit -m "feat: add GitHub and Linear provider definitions"
```

---

### Task 5: Migrate `resolveGitHubToken` to use TokenStore

Update the existing `resolveGitHubToken` in `github.ts` to use the TokenStore as an additional resolution source, keeping backward compatibility.

**Files:**
- Modify: `packages/git-switchboard/src/github.ts:62-69`

**Step 1: Update resolveGitHubToken**

Replace the current `resolveGitHubToken` function (lines 62-69) with:

```typescript
export function resolveGitHubToken(flagValue?: string): string | undefined {
  // Legacy resolution chain — TokenStore is async and called separately
  // by the CLI layer. This sync function remains for backward compat.
  return (
    flagValue ||
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    ghCliToken()
  );
}
```

No functional change yet — the CLI layer (Task 8) will add the async TokenStore resolution *before* falling back to this sync chain. The key insight is that `resolveGitHubToken` stays sync for existing callers, and the CLI handler calls `resolveToken()` from token-store first.

**Step 2: Verify it typechecks**

Run: `cd packages/git-switchboard && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/git-switchboard/src/github.ts
git commit -m "refactor: export ghCliToken for provider fallback"
```

---

### Task 6: Connect TUI — Provider List View (`connect-list.tsx`)

The `connect` subcommand's initial screen: shows providers with their status and allows selecting one.

**Files:**
- Create: `packages/git-switchboard/src/connect-list.tsx`

**Step 1: Create the provider list component**

```typescript
import { useState, useEffect } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import type { Keybind } from './view.js';
import { footerParts } from './view.js';
import { useKeybinds } from './use-keybinds.js';
import { buildFooterRows, FooterRows } from './footer.js';
import { useNavigate } from './tui-router.js';
import { isConfigured } from './token-store.js';
import { ALL_PROVIDERS } from './providers.js';
import { CHECKMARK, CROSSMARK, UP_ARROW, DOWN_ARROW } from './unicode.js';
import type { ConnectScreen } from './connect-router.js';

export function ConnectList({ keybinds }: { keybinds: Record<string, Keybind> }) {
  const { width } = useTerminalDimensions();
  const navigate = useNavigate<ConnectScreen>();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statuses, setStatuses] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    void (async () => {
      const entries = await Promise.all(
        ALL_PROVIDERS.map(async (p) => [p.name, await isConfigured(p.name)] as const)
      );
      setStatuses(new Map(entries));
    })();
  }, []);

  useKeybinds(keybinds, {
    navigate: (key) => {
      const dir = key.name === 'up' || key.name === 'k' ? -1 : 1;
      setSelectedIndex((i) => Math.max(0, Math.min(ALL_PROVIDERS.length - 1, i + dir)));
    },
    select: () => {
      const provider = ALL_PROVIDERS[selectedIndex];
      navigate({ type: 'provider-detail', providerName: provider.name });
    },
    quit: () => {
      process.exit(0);
    },
  });

  const parts = footerParts(keybinds);
  const rows = buildFooterRows(parts, width);

  return (
    <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
      <box style={{ height: 1, width: '100%' }}>
        <text content=" Manage Connections" fg="#7aa2f7" bold />
      </box>
      <box style={{ height: 1, width: '100%' }}>
        <text content={'─'.repeat(width)} fg="#292e42" />
      </box>
      <box flexDirection="column" style={{ flexGrow: 1 }}>
        {ALL_PROVIDERS.map((provider, index) => {
          const isActive = index === selectedIndex;
          const configured = statuses.get(provider.name);
          const statusIcon = configured ? CHECKMARK : CROSSMARK;
          const statusColor = configured ? '#9ece6a' : '#565f89';
          const statusText = configured ? 'connected' : 'not configured';
          const label = `${isActive ? '>' : ' '} ${provider.name}`;

          return (
            <box
              key={provider.name}
              style={{
                height: 1,
                width: '100%',
                backgroundColor: isActive ? '#292e42' : undefined,
              }}
              onMouseDown={() => {
                if (isActive) {
                  navigate({ type: 'provider-detail', providerName: provider.name });
                } else {
                  setSelectedIndex(index);
                }
              }}
            >
              <text
                content={` ${label}`}
                fg={isActive ? '#c0caf5' : '#a9b1d6'}
              />
              <text content={`   ${statusIcon} ${statusText}`} fg={statusColor} />
            </box>
          );
        })}
      </box>
      <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
        <text content={'─'.repeat(width)} fg="#292e42" />
      </box>
      <FooterRows rows={rows} fg="#565f89" />
    </box>
  );
}
```

**Step 2: Verify it typechecks**

Run: `cd packages/git-switchboard && npx tsc --noEmit`
Expected: No errors (may have circular import warning — resolved in Task 9 when connect-router is created)

**Step 3: Commit**

```bash
git add packages/git-switchboard/src/connect-list.tsx
git commit -m "feat: add provider list view for connect command"
```

---

### Task 7: Connect TUI — Provider Detail View (`connect-detail.tsx`)

Shows a single provider's status with options to set up or disconnect.

**Files:**
- Create: `packages/git-switchboard/src/connect-detail.tsx`

**Step 1: Create the provider detail component**

```typescript
import { useState, useEffect } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import type { Keybind } from './view.js';
import { footerParts } from './view.js';
import { useKeybinds } from './use-keybinds.js';
import { buildFooterRows, FooterRows } from './footer.js';
import { useNavigate, useHistory } from './tui-router.js';
import { isConfigured, removeToken } from './token-store.js';
import { getTokenConfig } from './config.js';
import { ALL_PROVIDERS } from './providers.js';
import { CHECKMARK, CROSSMARK } from './unicode.js';
import type { ConnectScreen } from './connect-router.js';
import type { TokenStrategy } from './config.js';

export function ConnectDetail({
  providerName,
  keybinds,
}: {
  providerName: string;
  keybinds: Record<string, Keybind>;
}) {
  const { width } = useTerminalDimensions();
  const navigate = useNavigate<ConnectScreen>();
  const { goBack } = useHistory();
  const [configured, setConfigured] = useState(false);
  const [strategy, setStrategy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const provider = ALL_PROVIDERS.find((p) => p.name === providerName);

  useEffect(() => {
    void (async () => {
      const cfg = await getTokenConfig(providerName);
      const strategies = Object.keys(cfg) as TokenStrategy[];
      setConfigured(strategies.length > 0);
      setStrategy(strategies[0] ?? null);
    })();
  }, [providerName]);

  useKeybinds(
    keybinds,
    {
      setup: () => {
        navigate({ type: 'setup', providerName });
      },
      disconnect: () => {
        if (!configured) return;
        setConfirming(true);
      },
      confirmDisconnect: () => {
        void (async () => {
          await removeToken(providerName);
          setConfigured(false);
          setStrategy(null);
          setConfirming(false);
        })();
      },
      cancelDisconnect: () => {
        setConfirming(false);
      },
      back: () => {
        goBack();
      },
      quit: () => {
        process.exit(0);
      },
    },
    {
      show: {
        disconnect: configured && !confirming,
        confirmDisconnect: confirming,
        cancelDisconnect: confirming,
      },
    }
  );

  const parts = footerParts(keybinds, {
    disconnect: configured && !confirming,
    confirmDisconnect: confirming,
    cancelDisconnect: confirming,
  });
  const rows = buildFooterRows(parts, width);

  const displayName = provider?.name ?? providerName;
  const statusIcon = configured ? CHECKMARK : CROSSMARK;
  const statusColor = configured ? '#9ece6a' : '#f7768e';
  const statusText = configured
    ? `connected (${strategy})`
    : 'not configured';

  return (
    <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
      <box style={{ height: 1, width: '100%' }}>
        <text content={` ${displayName}`} fg="#7aa2f7" bold />
      </box>
      <box style={{ height: 1, width: '100%' }}>
        <text content={'─'.repeat(width)} fg="#292e42" />
      </box>
      <box flexDirection="column" style={{ flexGrow: 1, paddingLeft: 2 }}>
        <box style={{ height: 1 }}>
          <text content="  Status: " fg="#a9b1d6" />
          <text content={`${statusIcon} ${statusText}`} fg={statusColor} />
        </box>
        <box style={{ height: 1 }}>
          <text content={`  Settings: ${provider?.settingsUrl ?? ''}`} fg="#565f89" />
        </box>
        {confirming && (
          <box style={{ height: 2, marginTop: 1 }}>
            <text content={`  Remove ${displayName} token?`} fg="#f7768e" />
          </box>
        )}
      </box>
      <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
        <text content={'─'.repeat(width)} fg="#292e42" />
      </box>
      <FooterRows rows={rows} fg="#565f89" />
    </box>
  );
}
```

**Step 2: Verify it typechecks**

Run: `cd packages/git-switchboard && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/git-switchboard/src/connect-detail.tsx
git commit -m "feat: add provider detail view with disconnect support"
```

---

### Task 8: Connect TUI — Setup Flow View (`connect-setup.tsx`)

Multi-step setup: strategy selection → token/var/command input → optional password → validation → save.

**Files:**
- Create: `packages/git-switchboard/src/connect-setup.tsx`

**Step 1: Create the setup flow component**

This is the most complex view — it has multiple internal steps managed via `useState`.

```typescript
import { useState, useCallback } from 'react';
import { useTerminalDimensions, useKeyboard } from '@opentui/react';
import type { Keybind } from './view.js';
import { footerParts } from './view.js';
import { useKeybinds } from './use-keybinds.js';
import { buildFooterRows, FooterRows } from './footer.js';
import { useHistory } from './tui-router.js';
import { storeToken, credentialPath } from './token-store.js';
import { ALL_PROVIDERS } from './providers.js';
import { UP_ARROW, DOWN_ARROW, RETURN_SYMBOL, CHECKMARK } from './unicode.js';
import type { TokenStrategy } from './config.js';

type Step = 'strategy' | 'input' | 'password' | 'confirm-password' | 'validating' | 'done';

interface StrategyOption {
  key: TokenStrategy;
  label: string;
  description: string;
}

const STRATEGY_OPTIONS: StrategyOption[] = [
  { key: 'env', label: 'Environment variable', description: 'Read token from an env var at launch' },
  { key: 'encrypted', label: 'Encrypted (machine-locked)', description: 'No password needed — tied to this machine' },
  { key: 'password', label: 'Encrypted (password-protected)', description: 'Enter a password each launch' },
  { key: 'command', label: 'Shell command', description: 'Run a command to fetch the token' },
];

// Fixed-length masked indicator: shows activity without revealing length.
// Displays a fixed number of dots plus a blinking cursor-like indicator.
const MASK_INDICATOR = '●●●●●●●●';

export function ConnectSetup({
  providerName,
  keybinds,
}: {
  providerName: string;
  keybinds: Record<string, Keybind>;
}) {
  const { width } = useTerminalDimensions();
  const { goBack } = useHistory();
  const provider = ALL_PROVIDERS.find((p) => p.name === providerName);

  const [step, setStep] = useState<Step>('strategy');
  const [strategyIndex, setStrategyIndex] = useState(0);
  const [selectedStrategy, setSelectedStrategy] = useState<TokenStrategy | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [passwordValue, setPasswordValue] = useState('');
  const [confirmPasswordValue, setConfirmPasswordValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [validatedName, setValidatedName] = useState<string | null>(null);
  const [hasInput, setHasInput] = useState(false);

  const isMaskedInput = selectedStrategy === 'encrypted' || selectedStrategy === 'password';
  const inputLabel = selectedStrategy === 'env'
    ? 'Environment variable name'
    : selectedStrategy === 'command'
      ? 'Shell command'
      : `${provider?.name ?? providerName} API token`;

  const handleValidateAndSave = useCallback(async () => {
    if (!selectedStrategy || !provider) return;
    setStep('validating');
    setError(null);

    try {
      // For env strategy, resolve the actual token from the env var
      let tokenToValidate = inputValue;
      if (selectedStrategy === 'env') {
        const envVal = process.env[inputValue];
        if (!envVal) {
          setError(`Environment variable ${inputValue} is not set`);
          setStep('input');
          return;
        }
        tokenToValidate = envVal;
      } else if (selectedStrategy === 'command') {
        // For command, don't validate now — just save the config
        const { execSync } = await import('node:child_process');
        try {
          tokenToValidate = execSync(inputValue, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          }).trim();
        } catch {
          setError(`Command failed: ${inputValue}`);
          setStep('input');
          return;
        }
      }

      // Validate the token
      const displayName = await provider.validate(tokenToValidate);

      // Store based on strategy
      const strategyValue =
        selectedStrategy === 'env' || selectedStrategy === 'command'
          ? inputValue
          : credentialPath(providerName);

      await storeToken(
        providerName,
        selectedStrategy,
        selectedStrategy === 'env' || selectedStrategy === 'command'
          ? '' // No token to encrypt for env/command
          : inputValue,
        strategyValue,
        selectedStrategy === 'password' ? passwordValue : undefined
      );

      // For env/command, store just the config pointer
      if (selectedStrategy === 'env' || selectedStrategy === 'command') {
        const { setTokenConfig } = await import('./config.js');
        await setTokenConfig(providerName, { [selectedStrategy]: inputValue });
      }

      setValidatedName(displayName);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('input');
    }
  }, [selectedStrategy, inputValue, passwordValue, provider, providerName]);

  // Strategy selection keybinds
  useKeybinds(keybinds, {
    navigate: (key) => {
      if (step !== 'strategy') return false;
      const dir = key.name === 'up' || key.name === 'k' ? -1 : 1;
      setStrategyIndex((i) => Math.max(0, Math.min(STRATEGY_OPTIONS.length - 1, i + dir)));
    },
    select: () => {
      if (step === 'strategy') {
        const chosen = STRATEGY_OPTIONS[strategyIndex];
        setSelectedStrategy(chosen.key);
        setStep('input');
        return;
      }
      if (step === 'done') {
        goBack();
      }
    },
    back: () => {
      if (step === 'strategy') {
        goBack();
      } else if (step === 'input') {
        setStep('strategy');
        setInputValue('');
        setHasInput(false);
      } else if (step === 'password') {
        setStep('input');
        setPasswordValue('');
      } else if (step === 'confirm-password') {
        setStep('password');
        setConfirmPasswordValue('');
      } else if (step === 'done') {
        goBack();
      }
    },
    quit: () => {
      process.exit(0);
    },
  });

  // Text input handler for input/password steps
  useKeyboard((key) => {
    if (step === 'input') {
      if (key.name === 'return' && inputValue.length > 0) {
        if (selectedStrategy === 'password') {
          setStep('password');
        } else {
          void handleValidateAndSave();
        }
        return true;
      }
      if (key.name === 'backspace') {
        setInputValue((v) => v.slice(0, -1));
        if (inputValue.length <= 1) setHasInput(false);
        return true;
      }
      if (key.raw && key.raw.length === 1 && !key.ctrl) {
        setInputValue((v) => v + key.raw);
        setHasInput(true);
        return true;
      }
    }
    if (step === 'password') {
      if (key.name === 'return' && passwordValue.length > 0) {
        setStep('confirm-password');
        return true;
      }
      if (key.name === 'backspace') {
        setPasswordValue((v) => v.slice(0, -1));
        return true;
      }
      if (key.raw && key.raw.length === 1 && !key.ctrl) {
        setPasswordValue((v) => v + key.raw);
        return true;
      }
    }
    if (step === 'confirm-password') {
      if (key.name === 'return' && confirmPasswordValue.length > 0) {
        if (confirmPasswordValue !== passwordValue) {
          setError('Passwords do not match');
          setConfirmPasswordValue('');
          setStep('password');
          return true;
        }
        void handleValidateAndSave();
        return true;
      }
      if (key.name === 'backspace') {
        setConfirmPasswordValue((v) => v.slice(0, -1));
        return true;
      }
      if (key.raw && key.raw.length === 1 && !key.ctrl) {
        setConfirmPasswordValue((v) => v + key.raw);
        return true;
      }
    }
    return false;
  });

  const parts = footerParts(keybinds);
  const footerRows = buildFooterRows(parts, width);
  const displayName = provider?.name ?? providerName;

  return (
    <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
      <box style={{ height: 1, width: '100%' }}>
        <text content={` Setup ${displayName}`} fg="#7aa2f7" bold />
      </box>
      <box style={{ height: 1, width: '100%' }}>
        <text content={'─'.repeat(width)} fg="#292e42" />
      </box>
      <box flexDirection="column" style={{ flexGrow: 1 }}>
        {error && (
          <box style={{ height: 1 }}>
            <text content={`  Error: ${error}`} fg="#f7768e" />
          </box>
        )}

        {step === 'strategy' && (
          <>
            <box style={{ height: 1 }}>
              <text content="  How would you like to store your token?" fg="#a9b1d6" />
            </box>
            <box style={{ height: 1 }} />
            {STRATEGY_OPTIONS.map((opt, i) => {
              const isActive = i === strategyIndex;
              return (
                <box
                  key={opt.key}
                  style={{
                    height: 1,
                    width: '100%',
                    backgroundColor: isActive ? '#292e42' : undefined,
                  }}
                  onMouseDown={() => {
                    if (isActive) {
                      setSelectedStrategy(opt.key);
                      setStep('input');
                    } else {
                      setStrategyIndex(i);
                    }
                  }}
                >
                  <text
                    content={`  ${isActive ? '>' : ' '} ${opt.label}`}
                    fg={isActive ? '#c0caf5' : '#a9b1d6'}
                  />
                  <text content={`  ${opt.description}`} fg="#565f89" />
                </box>
              );
            })}
          </>
        )}

        {step === 'input' && (
          <>
            <box style={{ height: 1 }}>
              <text content={`  ${inputLabel}:`} fg="#a9b1d6" />
            </box>
            <box style={{ height: 1 }}>
              <text
                content={`  ${isMaskedInput ? (hasInput ? MASK_INDICATOR : '(enter token)') : inputValue || '(type here)'}`}
                fg={hasInput || inputValue ? '#c0caf5' : '#565f89'}
              />
            </box>
            {provider?.settingsUrl && (
              <box style={{ height: 1, marginTop: 1 }}>
                <text content={`  Get your token: ${provider.settingsUrl}`} fg="#565f89" />
              </box>
            )}
          </>
        )}

        {(step === 'password' || step === 'confirm-password') && (
          <>
            <box style={{ height: 1 }}>
              <text
                content={`  ${step === 'password' ? 'Enter password' : 'Confirm password'}:`}
                fg="#a9b1d6"
              />
            </box>
            <box style={{ height: 1 }}>
              <text
                content={`  ${
                  (step === 'password' ? passwordValue : confirmPasswordValue).length > 0
                    ? MASK_INDICATOR
                    : '(enter password)'
                }`}
                fg={
                  (step === 'password' ? passwordValue : confirmPasswordValue).length > 0
                    ? '#c0caf5'
                    : '#565f89'
                }
              />
            </box>
          </>
        )}

        {step === 'validating' && (
          <box style={{ height: 1 }}>
            <text content="  Validating token..." fg="#e0af68" />
          </box>
        )}

        {step === 'done' && (
          <box style={{ height: 1 }}>
            <text
              content={`  ${CHECKMARK} ${displayName} connected as ${validatedName}. Token saved.`}
              fg="#9ece6a"
            />
          </box>
        )}
      </box>
      <box style={{ height: 1, width: '100%', backgroundColor: '#1a1b26' }}>
        <text content={'─'.repeat(width)} fg="#292e42" />
      </box>
      <FooterRows rows={footerRows} fg="#565f89" />
    </box>
  );
}
```

**Step 2: Verify it typechecks**

Run: `cd packages/git-switchboard && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/git-switchboard/src/connect-setup.tsx
git commit -m "feat: add multi-step token setup flow view"
```

---

### Task 9: Connect Router & Command Definition (`connect-router.tsx`)

Ties the three views together with the `TuiRouter` and `defineCommand` pattern.

**Files:**
- Create: `packages/git-switchboard/src/connect-router.tsx`

**Step 1: Create the connect router**

```typescript
import { ConnectList } from './connect-list.js';
import { ConnectDetail } from './connect-detail.js';
import { ConnectSetup } from './connect-setup.js';
import { TuiRouter } from './tui-router.js';
import { defineCommand, defineView } from './view.js';
import { UP_ARROW, DOWN_ARROW, RETURN_SYMBOL, LEFT_ARROW } from './unicode.js';

export type ConnectScreen =
  | { type: 'provider-list' }
  | { type: 'provider-detail'; providerName: string }
  | { type: 'setup'; providerName: string };

export const CONNECT_COMMAND = defineCommand<ConnectScreen>()({
  name: 'connect',
  description: 'Manage provider tokens.',
  views: {
    'provider-list': defineView<ConnectScreen>()({
      keybinds: {
        navigate: {
          keys: ['up', 'k', 'down', 'j'],
          label: 'j/k or Up/Down',
          description: 'Navigate',
          terminal: `[${UP_ARROW}${DOWN_ARROW}] Navigate`,
        },
        select: {
          keys: ['return'],
          label: 'Enter',
          description: 'View provider',
          terminal: `[${RETURN_SYMBOL}] Select`,
        },
        quit: {
          keys: ['q', 'escape'],
          label: 'q or Esc',
          description: 'Quit',
          terminal: '[q]uit',
        },
      },
      render: (_, keybinds) => <ConnectList keybinds={keybinds} />,
    }),

    'provider-detail': defineView<ConnectScreen>()({
      keybinds: {
        setup: {
          keys: ['s'],
          label: 's',
          description: 'Setup new token',
          terminal: '[s]etup',
        },
        disconnect: {
          keys: ['d'],
          label: 'd',
          description: 'Disconnect',
          terminal: '[d]isconnect',
          conditional: true,
        },
        confirmDisconnect: {
          keys: ['y'],
          label: 'y',
          description: 'Confirm disconnect',
          terminal: '[y]es, remove',
          conditional: true,
        },
        cancelDisconnect: {
          keys: ['n', 'escape'],
          label: 'n or Esc',
          description: 'Cancel',
          terminal: '[n]o, cancel',
          conditional: true,
        },
        back: {
          keys: ['backspace', 'left'],
          label: 'Backspace',
          description: 'Back to list',
          terminal: `[${LEFT_ARROW}] Back`,
        },
        quit: {
          keys: ['q'],
          label: 'q',
          description: 'Quit',
          terminal: '[q]uit',
        },
      },
      render: (screen, keybinds) => (
        <ConnectDetail
          providerName={
            (screen as Extract<ConnectScreen, { type: 'provider-detail' }>).providerName
          }
          keybinds={keybinds}
        />
      ),
    }),

    setup: defineView<ConnectScreen>()({
      keybinds: {
        navigate: {
          keys: ['up', 'k', 'down', 'j'],
          label: 'j/k or Up/Down',
          description: 'Navigate options',
          terminal: `[${UP_ARROW}${DOWN_ARROW}] Navigate`,
        },
        select: {
          keys: ['return'],
          label: 'Enter',
          description: 'Confirm',
          terminal: `[${RETURN_SYMBOL}] Confirm`,
        },
        back: {
          keys: ['escape'],
          label: 'Esc',
          description: 'Back',
          terminal: `[Esc] Back`,
        },
        quit: {
          keys: ['q'],
          label: 'q',
          description: 'Quit',
          terminal: '[q]uit',
        },
      },
      render: (screen, keybinds) => (
        <ConnectSetup
          providerName={
            (screen as Extract<ConnectScreen, { type: 'setup' }>).providerName
          }
          keybinds={keybinds}
        />
      ),
    }),
  },
});

export function ConnectRouter({ initialProvider }: { initialProvider?: string }) {
  const initialScreen: ConnectScreen = initialProvider
    ? { type: 'setup', providerName: initialProvider }
    : { type: 'provider-list' };

  return (
    <TuiRouter<ConnectScreen>
      views={CONNECT_COMMAND.views}
      initialScreen={initialScreen}
    />
  );
}
```

**Step 2: Verify it typechecks**

Run: `cd packages/git-switchboard && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/git-switchboard/src/connect-router.tsx
git commit -m "feat: add connect router with list/detail/setup views"
```

---

### Task 10: Wire `connect` Subcommand into CLI (`cli.ts`)

Add the `connect` subcommand to the CLI entry point.

**Files:**
- Modify: `packages/git-switchboard/src/cli.ts`

**Step 1: Add the connect command**

In `packages/git-switchboard/src/cli.ts`, add a new `.command('connect', ...)` block after the existing `.command('pr', ...)` block (after line 317, before the closing of the builder chain). Insert right before the handler for the default command:

```typescript
.command('connect', {
  description: 'Manage provider token connections',
  builder: (c) =>
    c.option('provider', {
      type: 'string',
      description: 'Provider to configure (github, linear)',
    }),
  handler: async (args) => {
    const { createCliRenderer } = await import('@opentui/core');
    const { createRoot } = await import('@opentui/react');
    const React = await import('react');
    const { createElement } = React;
    const { ConnectRouter } = await import('./connect-router.js');

    process.on('SIGINT', () => process.exit(0));

    const renderer = await createCliRenderer({ exitOnCtrlC: false });
    const root = createRoot(renderer);

    root.render(
      createElement(ConnectRouter, {
        initialProvider: args.provider ?? undefined,
      }) as React.ReactNode
    );
  },
})
```

**Step 2: Verify it typechecks**

Run: `cd packages/git-switchboard && npx tsc --noEmit`
Expected: No errors

**Step 3: Test manually**

Run: `cd packages/git-switchboard && bun run src/cli.ts connect`
Expected: Shows the provider list TUI with GitHub and Linear

Run: `cd packages/git-switchboard && bun run src/cli.ts connect --provider linear`
Expected: Goes directly to the Linear setup flow

**Step 4: Commit**

```bash
git add packages/git-switchboard/src/cli.ts
git commit -m "feat: wire connect subcommand into CLI"
```

---

### Task 11: Integrate TokenStore into PR and Branch Command Token Resolution

Update the existing command handlers to use `resolveToken` from the TokenStore before falling back to the existing sync chain.

**Files:**
- Modify: `packages/git-switchboard/src/cli.ts`

**Step 1: Update the PR command handler**

In `packages/git-switchboard/src/cli.ts`, in the PR command handler (around line 92-93), replace the token resolution:

```typescript
// Before:
const token = resolveGitHubToken(args['github-token']);

// After:
const { resolveToken } = await import('./token-store.js');
const { GITHUB_PROVIDER } = await import('./providers.js');
const token =
  (await resolveToken(GITHUB_PROVIDER, { flagValue: args['github-token'] })) ??
  resolveGitHubToken(args['github-token']);
```

**Step 2: Update the default command handler**

In the default command handler (around line 346), apply the same pattern:

```typescript
// Before:
const token = resolveGitHubToken(args['github-token']);

// After:
const { resolveToken } = await import('./token-store.js');
const { GITHUB_PROVIDER } = await import('./providers.js');
const token =
  (await resolveToken(GITHUB_PROVIDER, { flagValue: args['github-token'] })) ??
  resolveGitHubToken(args['github-token']);
```

**Step 3: Verify it typechecks**

Run: `cd packages/git-switchboard && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/git-switchboard/src/cli.ts
git commit -m "feat: integrate TokenStore into GitHub token resolution"
```

---

### Task 12: End-to-End Testing

Manual testing of all flows.

**Step 1: Test connect list view**

Run: `cd packages/git-switchboard && bun run src/cli.ts connect`
Expected: Shows GitHub (not configured) and Linear (not configured)

**Step 2: Test encrypted strategy setup**

1. Navigate to Linear → press `s` for setup
2. Select "Encrypted (machine-locked)"
3. Paste a Linear API token
4. Should validate and show "Linear connected as [name]"
5. Press Enter to go back

Verify: `cat ~/.config/git-switchboard/config.json` should show linear config
Verify: `ls ~/.config/git-switchboard/credentials/` should show `linear.enc`

**Step 3: Test env strategy setup**

1. Set `export LINEAR_TOKEN=your-token`
2. `bun run src/cli.ts connect` → Linear → setup → Environment variable → `LINEAR_TOKEN`
3. Should validate and show connected

**Step 4: Test disconnect**

1. `bun run src/cli.ts connect` → select configured provider → press `d` → press `y`
2. Should show "not configured"

**Step 5: Test token resolution in main commands**

After configuring GitHub via `connect`, verify `bun run src/cli.ts` picks up the token from the config.

**Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during e2e testing"
```

---

## Summary

| Task | Component | Files |
|------|-----------|-------|
| 1 | Config module | `config.ts` |
| 2 | Crypto module | `crypto.ts` |
| 3 | Token store | `token-store.ts` |
| 4 | Provider defs | `providers.ts`, `github.ts` |
| 5 | GitHub migration | `github.ts` |
| 6 | List view | `connect-list.tsx` |
| 7 | Detail view | `connect-detail.tsx` |
| 8 | Setup view | `connect-setup.tsx` |
| 9 | Connect router | `connect-router.tsx` |
| 10 | CLI wiring | `cli.ts` |
| 11 | TokenStore integration | `cli.ts` |
| 12 | E2E testing | — |

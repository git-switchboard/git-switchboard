import { useState, useCallback } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import { useFocusedKeyboard, useFocusOwner } from './focus-stack.js';
import type { Keybind } from './view.js';
import { footerParts } from './view.js';
import { useKeybinds } from './use-keybinds.js';
import { buildFooterRows, FooterRows } from './footer.js';
import { useHistory } from './tui-router.js';
import { usePaste } from './use-paste.js';
import { storeToken, credentialPath } from './token-store.js';
import { ALL_PROVIDERS } from './providers.js';
import { CHECKMARK } from './unicode.js';
import type { TokenStrategy } from './config.js';
import { useConnectExit } from './connect-router.js';

type Step = 'strategy' | 'input' | 'password' | 'confirm-password' | 'validating' | 'done';

interface StrategyOption {
  key: TokenStrategy;
  label: string;
  description: string;
}

const STRATEGY_OPTIONS: StrategyOption[] = [
  { key: 'env', label: 'Environment variable', description: 'Read token from an env var at launch' },
  { key: 'encrypted', label: 'Encrypted (machine-locked)', description: 'No password needed \u2014 tied to this machine' },
  { key: 'password', label: 'Encrypted (password-protected)', description: 'Enter a password each launch' },
  { key: 'command', label: 'Shell command', description: 'Run a command to fetch the token' },
];

// Fixed-length masked indicator: shows activity without revealing length.
const MASK_INDICATOR = '\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF';

export function ConnectSetup({
  providerName,
  keybinds,
}: {
  providerName: string;
  keybinds: Record<string, Keybind>;
}) {
  const { width } = useTerminalDimensions();
  const { goBack } = useHistory();
  const onExit = useConnectExit();
  const provider = ALL_PROVIDERS.find((p) => p.name === providerName);

  const [step, setStep] = useState<Step>('strategy');
  const isTextInput = step === 'input' || step === 'password' || step === 'confirm-password';
  useFocusOwner('connect-input', isTextInput);
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
        // For command, execute it to get the token for validation
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
      onExit();
    },
  });

  // Text input handler for input/password steps — fires when connect-input focus is active.
  useFocusedKeyboard((key) => {
    key.stopPropagation();
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
      if (key.raw && key.raw.length >= 1 && !key.ctrl) {
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
      if (key.raw && key.raw.length >= 1 && !key.ctrl) {
        setPasswordValue((v) => v + key.raw);
        return true;
      }
    }
    if (step === 'confirm-password') {
      if (key.name === 'return' && confirmPasswordValue.length > 0) {
        if (confirmPasswordValue !== passwordValue) {
          setError('Passwords do not match');
          setConfirmPasswordValue('');
          return true;
        }
        void handleValidateAndSave();
        return true;
      }
      if (key.name === 'backspace') {
        setConfirmPasswordValue((v) => v.slice(0, -1));
        return true;
      }
      if (key.raw && key.raw.length >= 1 && !key.ctrl) {
        setConfirmPasswordValue((v) => v + key.raw);
        return true;
      }
    }
    return false;
  }, { focusId: 'connect-input' });

  // Handle bracketed paste events
  usePaste((text) => {
    if (step === 'input') {
      setInputValue((v) => v + text);
      setHasInput(true);
    } else if (step === 'password') {
      setPasswordValue((v) => v + text);
    } else if (step === 'confirm-password') {
      setConfirmPasswordValue((v) => v + text);
    }
  });

  const parts = footerParts(keybinds);
  const footerRows = buildFooterRows(parts, width);
  const displayName = provider?.name ?? providerName;

  return (
    <box flexDirection="column" style={{ width: '100%', height: '100%', padding: 1 }}>
      {/* Header */}
      <box style={{ height: 1, width: '100%' }}>
        <text content={` Setup ${displayName}`} fg="#7aa2f7" />
      </box>

      <box style={{ height: 1 }} />

      <box flexDirection="column">
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
                  <text>
                    <span fg={isActive ? '#c0caf5' : '#a9b1d6'}>{`  ${isActive ? '>' : ' '} ${opt.label.padEnd(30)}`}</span>
                    <span fg="#565f89">{opt.description}</span>
                  </text>
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

      {/* Fill remaining space */}
      <box style={{ flexGrow: 1 }} />

      {/* Footer */}
      <FooterRows rows={footerRows} fg="#565f89" />
    </box>
  );
}

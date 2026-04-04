import './styles.css';
import { createBridge, type BridgeMode } from './bridge.js';
import { mountBanner } from './banner.js';
import type { InitData } from './types.js';

const root = document.getElementById('app')!;
root.innerHTML = '<div class="loading">Connecting\u2026</div>';

const { bridge, mode } = createBridge();
const isDemo = mode === 'iframe' || mode === 'standalone';

// In iframe mode, show a banner at the bottom
if (mode === 'iframe') {
  const params = new URLSearchParams(window.location.search);
  const docsUrl = params.get('docsUrl') || '../';
  mountBanner(docsUrl);
}

function mount(data: InitData): void {
  root.innerHTML = '';
  if (data.view === 'branch-picker') {
    import('./branch-picker.js').then(({ mountBranchPicker }) => {
      mountBranchPicker(root, bridge, data, isDemo);
    });
  } else {
    import('./pr-dashboard.js').then(({ mountPRDashboard }) => {
      mountPRDashboard(root, bridge, data, isDemo);
    });
  }
}

// Register the message handler — the bridge will send init data when ready
bridge.onMessage((msg) => {
  if (msg.type === 'init') {
    mount(msg.data);
  }
});

// Tell the host we're ready to receive data
bridge.send({ type: 'ready' });

// For electrobun mode, also expose a global the bun process can call
// to push the init data after the window loads
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__gsb_init = (data: InitData) => {
  mount(data);
};

// Export mode for debugging
console.log(`[git-switchboard/ui] bridge mode: ${mode as BridgeMode}`);

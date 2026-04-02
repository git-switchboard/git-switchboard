import vikeReact from 'vike-react/config';
import type { Config } from 'vike/types';

export default {
  title: 'git-switchboard',
  description: 'Interactive TUI for browsing and checking out git branches',
  prerender: true,
  passToClient: ['navigation'],
  extends: [vikeReact],
} satisfies Config;

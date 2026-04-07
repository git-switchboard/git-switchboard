/**
 * Generates keybindings JSON for the docs site.
 *
 * Iterates ALL_COMMANDS (the authoritative CommandTui registry) and serializes
 * each command's views to a nested JSON structure consumed by the docs site.
 *
 * Usage: bun run packages/git-switchboard/scripts/generate-keybindings.ts <output-json>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ALL_COMMANDS } from '../src/commands.js';

const [outputPath] = process.argv.slice(2);

if (!outputPath) {
  console.error('Usage: bun run generate-keybindings.ts <output-json>');
  process.exit(1);
}

type KeybindingsOutput = Record<
  string, // command name
  Record<
    string, // view name
    { key: string; action: string; conditional?: boolean }[]
  >
>;

// Tooling-only loose type — we only need keybind metadata, not render functions.
type AnyViews = Record<string, {
  keybinds: Record<string, { label: string; description: string; conditional?: boolean }>;
}>;

const output: KeybindingsOutput = {};

for (const command of ALL_COMMANDS) {
  output[command.name] = {};
  for (const [viewName, view] of Object.entries(command.views as AnyViews)) {
    output[command.name][viewName] = Object.entries(view.keybinds).map(
      ([, kb]) => ({
        key: kb.label,
        action: kb.description,
        ...(kb.conditional ? { conditional: true } : {}),
      })
    );
  }
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`Wrote keybindings for ${ALL_COMMANDS.length} command(s) to ${outputPath}`);

import { mkdirSync } from 'node:fs';
import { join } from "node:path";

const targets = [
  { target: 'bun-darwin-arm64', output: 'git-switchboard-darwin-arm64' },
  { target: 'bun-darwin-x64', output: 'git-switchboard-darwin-x64' },
  { target: 'bun-linux-x64', output: 'git-switchboard-linux-x64' },
  { target: 'bun-linux-arm64', output: 'git-switchboard-linux-arm64' },
  { target: 'bun-windows-x64', output: 'git-switchboard-windows-x64.exe' },
  { target: 'bun-windows-arm64', output: 'git-switchboard-windows-arm64.exe' },
];

const args = process.argv.slice(2).filter(a => a !== '--');
const selectedTarget = args[0];

mkdirSync('native-builds', { recursive: true });

const buildTargets = selectedTarget
  ? targets.filter(t => t.target === selectedTarget || t.output === selectedTarget)
  : targets;

if (selectedTarget && buildTargets.length === 0) {
  console.error(`Unknown target: ${selectedTarget}`);
  console.error(`Valid targets: ${targets.map(t => t.target).join(', ')}`);
  process.exit(1);
}

for (const { target, output } of buildTargets) {
  console.log(`Building ${output}...`);
  const result = await Bun.build({
    entrypoints: [join(import.meta.dirname, '../src/cli.ts')],
    compile: {
      target,
      outfile: `native-builds/${output}`,
    },

    minify: true,
  });

  if (!result.success) {
    console.error(`Failed to build ${output}:`);
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }
}

console.log(`Built ${buildTargets.length} native binaries.`);

import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

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

for (const { target, output } of buildTargets) {
  console.log(`Building ${output}...`);
  execSync(
    `bun build src/cli.ts --compile --target=${target} --outfile=native-builds/${output}`,
    { stdio: 'inherit', cwd: process.cwd() }
  );
}

console.log(`Built ${buildTargets.length} native binaries.`);

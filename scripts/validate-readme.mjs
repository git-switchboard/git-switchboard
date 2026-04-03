#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import ejs from 'ejs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Parse arguments: [projectRoot] [--check] [--no-check] [--check=true|false]
const args = process.argv.slice(2);
let projectRoot = '.';
let check = !!process.env.CI;

for (const arg of args) {
  if (arg === '--check') {
    check = true;
  } else if (arg === '--no-check') {
    check = false;
  } else if (arg.startsWith('--check=')) {
    const val = arg.slice('--check='.length);
    check = val !== 'false' && val !== '0';
  } else if (!arg.startsWith('--')) {
    projectRoot = arg;
  }
}

// Resolve paths — script lives at scripts/validate-readme.mjs, repo root is one level up
const repoRoot = resolve(__dirname, '..');
const projectRootResolved = resolve(repoRoot, projectRoot);

// Load shared partials
const partialsDir = join(__dirname, 'readme-partials');
const basicUsage = readFileSync(join(partialsDir, 'basic-usage.md'), 'utf8').trimEnd();

// Template variables passed to every template
const templateVars = { basicUsage };

// Load and render template
const templatePath = join(projectRootResolved, 'README.md.template');
if (!existsSync(templatePath)) {
  console.error(`Template not found: ${templatePath}`);
  process.exit(1);
}

const template = readFileSync(templatePath, 'utf8');
const rendered = ejs.render(template, templateVars, { filename: templatePath });

// Load existing README
const readmePath = join(projectRootResolved, 'README.md');
const existing = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';

if (existing === rendered) {
  console.log('README.md is up to date.');
  process.exit(0);
}

if (check) {
  console.error(
    `README.md is out of date in ${projectRoot}. Run the validate-readme target locally (without CI env) to update it.`
  );
  printDiff(existing, rendered);
  process.exit(1);
} else {
  writeFileSync(readmePath, rendered, 'utf8');
  console.log(`Updated ${readmePath}`);
  printDiff(existing, rendered);
}

function printDiff(oldContent, newContent) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'readme-diff-'));
  try {
    const oldFile = join(tmpDir, 'README.md.old');
    const newFile = join(tmpDir, 'README.md.new');
    writeFileSync(oldFile, oldContent);
    writeFileSync(newFile, newContent);
    const result = spawnSync(
      'diff',
      ['-u', '--label', 'README.md (current)', '--label', 'README.md (expected)', oldFile, newFile],
      { encoding: 'utf8' }
    );
    if (result.stdout) {
      console.log(result.stdout);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

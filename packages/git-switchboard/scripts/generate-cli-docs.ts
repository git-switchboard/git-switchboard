/**
 * Generates CLI documentation JSON for the docs site.
 *
 * Run with: bunx --bun cli-forge generate-documentation src/cli.ts --format json --output <dir>
 * Then this script sanitizes the output (e.g. removes local paths from defaults).
 *
 * Usage: bun run packages/git-switchboard/scripts/generate-cli-docs.ts <input-json> <output-json>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error(
    'Usage: bun run generate-cli-docs.ts <input-json> <output-json>'
  );
  process.exit(1);
}

const raw = JSON.parse(readFileSync(inputPath, 'utf-8'));

/**
 * Walk the documentation tree and sanitize values.
 */
function sanitize(doc: Record<string, unknown>): Record<string, unknown> {
  const options = doc.options as Record<
    string,
    Record<string, unknown>
  > | undefined;
  if (options) {
    for (const opt of Object.values(options)) {
      // Replace absolute home paths in defaults with ~/
      if (typeof opt.default === 'string' && opt.default.includes('/Users/')) {
        opt.default = opt.default.replace(
          /\/Users\/[^/]+/,
          '~'
        );
      }
      if (Array.isArray(opt.default)) {
        opt.default = opt.default.map((v: unknown) =>
          typeof v === 'string' && v.includes('/Users/')
            ? v.replace(/\/Users\/[^/]+/, '~')
            : v
        );
      }
      // Remove camelCase aliases (keep only short flags)
      if (Array.isArray(opt.alias)) {
        opt.alias = (opt.alias as string[]).filter(
          (a) => a.length <= 2
        );
        if ((opt.alias as string[]).length === 0) delete opt.alias;
      }
    }
  }

  // Recurse into subcommands
  if (Array.isArray(doc.subcommands)) {
    doc.subcommands = (doc.subcommands as Record<string, unknown>[]).map(sanitize);
  }

  return doc;
}

const sanitized = sanitize(raw);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(sanitized, null, 2));
console.log(`Wrote sanitized CLI docs to ${outputPath}`);

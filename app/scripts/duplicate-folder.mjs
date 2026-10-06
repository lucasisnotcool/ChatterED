// Duplicate a folder (or one notebook) in a ChatterED database, headless, with the app quit.
//
//   node scripts/duplicate-folder.mjs --db "$HOME/Library/Application Support/ChatterED/app.db" \
//     --folder fd_ec72ae1bbe6d --name "CS4246 (exam prep)" --exclude-research
//
// The work is the app's own code, `src/main/notebooks/duplicatecli.ts` (and through it
// `duplicate.ts`, the migrations and the driver). This file only bundles that entry with Rolldown
// (Vite 8's bundler, already a devDependency; `bundle-preload.mjs` uses it the same way) into
// `node_modules/.cache/chattered/`, so the bundle's `require('better-sqlite3-node')` resolves from
// this app's own node_modules, then runs it and prints its JSON. Options: `--help`, or see the
// header of duplicatecli.ts. Exit code 0 when every check of the copy passed, 1 otherwise, 2 when
// it could not run.
import { build } from 'rolldown';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(appDir, 'node_modules/.cache/chattered');
const outFile = resolve(outDir, 'duplicate-cli.cjs');

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
  console.log(`usage: node scripts/duplicate-folder.mjs --db <path to app.db> (--folder fd_… | --notebook nb_…)
         [--name "<new name>"] [--exclude-research | --include-research] [--root <notebooks dir>]
         [--no-backup] [--force]

Quit ChatterED first. The database is backed up to <db dir>/backups/before-duplicate-<time>.db
unless --no-backup. A duplicate is excluded from research data unless --include-research.`);
  process.exit(argv.length === 0 ? 2 : 0);
}

try {
  mkdirSync(outDir, { recursive: true });
  await build({
    input: resolve(appDir, 'src/main/notebooks/duplicatecli.ts'),
    platform: 'node',
    // Native and Node built-ins stay `require`s; everything of ours is inlined.
    external: [/^better-sqlite3/, /^node:/],
    output: { file: outFile, format: 'cjs', sourcemap: false },
    logLevel: 'warn',
  });
  const require = createRequire(outFile);
  const cli = require(outFile);
  const result = cli.runDuplicateCli(argv, { migrationsDir: resolve(appDir, 'src/main/db/migrations') });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
} catch (err) {
  console.error(`duplicate-folder: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

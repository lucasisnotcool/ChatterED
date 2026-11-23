// Write one notebook of a ChatterED profile out as a seed: a notebook that ships already read.
//
//   node scripts/export-notebook-seed.mjs --db <scratch profile>/app.db --out samples/graph-traversal-seed
//
// The work is the app's own code, `src/main/notebooks/seedcli.ts` (and through it `seed.ts`,
// `duplicate.ts`, the migrations and the driver). This file only bundles that entry with Rolldown,
// as `duplicate-folder.mjs` does, then runs it and prints its JSON. Quit the app on that profile
// first. Exit code 0 when every source's file was carried, 1 otherwise, 2 when it could not run.
import { build } from 'rolldown';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(appDir, 'node_modules/.cache/chattered');
const outFile = resolve(outDir, 'seed-cli.cjs');

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
  console.log('usage: node scripts/export-notebook-seed.mjs --db <path to app.db> --out <seed dir> [--notebook nb_…] [--force]');
  process.exit(argv.length === 0 ? 2 : 0);
}

try {
  mkdirSync(outDir, { recursive: true });
  await build({
    input: resolve(appDir, 'src/main/notebooks/seedcli.ts'),
    platform: 'node',
    external: [/^better-sqlite3/, /^node:/],
    output: { file: outFile, format: 'cjs', sourcemap: false },
    logLevel: 'warn',
  });
  const require = createRequire(outFile);
  const cli = require(outFile);
  const result = cli.runSeedCli(argv, { migrationsDir: resolve(appDir, 'src/main/db/migrations') });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
} catch (err) {
  console.error(`export-notebook-seed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

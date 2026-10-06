// Loads the app's own TypeScript into a plain-Node script, so headless tools run exactly the code
// the app runs (the chunker, the ranker, the importer) rather than a copy of it.
//
// It bundles `src/main/search/scriptkit.ts` with Rolldown (Vite 8's own bundler, already a
// dependency; see bundle-preload.mjs) into node_modules/.cache/chattered-scripts/, then imports it.
// About a second, every run, so a source edit is never stale.
import { build } from 'rolldown';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The script kit: see `src/main/search/scriptkit.ts` for what it exports. */
export async function loadKit() {
  const outDir = join(appDir, 'node_modules', '.cache', 'chattered-scripts');
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, 'scriptkit.mjs');
  await build({
    input: join(appDir, 'src/main/search/scriptkit.ts'),
    platform: 'node',
    // Native and heavy modules stay outside; the scripts import them themselves.
    external: ['electron', 'better-sqlite3', 'better-sqlite3-node', '@huggingface/transformers'],
    output: { file, format: 'esm', sourcemap: false },
    logLevel: 'warn',
  });
  return import(`${pathToFileURL(file).href}?t=${Date.now()}`);
}

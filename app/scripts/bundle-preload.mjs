// Bundles the preload into ONE file, dist/preload/index.js (release review P1-11).
//
// The window runs with `sandbox: true`, and a sandboxed preload's `require` knows only
// `electron` (and a handful of Node built-ins such as `events` and `url`) — not the preload's own
// sibling modules. tsc's output did `require("../shared/ipc.js")`, which would throw there and
// leave the renderer with no bridge. So the preload and everything it imports from src/shared
// are inlined here, with `electron` left as the one external `require`.
//
// Rolldown is Vite 8's own bundler (a dependency of the `vite` devDependency, which pins its
// version), so this adds nothing to install.
// tsconfig.main.json excludes src/preload, so tsc never writes a second, unbundled copy over
// this one; `npm run typecheck` (tsconfig.json) still type-checks it.
//
//   node scripts/bundle-preload.mjs           build once
//   node scripts/bundle-preload.mjs --watch   rebuild on change (npm run dev)
import { build, watch } from 'rolldown';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = resolve(appDir, 'dist/preload/index.js');

/** What a sandboxed preload may `require`; anything else in the bundle is a build error. */
const SANDBOX_REQUIRES = new Set(['electron', 'events', 'timers', 'url']);

const options = {
  input: resolve(appDir, 'src/preload/index.ts'),
  platform: 'node',
  external: ['electron'],
  // No comments, like tsconfig.main.json's removeComments: they cite research docs and people.
  output: { file: outFile, format: 'cjs', sourcemap: false, comments: false },
  logLevel: 'warn',
};

function check() {
  const code = readFileSync(outFile, 'utf8');
  const requires = [...code.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
  const bad = requires.filter((r) => !SANDBOX_REQUIRES.has(r.replace(/^node:/, '')));
  if (bad.length > 0) {
    throw new Error(`[preload] the bundle requires ${bad.join(', ')}, which a sandboxed preload cannot load`);
  }
  if (!requires.includes('electron')) throw new Error('[preload] the bundle does not require electron');
  console.log(`[preload] bundled → ${outFile} (requires: ${[...new Set(requires)].join(', ')})`);
}

if (process.argv.includes('--watch')) {
  const watcher = watch(options);
  watcher.on('event', (event) => {
    if (event.code === 'BUNDLE_END') {
      try {
        check();
      } catch (err) {
        console.error(err.message);
      }
      event.result?.close?.();
    } else if (event.code === 'ERROR') {
      console.error('[preload]', event.error?.message ?? event.error);
    }
  });
} else {
  await build(options);
  check();
}

// Compile build/swap-bundle.c to build/bin/chattered-swap (arm64, macOS 13), which
// electron-builder ships as Contents/Resources/chattered-swap (electron-builder.yml). The arm64
// linker ad-hoc signs it. Skipped, with a note, where there is no clang (Linux CI): the app then
// falls back to the journaled two-rename swap.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(appDir, 'build/bin/chattered-swap');
if (process.platform !== 'darwin') {
  console.log('[swap] not macOS: chattered-swap not built');
  process.exit(0);
}
mkdirSync(dirname(out), { recursive: true });
execFileSync('/usr/bin/clang', ['-O2', '-Wall', '-arch', 'arm64', '-mmacosx-version-min=13.0', '-o', out, resolve(appDir, 'build/swap-bundle.c')], {
  stdio: 'inherit',
});
console.log(`[swap] ${out}`);

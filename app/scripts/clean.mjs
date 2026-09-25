// Removes dist/ before a build. tsc never deletes an output whose source is gone, and
// copy-assets.mjs only adds, so without this a deleted module (or a renumbered migration,
// which runMigrations would still apply) ships in the next app (release review P1-9).
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
rmSync(dist, { recursive: true, force: true });
console.log(`[clean] removed ${dist}`);

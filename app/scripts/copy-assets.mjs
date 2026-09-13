// tsc does not copy .sql files, and the migrations are the schema's source of truth, so they
// are copied into dist next to the compiled db module (and into app.asar by electron-builder).
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(appDir, 'src/main/db/migrations');
const to = resolve(appDir, 'dist/main/db/migrations');
mkdirSync(dirname(to), { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`[assets] migrations → ${to}`);

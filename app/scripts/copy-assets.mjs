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

// ── what the build carries about itself (src/main/update/baked.ts) ──────────
// tools/release.sh sets these; a plain `npm run build` (and install-local.sh) sets none, which
// gives a build with no update channel: it never looks for updates.
import { createHash, createPublicKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const env = process.env;
const variant = env.CHATTERED_VARIANT === 'test' ? 'test' : 'production';
if (variant !== 'test' && (env.CHATTERED_UPDATE_TEST_URL || env.CHATTERED_TEST_FAULT)) {
  console.error('[assets] CHATTERED_UPDATE_TEST_URL / CHATTERED_TEST_FAULT are for CHATTERED_VARIANT=test only.');
  process.exit(1);
}
let sha = env.CHATTERED_SHA || '';
if (!sha) {
  try {
    sha = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: appDir, encoding: 'utf8' }).trim();
  } catch {
    sha = 'unknown';
  }
}
const keysDir = env.CHATTERED_UPDATE_KEYS_DIR || resolve(appDir, 'build/update-keys');
const keys = [];
for (const role of ['active', 'cold']) {
  const file = resolve(keysDir, `${role}.pub.pem`);
  if (!existsSync(file)) continue;
  const pem = readFileSync(file, 'utf8');
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ec') throw new Error(`${file} is not an EC (P-256) public key`);
  const id = createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
  keys.push({ id, role, pem });
}
const baked = {
  variant,
  build: Number.parseInt(env.CHATTERED_BUILD || '0', 10) || 0,
  sha,
  channel: env.CHATTERED_UPDATE_CHANNEL || null,
  keys,
  manifestUrls: variant === 'test' && env.CHATTERED_UPDATE_TEST_URL ? [env.CHATTERED_UPDATE_TEST_URL] : [],
  test: variant === 'test',
  fault: variant === 'test' ? env.CHATTERED_TEST_FAULT || null : null,
};
const bakedOut = resolve(appDir, 'dist/main/update/baked.json');
mkdirSync(dirname(bakedOut), { recursive: true });
writeFileSync(bakedOut, `${JSON.stringify(baked, null, 2)}\n`);
console.log(
  `[assets] baked → ${bakedOut} (variant ${variant}, build ${baked.build}, channel ${baked.channel ?? 'none'}, keys ${keys.map((k) => `${k.role}:${k.id}`).join(' ') || 'none'})`,
);

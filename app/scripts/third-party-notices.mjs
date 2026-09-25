// Writes dist/notices/THIRD_PARTY_NOTICES.txt: the copyright and licence text of every
// third-party package that ships in the app. electron-builder.yml copies it (with Electron's
// own LICENSE and LICENSES.chromium.html) into ChatterED.app/Contents/Resources. MIT, BSD and
// Apache-2.0 all require the notice to travel with a binary redistribution, and a public DMG
// is one (release review P1-8).
//
// "What ships" is read from two places, not guessed:
//   - the main process loads packages from node_modules inside app.asar, and electron-builder
//     puts there exactly the production dependency tree of package.json — walked below, minus
//     the packages electron-builder.yml excludes (EXCLUDED);
//   - the renderer is a Vite bundle, so the packages it inlines are read from the `sources` of
//     its source maps (`vite build --sourcemap hidden`; the maps themselves are excluded from
//     the app by `!**/*.map`). That catches svelte's runtime without its compiler's deps.
//
// No dependencies beyond Node. Run after `build:renderer`.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nodeModules = join(appDir, 'node_modules');
const outFile = join(appDir, 'dist/notices/THIRD_PARTY_NOTICES.txt');

/** Keep in step with the `!node_modules/...` lines in electron-builder.yml. */
const EXCLUDED = new Set(['@napi-rs/canvas', '@napi-rs/canvas-darwin-arm64', 'node-addon-api']);

const LICENCE_FILE = /^(licen[cs]e|copying|notice)(\.|-|$)/i;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Node's lookup: the nearest node_modules/<name> walking up from `fromDir`. */
function resolvePackageDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dir === appDir) return null;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** Every installed package reachable from package.json `dependencies` (the asar's node_modules). */
function productionPackages() {
  const found = new Map(); // dir -> package.json
  const visit = (dir) => {
    if (found.has(dir)) return;
    const pkg = readJson(join(dir, 'package.json'));
    if (EXCLUDED.has(pkg.name)) return;
    found.set(dir, pkg);
    const deps = { ...pkg.dependencies, ...pkg.optionalDependencies };
    for (const name of Object.keys(deps)) {
      const child = resolvePackageDir(name, dir);
      if (child) visit(child); // an optional dependency for another platform is not installed
    }
  };
  const root = readJson(join(appDir, 'package.json'));
  for (const name of Object.keys(root.dependencies ?? {})) {
    const dir = resolvePackageDir(name, appDir);
    if (!dir) throw new Error(`[notices] production dependency ${name} is not installed`);
    visit(dir);
  }
  return found;
}

/** Package directories named by the renderer bundle's source maps. */
function rendererPackages() {
  const assets = join(appDir, 'dist/renderer/assets');
  const maps = existsSync(assets) ? readdirSync(assets).filter((f) => f.endsWith('.js.map')) : [];
  if (maps.length === 0) {
    throw new Error('[notices] no renderer source maps: build the renderer with `vite build --sourcemap hidden` first');
  }
  const found = new Map();
  for (const file of maps) {
    const map = readJson(join(assets, file));
    for (const source of map.sources ?? []) {
      const abs = resolve(assets, map.sourceRoot ?? '', source.replace(/^\0/, ''));
      const at = abs.lastIndexOf(`${sep}node_modules${sep}`);
      if (at < 0) continue;
      const rest = abs.slice(at + `${sep}node_modules${sep}`.length).split(sep);
      const name = rest[0]?.startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
      const dir = join(abs.slice(0, at), 'node_modules', name);
      if (!found.has(dir) && existsSync(join(dir, 'package.json'))) found.set(dir, readJson(join(dir, 'package.json')));
    }
  }
  return found;
}

function licenceTexts(dir) {
  return readdirSync(dir)
    .filter((f) => LICENCE_FILE.test(f))
    .sort()
    .map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8').trim() }));
}

function licenceField(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ');
  return 'UNKNOWN';
}

function repoUrl(pkg) {
  const r = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  return (pkg.homepage ?? r ?? '').replace(/^git\+/, '');
}

const byId = new Map(); // name@version -> { pkg, dir, where:Set }
const add = (entries, where) => {
  for (const [dir, pkg] of entries) {
    if (EXCLUDED.has(pkg.name)) continue;
    const id = `${pkg.name}@${pkg.version}`;
    const entry = byId.get(id) ?? { pkg, dir, where: new Set() };
    entry.where.add(where);
    byId.set(id, entry);
  }
};
add(productionPackages(), 'main process');
add(rendererPackages(), 'renderer bundle');

const electronPkg = readJson(join(nodeModules, 'electron/package.json'));
const electronLicence = readFileSync(join(nodeModules, 'electron/dist/LICENSE'), 'utf8').trim();

const rule = '='.repeat(78);
const ids = [...byId.keys()].sort((a, b) => a.localeCompare(b));
const missing = [];
const parts = [
  'ChatterED — third-party notices',
  '',
  'ChatterED includes the open-source software listed below. Each is distributed under its',
  "own licence, reproduced in full after the list. Electron's licence follows the list;",
  "Chromium's and its components' licences are in LICENSES.chromium.html next to this file.",
  '',
  `  electron@${electronPkg.version} (MIT) — the application runtime`,
  ...ids.map((id) => {
    const { pkg, where } = byId.get(id);
    return `  ${id} (${licenceField(pkg)}) — ${[...where].sort().join(', ')}`;
  }),
  '',
  rule,
  `electron@${electronPkg.version} — MIT`,
  'https://github.com/electron/electron',
  rule,
  '',
  electronLicence,
  '',
];
for (const id of ids) {
  const { pkg, dir } = byId.get(id);
  const texts = licenceTexts(dir);
  if (texts.length === 0) missing.push(id);
  parts.push(rule, `${id} — ${licenceField(pkg)}`);
  const url = repoUrl(pkg);
  if (url) parts.push(url);
  parts.push(rule, '');
  if (texts.length === 0) {
    parts.push(`This package ships no licence file; its package.json declares the licence as ${licenceField(pkg)}.`);
    if (pkg.author) parts.push(`Author: ${typeof pkg.author === 'string' ? pkg.author : pkg.author.name}`);
    parts.push('');
  }
  for (const { file, text } of texts) {
    if (texts.length > 1) parts.push(`--- ${file} ---`);
    parts.push(text, '');
  }
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, parts.join('\n'));
console.log(`[notices] ${ids.length + 1} packages → ${outFile}`);
if (missing.length) console.log(`[notices] no licence file (licence field used): ${missing.join(', ')}`);

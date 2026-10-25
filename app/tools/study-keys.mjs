/**
 * Make the study build's key bundle, and the codes to send each participant.
 *
 *   npm run study:keys -- --keys <slots.csv> --out <dir> [--budget 30] [--model claude-sonnet-5-5]
 *                         [--study "CS3249 field phase, Oct 2026"] [--add]
 *
 * <slots.csv> has one line per participant slot: `slot,api-key` (a header line is skipped). Each
 * key should be an API key from that slot's own Anthropic Console workspace, which carries the
 * slot's spend limit (app/docs/STUDY-RELEASE.md §2).
 *
 * Writes, into <dir>:
 *   keys.json    the sealed bundle. Not secret on its own: it ships inside the study DMG.
 *   codes.csv    `slot,code`, mode 0600. Secret: each line opens one key. Send each participant
 *                their own line, and keep the file out of every repo and every shared folder.
 *
 * <dir> must be outside the repo. --add seals new slots into an existing bundle and leaves the
 * slots already in it (and their codes) as they were.
 *
 * It seals with the app's own code, `src/main/study/crypto.ts`, compiled (`npm run study:keys`
 * builds the main process first), so the tool and the app cannot drift apart.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BUNDLE_FORMAT, BUNDLE_VERSION, DEFAULT_KDF, newCode, parseBundle, sealSlot, slotId, unsealSlot } = require(
  '../dist/main/study/crypto.js',
);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function die(msg) {
  process.stderr.write(`study-keys: ${msg}\n`);
  process.exit(1);
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) die(`unexpected argument ${a}`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
    else {
      out[a.slice(2)] = next;
      i++;
    }
  }
  return out;
}

const a = args(process.argv.slice(2));
if (a.help || !a.keys || !a.out) {
  process.stdout.write(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?|^ \* ?/gm, ''));
  process.exit(a.help ? 0 : 2);
}

const outDir = resolve(String(a.out));
const rel = relative(REPO_ROOT, outDir);
if (!rel.startsWith('..') && !rel.startsWith('/')) die(`--out ${outDir} is inside the repo. Use a folder outside it, e.g. ~/.config/chattered-study.`);

const budget = a.budget === undefined ? 30 : Number(a.budget);
if (!(budget > 0)) die('--budget must be a positive number of US dollars.');
const model = typeof a.model === 'string' ? a.model : 'claude-sonnet-5-5';
if (!/^claude-[a-z0-9-]+$/.test(model) || /fable|mythos/.test(model)) die(`--model ${model} is not a usable Claude model id.`);

const rows = readFileSync(resolve(String(a.keys)), 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#') && !/^slot\s*,/i.test(l))
  .map((l) => {
    const [slot, key, ...rest] = l.split(',').map((x) => x.trim());
    if (!slot || !key || rest.length > 0) die(`cannot read the line "${l.slice(0, 12)}…": expected slot,api-key`);
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) die(`slot ${slot}: that is not an Anthropic API key.`);
    return { slot: slotId(slot), key };
  });
if (rows.length === 0) die('no slots in --keys.');
if (new Set(rows.map((r) => r.slot)).size !== rows.length) die('a slot appears twice in --keys.');
if (new Set(rows.map((r) => r.key)).size !== rows.length) die('the same API key is listed for two slots; each slot needs its own workspace key.');

const bundlePath = join(outDir, 'keys.json');
const codesPath = join(outDir, 'codes.csv');
let bundle;
let codeLines;
if (existsSync(bundlePath)) {
  if (!a.add) die(`${bundlePath} exists. Pass --add to seal new slots into it, or choose another --out.`);
  const existing = parseBundle(readFileSync(bundlePath, 'utf8'));
  if (!existing) die(`${bundlePath} is not a study bundle this version can read.`);
  bundle = existing;
  codeLines = existsSync(codesPath) ? readFileSync(codesPath, 'utf8').trim().split('\n') : ['slot,code'];
  for (const r of rows) if (bundle.slots[r.slot]) die(`slot ${r.slot} is already in the bundle; --add only adds new slots.`);
} else {
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  bundle = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    study: typeof a.study === 'string' ? a.study : 'ChatterED study',
    createdAt: new Date().toISOString(),
    kdf: DEFAULT_KDF,
    slots: {},
  };
  codeLines = ['slot,code'];
}

const issuedAt = new Date().toISOString();
const fresh = [];
for (const r of rows) {
  const code = newCode(r.slot);
  bundle.slots[r.slot] = sealSlot(
    { slot: r.slot, provider: 'anthropic', apiKey: r.key, budgetUsd: budget, models: { agent: model, orchestrator: model }, issuedAt },
    code,
    bundle.kdf,
  );
  fresh.push({ slot: r.slot, code });
}

// Prove every new code opens its own slot, with the app's own reader, before anything is written.
for (const { slot, code } of fresh) {
  const opened = unsealSlot(bundle, code);
  if (!opened.ok || opened.payload.slot !== slot) die(`self-check failed for slot ${slot}; nothing was written.`);
}

writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o644 });
writeFileSync(codesPath, `${[...codeLines, ...fresh.map((f) => `${f.slot},${f.code}`)].join('\n')}\n`, { mode: 0o600 });
chmodSync(codesPath, 0o600);

process.stdout.write(
  [
    `Sealed ${fresh.length} slot(s) (${Object.keys(bundle.slots).length} in the bundle), $${budget} each, on ${model}.`,
    `  bundle: ${bundlePath}   → tools/release.sh --study ${bundlePath}`,
    `  codes:  ${codesPath}   (secret: one line per participant)`,
    '',
  ].join('\n'),
);

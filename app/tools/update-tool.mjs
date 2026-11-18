#!/usr/bin/env node
// The update channel's owner-side tool (app/docs/STUDY-RELEASE.md §8). tools/release.sh calls it;
// the owner runs `keygen` once by hand.
//
//   node tools/update-tool.mjs keygen [--dir ~/.config/chattered-release]
//       Two ECDSA P-256 key pairs: active (signs every release) and cold (the backup: copy it to the
//       offline drive, then delete cold.key.pem from this Mac). Private keys 0600 in a 0700 folder.
//       Refuses to overwrite. Copy the two .pub.pem files into app/build/update-keys/ and commit them.
//   node tools/update-tool.mjs entry --app <X.app> --zip <zip> --url <url> --build N --commit SHA [--db-schema N]
//       One build's entry (what a manifest says about a payload), as JSON on stdout.
//   node tools/update-tool.mjs manifest --app-id ID --channel C --out FILE [--base FILE]
//       [--default ENTRY] [--pin] [--target ID=ENTRY]... [--target-pin ID=ENTRY]... [--untarget ID[,ID]]...
//       [--block N,N] [--unblock N,N] [--paused | --resume] [--key-add PUB.pem]... [--key-revoke KEYID]...
//       [--notes TEXT]
//       Writes the manifest's exact bytes. --base is the manifest published now: its other fields
//       and targets are kept. A new default must be newer than the base's, unless --pin.
//   node tools/update-tool.mjs sign --key KEY.pem --in FILE [--out FILE.sig]
//   node tools/update-tool.mjs verify --baked dist/main/update/baked.json --in FILE [--sig FILE.sig] [--install-id ID]
//       Verifies with the keys the built app trusts, through the app's own verifyManifest.
//   node tools/update-tool.mjs builds --in FILE      the highest build the manifest names (default and targets)
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function die(msg) {
  console.error(`update-tool: ${msg}`);
  process.exit(1);
}

function opts(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      o._.push(a);
      continue;
    }
    const k = a.slice(2);
    const flags = new Set(['pin', 'paused', 'resume']);
    if (flags.has(k)) {
      o[k] = true;
      continue;
    }
    const v = argv[++i];
    if (v === undefined) die(`--${k} needs a value`);
    if (o[k] === undefined) o[k] = v;
    else o[k] = [].concat(o[k], v);
  }
  return o;
}

const list = (v) => (v === undefined ? [] : [].concat(v));
const ints = (v) =>
  list(v)
    .flatMap((s) => String(s).split(','))
    .filter(Boolean)
    .map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n) || n < 1) die(`not a build number: ${s}`);
      return n;
    });

function plist(app, key) {
  try {
    return execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', join(app, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function keygen(o) {
  const dir = resolve(o.dir ?? join(homedir(), '.config', 'chattered-release'));
  for (const role of ['active', 'cold']) if (existsSync(join(dir, `${role}.key.pem`)) || existsSync(join(dir, `${role}.pub.pem`))) die(`${dir} already has ${role} keys; refusing to overwrite.`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  for (const role of ['active', 'cold']) {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    writeFileSync(join(dir, `${role}.key.pem`), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
    writeFileSync(join(dir, `${role}.pub.pem`), publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644, flag: 'wx' });
  }
  console.log(`Keys written to ${dir} (folder 0700, private keys 0600).

Next, once:
  1. Copy the public keys into the app and commit them (they are public):
       mkdir -p app/build/update-keys && cp ${dir}/active.pub.pem ${dir}/cold.pub.pem app/build/update-keys/
  2. Back up BOTH private keys offline (the Passport drive), outside every repo and synced folder.
  3. Delete cold.key.pem from this Mac after the backup: it is only for replacing a lost or leaked
     active key (a manifest it signs may carry keys.add / keys.revoke).
  Never put either private key on gram-server, in GitHub secrets, or under ~/data.`);
}

function entry(o) {
  for (const k of ['app', 'zip', 'url', 'build', 'commit']) if (!o[k]) die(`entry needs --${k}`);
  const app = resolve(o.app);
  const build = Number(o.build);
  if (plist(app, 'CFBundleVersion') !== String(build)) die(`${app} has CFBundleVersion ${plist(app, 'CFBundleVersion')}, not ${build}.`);
  if (existsSync(join(app, 'Contents', 'Resources', 'study'))) die(`${app} carries Contents/Resources/study: never in an update.`);
  const zip = readFileSync(resolve(o.zip));
  const cd = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', app], { encoding: 'utf8' });
  const cdhash = /^CDHash=([0-9a-f]+)$/m.exec(cd.stderr)?.[1];
  if (!cdhash) die(`no CDHash for ${app}`);
  const out = {
    build,
    version: plist(app, 'CFBundleShortVersionString') ?? '0.0.0',
    commit: String(o.commit).slice(0, 40),
    url: o.url,
    size: zip.length,
    sha256: createHash('sha256').update(zip).digest('hex'),
    cdhash,
    minOs: plist(app, 'LSMinimumSystemVersion') ?? '13.0',
    ...(o['db-schema'] ? { dbSchema: Number(o['db-schema']) } : {}),
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

const ENTRY_FIELDS = ['build', 'version', 'commit', 'url', 'mirrors', 'size', 'sha256', 'cdhash', 'minOs', 'dbSchema'];
function readEntry(file) {
  const e = JSON.parse(readFileSync(resolve(file), 'utf8'));
  for (const k of ['build', 'url', 'size', 'sha256']) if (e[k] === undefined) die(`${file} is not a build entry (no ${k})`);
  return Object.fromEntries(ENTRY_FIELDS.filter((k) => e[k] !== undefined).map((k) => [k, e[k]]));
}

function maxBuild(m) {
  let max = Number(m.build) || 0;
  for (const t of Object.values(m.targets ?? {})) max = Math.max(max, Number(t?.build) || 0);
  return max;
}

function manifest(o) {
  for (const k of ['app-id', 'channel', 'out']) if (!o[k]) die(`manifest needs --${k}`);
  const base = o.base && existsSync(o.base) ? JSON.parse(readFileSync(o.base, 'utf8')) : null;
  const m = base ? { ...base } : { format: 'chattered-update', schema: 1, arch: 'arm64' };
  m.format = 'chattered-update';
  m.schema = 1;
  m.appId = o['app-id'];
  m.arch = 'arm64';
  m.channel = o.channel;
  m.targets = { ...(m.targets ?? {}) };
  if (o.default) {
    const e = readEntry(o.default);
    if (base && !o.pin && e.build <= Number(base.build)) die(`the new default build ${e.build} is not newer than the published ${base.build} (use --pin for a rollback).`);
    for (const k of ENTRY_FIELDS) delete m[k];
    Object.assign(m, e);
    m.pin = o.pin === true;
    // A target already at or below the new default has nothing left to override.
    for (const [id, t] of Object.entries(m.targets)) if (!t.pin && Number(t.build) <= e.build) delete m.targets[id];
  } else if (o.pin) die('--pin needs --default (the build to pin the channel to).');
  for (const [flag, pinned] of [
    ['target', false],
    ['target-pin', true],
  ]) {
    for (const spec of list(o[flag])) {
      const [id, file] = String(spec).split('=');
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(id ?? '') || !file) die(`--${flag} takes <install id>=<entry.json>, not ${spec}`);
      m.targets[id] = { ...readEntry(file), pin: pinned };
    }
  }
  for (const id of list(o.untarget).flatMap((v) => String(v).split(','))) delete m.targets[id];
  if (!Object.keys(m.targets).length) delete m.targets;
  const blocked = new Set([...(m.blocked ?? []), ...ints(o.block)]);
  for (const n of ints(o.unblock)) blocked.delete(n);
  if (blocked.has(m.build)) die(`the default build ${m.build} cannot also be blocked.`);
  m.blocked = [...blocked].sort((a, b) => a - b);
  for (const [id, t] of Object.entries(m.targets ?? {})) {
    if (blocked.has(Number(t.build))) die(`install ${id} is targeted at build ${t.build}, which is blocked: --untarget ${id} first.`);
  }
  // Pins never expire on their own: say which are still in force on every publish.
  for (const [id, t] of Object.entries(m.targets ?? {})) {
    console.error(`update-tool: target ${id} → build ${t.build}${t.pin ? ' (pinned: stays until --untarget)' : ''}`);
  }
  if (o.paused && o.resume) die('--paused or --resume, not both.');
  if (o.paused) m.paused = true;
  if (o.resume) delete m.paused;
  // Key rotation: honoured by the app only when the manifest is signed with the cold key.
  const keyAdd = list(o['key-add']).map((f) => readFileSync(resolve(f), 'utf8'));
  const keyRevoke = list(o['key-revoke']).flatMap((v) => String(v).split(','));
  for (const k of keyRevoke) if (!/^[0-9a-f]{16}$/.test(k)) die(`--key-revoke takes a 16-hex key id, not ${k}`);
  if (keyAdd.length || keyRevoke.length) m.keys = { add: keyAdd, revoke: keyRevoke };
  else delete m.keys;
  if (o.notes !== undefined) m.notes = String(o.notes).slice(0, 500);
  // Signed in and raised by every publish: an app refuses a manifest older than the newest it has seen.
  m.seq = (Number(base?.seq) || 0) + 1;
  if (!m.url || !m.sha256) die('the manifest has no default build: pass --default (or --base with one).');
  m.publishedAt = new Date().toISOString();
  writeFileSync(o.out, `${JSON.stringify(m, null, 2)}\n`);
  console.error(`update-tool: manifest → ${o.out} (default ${m.build}${m.pin ? ', pinned' : ''}; targets ${Object.keys(m.targets ?? {}).length}; blocked [${m.blocked.join(',')}])`);
}

function signCmd(o) {
  if (!o.key || !o.in) die('sign needs --key and --in');
  const st = statSync(o.key);
  if (st.mode & 0o077) die(`${o.key} is readable by others (mode ${(st.mode & 0o777).toString(8)}); chmod 600 it.`);
  const key = createPrivateKey(readFileSync(o.key));
  if (key.asymmetricKeyType !== 'ec') die(`${o.key} is not an EC key`);
  const sig = sign('sha256', readFileSync(o.in), key);
  writeFileSync(o.out ?? `${o.in}.sig`, sig);
  console.error(`update-tool: signed → ${o.out ?? `${o.in}.sig`}`);
}

function verifyCmd(o) {
  if (!o.baked || !o.in) die('verify needs --baked and --in');
  const lib = join(APP_DIR, 'dist', 'main', 'update', 'manifest.js');
  if (!existsSync(lib)) die('dist/main/update/manifest.js is missing: run npm run build:main first.');
  const { verifyManifest, trustedKeys } = require(lib);
  const { parseBaked } = require(join(APP_DIR, 'dist', 'main', 'update', 'baked.js'));
  const baked = parseBaked(readFileSync(o.baked, 'utf8'));
  if (!baked.keys.length) die(`${o.baked} trusts no keys.`);
  const r = verifyManifest(readFileSync(o.in), readFileSync(o.sig ?? `${o.in}.sig`), trustedKeys(baked.keys, { add: [], revoke: [] }), {
    allowHttp: baked.test,
    installId: o['install-id'] ?? null,
  });
  if (!r.ok) die(`does not verify: ${r.reason}`);
  if (r.manifest.appId !== baked.appId) die(`appId ${r.manifest.appId} is not this build's ${baked.appId}`);
  console.log(JSON.stringify({ ok: true, signer: r.signer.role, build: r.manifest.build, targeted: r.manifest.targeted, url: r.manifest.url, sha256: r.manifest.sha256 }));
}

const [cmd, ...rest] = process.argv.slice(2);
const o = opts(rest);
switch (cmd) {
  case 'keygen':
    keygen(o);
    break;
  case 'entry':
    entry(o);
    break;
  case 'manifest':
    manifest(o);
    break;
  case 'sign':
    signCmd(o);
    break;
  case 'verify':
    verifyCmd(o);
    break;
  case 'builds':
    if (!o.in) die('builds needs --in');
    console.log(maxBuild(JSON.parse(readFileSync(o.in, 'utf8'))));
    break;
  default:
    console.error(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(cmd ? 2 : 0);
}

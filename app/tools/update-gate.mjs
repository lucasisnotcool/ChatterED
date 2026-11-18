#!/usr/bin/env node
// **The release gate** (app/docs/STUDY-RELEASE.md §8): proves that this commit's updater works,
// end to end, on real packaged bundles, before anything from it is published.
//
//   node tools/update-gate.mjs [--work DIR] [--port 8765] [--build 9001] [--reuse] [--keep]
//
// With the test variant ("ChatterED Test", sg.nus.chattered.test: its own bundle id, userData and
// channel; throwaway keys; a local http manifest), all inside --work, never touching the real app,
// its data, or /Applications:
//   1. builds candidate N from HEAD (tools/release.sh --variant test --update), unless --reuse;
//   2. installs it at <work>/inst/Applications/ChatterED Test.app, with a dummy sealed study bundle
//      (a fake key) in Resources/study, re-signed, as a study DMG's copy would be;
//   3. serves N+1 (N re-stamped) and N+2 (re-stamped with ChatterEDTestFault=crash-at-launch-live);
//   4. launches N: it must stage N+1 (download, verify, smoke launch); quit; launch N again: it must
//      swap N+1 in and relaunch it, keep N as N-1, keep the study bundle (in userData), show the note;
//   5. N+1 stages N+2; quit; launch: N+2 is swapped in and exits at every launch; on the third, the
//      bootstrap rolls back to N+1, marks N+2 bad, and N+1 never stages N+2 again.
// Every launch has HOME and the profile inside --work and a PATH without the Claude CLI, so nothing
// calls a model. On success it writes ~/.config/chattered-release/gate/pass-<sha> (or --pass-dir),
// which `release.sh --publish-update` requires. The candidate is the test variant of this commit,
// so this proves this commit's code, not the production binary's bytes.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, createReadStream, statSync, chmodSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'ChatterED Test';

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const flag = (k) => argv.includes(`--${k}`);
// Not under out/: release.sh starts with rm -rf out.
const WORK = resolve(opt('work', join(tmpdir(), 'chattered-update-gate')));
const PORT = Number(opt('port', '8765'));
const B = Number(opt('build', '9001'));
const PASS_DIR = resolve(opt('pass-dir', join(homedir(), '.config', 'chattered-release', 'gate')));
const KEYS = join(WORK, 'keys');
const SERVE = join(WORK, 'serve');
const HOME = join(WORK, 'home');
const UD = join(WORK, 'ud');
const INST = join(WORK, 'inst', 'Applications', `${NAME}.app`);
const TOOLS = join(WORK, 'tools');
const LOG = join(HOME, 'Library', 'Logs', NAME, 'main.log');
const UPD = join(UD, 'updates.noindex');
const ENDPOINT = `http://127.0.0.1:${PORT}/test-manifest-v1.json`;

const started = Date.now();
const say = (m) => console.log(`[gate +${Math.round((Date.now() - started) / 1000)}s] ${m}`);
const fail = (m) => {
  console.error(`[gate] FAIL: ${m}`);
  cleanup();
  process.exit(1);
};
const run = (cmd, args, o = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...o });
const plist = (app, key) => {
  try {
    return run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', join(app, 'Contents', 'Info.plist')]).trim();
  } catch {
    return null;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const env = {
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  HOME,
  CFFIXED_USER_HOME: HOME,
  TMPDIR: process.env.TMPDIR ?? '/tmp',
  CHATTERED_TEST_FIRST_CHECK_MS: '2000',
  CHATTERED_HELPER_OPEN: join(TOOLS, 'open.sh'),
  CHATTERED_HELPER_LSREGISTER: '/usr/bin/true',
};

const children = [];
let server = null;
function cleanup() {
  server?.close();
  spawnSync('/usr/bin/pkill', ['-f', `${INST}/Contents/MacOS/`]);
  for (const c of children) {
    try {
      c.kill('SIGKILL');
    } catch {
      /* gone */
    }
  }
}
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

function events() {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return {};
      }
    });
}
async function waitFor(what, pred, ms) {
  const until = Date.now() + ms;
  for (;;) {
    const hit = events().find(pred);
    if (hit) return hit;
    if (Date.now() > until) fail(`timed out waiting for ${what}`);
    await sleep(500);
  }
}
const mark = () => events().length;

function launch() {
  const exe = join(INST, 'Contents', 'MacOS', NAME);
  const c = spawn(exe, [`--user-data-dir=${UD}`], { env, stdio: 'ignore', detached: true });
  children.push(c);
  return c;
}
async function quit(c, ms = 20000) {
  if (c.exitCode !== null) return;
  c.kill('SIGTERM');
  const until = Date.now() + ms;
  while (c.exitCode === null && c.signalCode === null) {
    if (Date.now() > until) fail('the app did not quit on SIGTERM');
    await sleep(200);
  }
}
async function appGone(ms = 30000) {
  const until = Date.now() + ms;
  while (spawnSync('/usr/bin/pgrep', ['-f', `${INST}/Contents/MacOS/${NAME}`]).status === 0) {
    if (Date.now() > until) fail('the app is still running');
    await sleep(300);
  }
}
async function killRunning() {
  spawnSync('/usr/bin/pkill', ['-TERM', '-f', `${INST}/Contents/MacOS/${NAME}`]);
  await appGone();
}

function restamp(from, to, build, extra = {}) {
  rmSync(to, { recursive: true, force: true });
  mkdirSync(dirname(to), { recursive: true });
  run('/usr/bin/ditto', [from, to]);
  run('/usr/bin/plutil', ['-replace', 'CFBundleVersion', '-string', String(build), join(to, 'Contents', 'Info.plist')]);
  for (const [k, v] of Object.entries(extra)) run('/usr/bin/plutil', ['-replace', k, '-string', v, join(to, 'Contents', 'Info.plist')]);
  run('/usr/bin/codesign', ['--force', '--deep', '-s', '-', to], { stdio: 'ignore' });
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', to]);
}

function publish(app, build) {
  const zip = join(SERVE, `ChatterED-Test-${build}-arm64.zip`);
  rmSync(zip, { force: true });
  run('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip]);
  const entry = join(SERVE, `build-${build}.json`);
  writeFileSync(
    entry,
    run(process.execPath, [join(APP_DIR, 'tools', 'update-tool.mjs'), 'entry', '--app', app, '--zip', zip, '--url', `http://127.0.0.1:${PORT}/${zip.split('/').pop()}`, '--build', String(build), '--commit', 'gate', '--db-schema', '999']),
  );
  const m = join(WORK, `manifest-${build}.json`);
  const base = join(SERVE, 'test-manifest-v1.json');
  run(process.execPath, [join(APP_DIR, 'tools', 'update-tool.mjs'), 'manifest', '--app-id', 'sg.nus.chattered.test', '--channel', 'test', '--out', m, '--base', base, '--default', entry], { stdio: 'ignore' });
  run(process.execPath, [join(APP_DIR, 'tools', 'update-tool.mjs'), 'sign', '--key', join(KEYS, 'active.key.pem'), '--in', m], { stdio: 'ignore' });
  writeFileSync(base, readFileSync(m));
  writeFileSync(`${base}.sig`, readFileSync(`${m}.sig`));
}

function serve() {
  server = createServer((req, res) => {
    const f = join(SERVE, decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, ''));
    if (!f.startsWith(SERVE) || !existsSync(f) || statSync(f).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Length': statSync(f).size });
    createReadStream(f).pipe(res);
  });
  return new Promise((r, j) => server.listen(PORT, '127.0.0.1', r).on('error', j));
}

/** A sealed study bundle with a fake key: what a study DMG carries, minus anything real. */
function dummyStudyBundle(file) {
  const crypto = require(join(APP_DIR, 'dist', 'main', 'study', 'crypto.js'));
  const kdf = { name: 'scrypt', N: 2 ** 10, r: 8, p: 1, keyLen: 32 };
  const code = crypto.newCode('01');
  const slot = crypto.sealSlot(
    { slot: '01', provider: 'anthropic', apiKey: 'sk-ant-api03-gate-dummy-not-a-key', budgetUsd: 1, models: { agent: 'm', orchestrator: 'm' }, issuedAt: new Date().toISOString() },
    code,
    kdf,
  );
  writeFileSync(file, JSON.stringify({ format: crypto.BUNDLE_FORMAT, version: crypto.BUNDLE_VERSION, study: 'gate', createdAt: new Date().toISOString(), kdf, slots: { '01': slot } }));
}

async function main() {
  if (process.platform !== 'darwin') fail('macOS only');
  const sha = run('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: APP_DIR }).trim();
  if (!flag('reuse')) rmSync(WORK, { recursive: true, force: true });
  for (const d of [SERVE, HOME, UD, TOOLS, dirname(INST)]) mkdirSync(d, { recursive: true });
  writeFileSync(
    join(TOOLS, 'open.sh'),
    `#!/bin/bash\n# The helper's relaunch, inside the gate's sandbox (the real /usr/bin/open would use the real home).\nfor last; do :; done\nHOME='${HOME}' CFFIXED_USER_HOME='${HOME}' PATH=/usr/bin:/bin:/usr/sbin:/sbin CHATTERED_TEST_FIRST_CHECK_MS=2000 CHATTERED_HELPER_OPEN='${join(TOOLS, 'open.sh')}' CHATTERED_HELPER_LSREGISTER=/usr/bin/true nohup "$last/Contents/MacOS/${NAME}" --user-data-dir='${UD}' >/dev/null 2>&1 &\n`,
  );
  chmodSync(join(TOOLS, 'open.sh'), 0o755);

  // 1. The candidate.
  let candidate = join(APP_DIR, 'out', 'mac-arm64', `${NAME}.app`);
  if (!flag('reuse') || !existsSync(join(KEYS, 'active.key.pem'))) {
    rmSync(KEYS, { recursive: true, force: true });
    run(process.execPath, [join(APP_DIR, 'tools', 'update-tool.mjs'), 'keygen', '--dir', KEYS], { stdio: 'ignore' });
  }
  if (!flag('reuse')) {
    say(`building candidate ${B} (test variant of ${sha})…`);
    const r = spawnSync('bash', [join(APP_DIR, 'tools', 'release.sh'), '--variant', 'test', '--update', '--build', String(B), '--keys-dir', KEYS, '--serve-dir', SERVE, '--test-endpoint', ENDPOINT], {
      cwd: APP_DIR,
      env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')),
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    writeFileSync(join(WORK, 'build.log'), r.stdout + r.stderr);
    if (r.status !== 0) fail(`release.sh failed (see ${join(WORK, 'build.log')})`);
  }
  if (plist(candidate, 'CFBundleVersion') !== String(B)) fail(`no candidate ${B} at ${candidate}`);
  candidate = join(WORK, 'candidate', `${NAME}.app`);
  rmSync(dirname(candidate), { recursive: true, force: true });
  mkdirSync(dirname(candidate), { recursive: true });
  run('/usr/bin/ditto', [join(APP_DIR, 'out', 'mac-arm64', `${NAME}.app`), candidate]);

  // 2. Install N as a study copy (a dummy sealed bundle in Resources/study, re-signed).
  rmSync(INST, { recursive: true, force: true });
  run('/usr/bin/ditto', [candidate, INST]);
  mkdirSync(join(INST, 'Contents', 'Resources', 'study'), { recursive: true });
  dummyStudyBundle(join(INST, 'Contents', 'Resources', 'study', 'keys.json'));
  run('/usr/bin/codesign', ['--force', '--deep', '-s', '-', INST], { stdio: 'ignore' });
  const studyBytes = readFileSync(join(INST, 'Contents', 'Resources', 'study', 'keys.json'));

  // 3. N+1 and (later) N+2.
  const n1 = join(WORK, 'n1', `${NAME}.app`);
  const n2 = join(WORK, 'n2', `${NAME}.app`);
  restamp(candidate, n1, B + 1);
  restamp(candidate, n2, B + 2, { ChatterEDTestFault: 'crash-at-launch-live' });
  publish(n1, B + 1);
  await serve();
  say(`serving N+1 = ${B + 1} at ${ENDPOINT}`);

  // 4. N stages N+1, is healthy, quits; the next launch swaps N+1 in.
  let c = launch();
  await waitFor(`build ${B} to stage ${B + 1}`, (e) => e.event === 'update.staged' && e.to === B + 1, 240000);
  say(`${B} staged ${B + 1} (downloaded, verified, smoke-launched)`);
  await waitFor(`build ${B} to be healthy`, (e) => e.event === 'update.healthy' && e.build === B, 90000);
  if (!existsSync(join(UD, 'study', 'keys.json')) || !readFileSync(join(UD, 'study', 'keys.json')).equals(studyBytes)) fail('the study bundle was not kept in userData');
  publish(n2, B + 2);
  say(`serving N+2 = ${B + 2} (exits at every real launch, passes its smoke launch)`);
  await quit(c);
  let n = mark();
  c = launch();
  await waitFor(`${B + 1} to start after the swap`, (e, i) => i >= n && e.event === 'app.start' && e.build === B + 1, 60000);
  await waitFor('update.applied', (e, i) => i >= n && e.event === 'update.applied' && e.to === B + 1, 30000);
  await waitFor('the "Updated to build N" note', (e, i) => i >= n && e.event === 'update.note_shown' && e.to === B + 1, 60000);
  if (plist(INST, 'CFBundleVersion') !== String(B + 1)) fail('the installed bundle is not N+1');
  if (existsSync(join(INST, 'Contents', 'Resources', 'study'))) fail('the updated bundle has Resources/study');
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', INST]);
  if (plist(join(UPD, 'previous', `${NAME}.app`), 'CFBundleVersion') !== String(B)) fail('N was not kept as N-1');
  say(`swapped: ${B} → ${B + 1}; N-1 kept; study bundle in userData; note shown; signature valid`);

  // 5. N+1 stages N+2, which keeps failing; the third launch rolls back.
  await waitFor(`${B + 1} to stage ${B + 2}`, (e, i) => i >= n && e.event === 'update.staged' && e.to === B + 2, 240000);
  await waitFor(`${B + 1} to be healthy`, (e, i) => i >= n && e.event === 'update.healthy' && e.build === B + 1, 90000);
  await killRunning();
  n = mark();
  launch();
  await waitFor(`${B + 2} to be swapped in`, (e, i) => i >= n && e.event === 'update.applied' && e.to === B + 2, 60000);
  await waitFor(`${B + 2}'s fault`, (e, i) => i >= n && e.event === 'update.fault' && e.build === B + 2, 30000);
  await appGone();
  // Launch again until the bootstrap rolls back (it must within three launches in all).
  for (let k = 0; k < 3 && !events().some((e, i) => i >= n && e.event === 'update.crash_loop'); k += 1) {
    const before = mark();
    launch();
    const got = await waitFor(`launch ${k + 2} of ${B + 2}`, (e, i) => i >= before && (e.event === 'update.fault' || e.event === 'update.crash_loop'), 30000);
    if (got.event === 'update.crash_loop') break;
    await appGone(60000);
  }
  await waitFor('the crash-loop rollback', (e, i) => i >= n && e.event === 'update.crash_loop' && e.build === B + 2, 30000);
  await waitFor(`${B + 1} back`, (e, i) => i >= n && e.event === 'app.start' && e.build === B + 1, 60000);
  await waitFor('update.rolled_back', (e, i) => i >= n && e.event === 'update.rolled_back' && e.to === B + 1, 30000);
  if (plist(INST, 'CFBundleVersion') !== String(B + 1)) fail('the installed bundle is not N+1 after the rollback');
  const state = JSON.parse(readFileSync(join(UPD, 'state.json'), 'utf8'));
  if (!state.badBuilds.includes(B + 2)) fail('N+2 is not marked bad');
  await waitFor(`${B + 1} to refuse ${B + 2}`, (e, i) => i >= n && e.event === 'update.check' && e.result === 'known_bad', 60000);
  say(`rolled back: ${B + 2} → ${B + 1}; ${B + 2} marked bad and not fetched again`);

  await killRunning();
  cleanup();
  mkdirSync(PASS_DIR, { recursive: true, mode: 0o700 });
  const pass = join(PASS_DIR, `pass-${sha}`);
  writeFileSync(pass, `${new Date().toISOString()} gate passed for ${sha} (candidate ${B})\n`);
  say(`PASS → ${pass}`);
  if (!flag('keep')) rmSync(join(WORK, 'n1'), { recursive: true, force: true });
}

main().catch((err) => fail(err?.stack ?? String(err)));

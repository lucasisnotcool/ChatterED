import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { checkExtracted, dbUserVersion, UpdateEngine, UPDATES_DIR, type EngineConfig } from './engine.js';
import { APP_ID, keyId, type TrustedKey } from './manifest.js';
import { swapPaths } from './plan.js';

const mac = process.platform === 'darwin' && existsSync('/usr/bin/codesign') && existsSync('/usr/bin/ditto');
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'chattered-engine-'));
  roots.push(d);
  return d;
}

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const KEYS: TrustedKey[] = [{ id: keyId(pem)!, role: 'active', pem }];

/**
 * A real, ad-hoc signed bundle whose executable is a shell script that answers the smoke launch
 * the way the app's bootstrap does (or fails to, with `smoke: 'fail'`).
 */
function makeApp(dir: string, build: number, o: { smoke?: 'ok' | 'fail' | 'wrong_build'; study?: boolean; id?: string } = {}): string {
  const app = join(dir, 'ChatterED.app');
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true });
  writeFileSync(
    join(app, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${o.id ?? APP_ID}</string>
<key>CFBundleExecutable</key><string>ChatterED</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>${build}</string>
</dict></plist>
`,
  );
  const answer = o.smoke === 'fail' ? '{"ok":false,"stage":"boot"}' : `{"ok":true,"stage":"ready","build":${o.smoke === 'wrong_build' ? build + 1 : build}}`;
  writeFileSync(
    join(app, 'Contents', 'MacOS', 'ChatterED'),
    `#!/bin/bash
for a in "$@"; do case "$a" in --chattered-smoke=*) ok="\${a#--chattered-smoke=}" ;; esac; done
[ -n "\${ok:-}" ] && echo '${answer}' > "$ok"
exit 0
`,
    { mode: 0o755 },
  );
  if (o.study) {
    mkdirSync(join(app, 'Contents', 'Resources', 'study'));
    writeFileSync(join(app, 'Contents', 'Resources', 'study', 'keys.json'), '{}');
  }
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '-s', '-', app], { stdio: 'ignore' });
  return app;
}

function zipOf(app: string, out: string): Buffer {
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, out]);
  return readFileSync(out);
}

function cdhash(app: string): string {
  const { stderr } = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', app], { encoding: 'utf8' });
  return /^CDHash=([0-9a-f]+)$/m.exec(stderr)![1]!;
}

interface World {
  engine: UpdateEngine;
  userData: string;
  logFile: string;
  spawned: string[][];
  served: Map<string, Buffer>;
  cfg: EngineConfig;
}

function world(over: Partial<EngineConfig> = {}): World {
  const root = tmp();
  const installed = join(root, 'Applications');
  mkdirSync(installed);
  const bundle = makeApp(installed, 500);
  const userData = join(root, 'userData');
  mkdirSync(userData);
  const served = new Map<string, Buffer>();
  const spawned: string[][] = [];
  const fakeFetch = (async (url: string | URL | Request) => {
    const body = served.get(String(url));
    if (!body) return new Response('missing', { status: 404 });
    return new Response(new Uint8Array(body));
  }) as typeof fetch;
  const cfg: EngineConfig = {
    bundlePath: bundle,
    appId: APP_ID,
    productName: 'ChatterED',
    swapTool: null,
    installId: 'install0001',
    role: 'main',
    userDataDir: userData,
    currentBuild: 500,
    sha: 'abc',
    channel: 'study',
    keys: KEYS,
    manifestUrls: ['https://example.test/study-manifest-v1.json'],
    allowHttp: false,
    osVersion: '15.0',
    logFile: join(root, 'logs', 'main.log'),
    logBase: { build: 500 },
    pid: process.pid,
    fetch: fakeFetch,
    spawnHelper: (_script, args) => spawned.push(args),
    smokeTimeoutSeconds: 20,
    ...over,
  };
  return { engine: new UpdateEngine(cfg), userData, logFile: cfg.logFile, spawned, served, cfg };
}

function publish(w: World, payloadApp: string, over: Record<string, unknown> = {}): void {
  const zip = zipOf(payloadApp, join(tmp(), 'p.zip'));
  const url = 'https://example.test/ChatterED-501.zip';
  w.served.set(url, zip);
  const m = Buffer.from(
    JSON.stringify({
      format: 'chattered-update',
      schema: 1,
      appId: APP_ID,
      arch: 'arm64',
      channel: 'study',
      build: 501,
      version: '0.1.0',
      url,
      size: zip.length,
      sha256: createHash('sha256').update(zip).digest('hex'),
      cdhash: cdhash(payloadApp),
      minOs: '13.0',
      dbSchema: 34,
      publishedAt: '2026-11-18T00:00:00Z',
      ...over,
    }),
  );
  w.served.set('https://example.test/study-manifest-v1.json', m);
  w.served.set('https://example.test/study-manifest-v1.json.sig', sign('sha256', m, privateKey));
}

function events(w: World): { event: string; [k: string]: unknown }[] {
  if (!existsSync(w.logFile)) return [];
  return readFileSync(w.logFile, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { event: string });
}

describe.runIf(mac)('UpdateEngine.check: download, verify, smoke, stage', () => {
  it('stages a good build after its smoke launch passes', async () => {
    const w = world();
    publish(w, makeApp(tmp(), 501));
    expect(await w.engine.check('test')).toBe(true);
    expect(w.engine.readStaged()).toMatchObject({ build: 501, downgrade: false });
    expect(events(w).map((e) => e.event)).toEqual(expect.arrayContaining(['update.check', 'update.downloaded', 'update.staged']));
    // The working folder is gone and nothing is left but the staged bundle.
    expect(existsSync(join(w.userData, UPDATES_DIR, 'staged', 'ChatterED.app', 'Contents', 'MacOS', 'ChatterED'))).toBe(true);
    // Checking again does not download again.
    expect(await w.engine.check('again')).toBe(true);
    expect(events(w).filter((e) => e.event === 'update.downloaded')).toHaveLength(1);
  }, 60_000);

  it.each([
    ['a wrong sha', { sha256: 'f'.repeat(64) }, 'download'],
    ['a size smaller than the zip', { size: 10 }, 'download'],
    ['a CDHash that is not the payload’s', { cdhash: 'e'.repeat(40) }, 'verify'],
  ])('refuses %s', async (_n, over, stage) => {
    const w = world();
    publish(w, makeApp(tmp(), 501), over);
    expect(await w.engine.check('test')).toBe(false);
    expect(w.engine.readStaged()).toBeNull();
    expect(events(w).find((e) => e.event === 'update.failed')).toMatchObject({ stage });
  }, 60_000);

  it.each([
    ['a payload that carries Resources/study', { study: true }, 'verify', 'payload_has_study'],
    ['another app’s bundle', { id: 'com.example.other' }, 'verify', 'bundle_id'],
    ['a smoke launch that fails', { smoke: 'fail' as const }, 'smoke', 'not_ok:boot'],
    ['a smoke launch from the wrong build', { smoke: 'wrong_build' as const }, 'smoke', 'wrong_build'],
  ])('refuses %s', async (_n, appOpts, stage, cause) => {
    const w = world();
    publish(w, makeApp(tmp(), 501, appOpts));
    expect(await w.engine.check('test')).toBe(false);
    expect(w.engine.readStaged()).toBeNull();
    expect(events(w).find((e) => e.event === 'update.failed')).toMatchObject({ stage, cause });
  }, 60_000);

  it('is quiet about an unreachable or unsigned manifest', async () => {
    const w = world();
    expect(await w.engine.check('offline')).toBe(false);
    expect(events(w).find((e) => e.event === 'update.check')).toMatchObject({ result: 'unavailable' });
    publish(w, makeApp(tmp(), 501));
    w.served.set('https://example.test/study-manifest-v1.json.sig', Buffer.from('bad'));
    expect(await w.engine.check('unsigned')).toBe(false);
    expect(events(w).filter((e) => e.event === 'update.check').pop()).toMatchObject({ cause: 'bad_signature' });
  }, 60_000);

  it('does not stage when the copy cannot replace itself', async () => {
    const w = world({ bundlePath: '/Volumes/ChatterED/ChatterED.app' });
    publish(w, makeApp(tmp(), 501));
    expect(await w.engine.check('dmg')).toBe(false);
    expect(events(w).find((e) => e.event === 'update.check' && e.result === 'location_dmg')).toBeTruthy();
  }, 60_000);
});

describe.runIf(mac)('UpdateEngine.early: at launch, before the app', () => {
  it('swaps a staged newer build in at launch, and discards a stale one', async () => {
    const w = world();
    publish(w, makeApp(tmp(), 501));
    await w.engine.check('test');
    const r = w.engine.early();
    expect(r).toEqual({ kind: 'exit', why: 'applying' });
    expect(w.spawned[0]?.[7]).toBe('apply');
    // A copy already at 502 (a newer DMG installed by hand) throws the 501 staging away.
    const newer = new UpdateEngine({ ...w.cfg, currentBuild: 502 });
    expect(newer.early().kind).toBe('continue');
    expect(newer.readStaged()).toBeNull();
  }, 60_000);

  it('logs what the last helper did, and says "Updated to build N" once', () => {
    const w = world();
    expect(w.engine.early()).toEqual({ kind: 'continue', note: null });
    const paths = swapPaths({ target: w.cfg.bundlePath, updatesDir: join(w.userData, UPDATES_DIR) });
    writeFileSync(paths.result, '{"mode":"apply","status":"ok","cause":"","from":500,"to":501,"via":"swap","at":"t"}');
    const next = new UpdateEngine({ ...w.cfg, currentBuild: 501 });
    expect(next.early()).toEqual({ kind: 'continue', note: { from: 500, to: 501 } });
    expect(events(w).find((e) => e.event === 'update.applied')).toMatchObject({ from: 500, to: 501 });
    expect(next.early()).toEqual({ kind: 'continue', note: null });
  });

  it('rolls a build that keeps crashing back to the kept previous one, and remembers it as bad', () => {
    const w = world();
    makeApp(join(w.userData, UPDATES_DIR, 'previous'), 499);
    expect(w.engine.early().kind).toBe('continue'); // launch 1 of 500 (crashes: never marked)
    expect(w.engine.early().kind).toBe('continue'); // launch 2: one crash counted
    const r = w.engine.early(); // launch 3: two crashes, never healthy
    expect(r).toEqual({ kind: 'exit', why: 'rolling_back' });
    expect(w.spawned[0]?.[7]).toBe('rollback');
    expect(w.engine.readState().badBuilds).toEqual([500]);
    expect(events(w).map((e) => e.event)).toEqual(expect.arrayContaining(['update.crash_loop', 'update.rollback', 'update.rolling_back']));
  });

  it('never rolls back a build that was healthy once, or one that quit cleanly', () => {
    const w = world();
    makeApp(join(w.userData, UPDATES_DIR, 'previous'), 499);
    w.engine.early();
    w.engine.markHealthy();
    w.engine.early();
    w.engine.early();
    expect(w.engine.early().kind).toBe('continue');
    const v = world();
    makeApp(join(v.userData, UPDATES_DIR, 'previous'), 499);
    for (let i = 0; i < 4; i += 1) {
      expect(v.engine.early().kind).toBe('continue');
      v.engine.markCleanExit();
    }
  });

  it('stops when a helper is still swapping', () => {
    const w = world();
    const lock = swapPaths({ target: w.cfg.bundlePath, updatesDir: join(w.userData, UPDATES_DIR) }).lock;
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, 'pid'), String(process.pid));
    expect(w.engine.early()).toEqual({ kind: 'exit', why: 'swap_in_progress' });
  });

  it('reports its state for the debug report from files alone', () => {
    const w = world();
    w.engine.early();
    expect(w.engine.status()).toMatchObject({ build: 500, channel: 'study', install_id: 'install0001', staged: null, bad_builds: [], journal_pending: false });
  });
});

describe('extraction and the database header', () => {
  it('accepts one bundle with internal links, refuses extra entries and escaping links', () => {
    const d = tmp();
    mkdirSync(join(d, 'ChatterED.app', 'Contents', 'Frameworks', 'X.framework', 'Versions', 'A'), { recursive: true });
    symlinkSync('A', join(d, 'ChatterED.app', 'Contents', 'Frameworks', 'X.framework', 'Versions', 'Current'));
    expect(checkExtracted(d, 'ChatterED.app')).toBe(join(d, 'ChatterED.app'));
    symlinkSync('/etc', join(d, 'ChatterED.app', 'Contents', 'evil'));
    expect(() => checkExtracted(d, 'ChatterED.app')).toThrow('payload_link_escapes');
    const e = tmp();
    mkdirSync(join(e, 'ChatterED.app'));
    mkdirSync(join(e, 'Other.app'));
    expect(() => checkExtracted(e, 'ChatterED.app')).toThrow('payload_layout');
  });

  it('reads user_version from a SQLite header without opening the database', () => {
    const d = tmp();
    const f = join(d, 'app.db');
    const header = Buffer.alloc(100);
    header.write('SQLite format 3\0', 0, 'latin1');
    header.writeUInt32BE(34, 60);
    writeFileSync(f, header);
    expect(dbUserVersion(f)).toBe(34);
    expect(dbUserVersion(join(d, 'missing.db'))).toBeNull();
    writeFileSync(f, 'not a database at all, but long enough to have a header of sorts .................');
    expect(dbUserVersion(f)).toBeNull();
  });
});

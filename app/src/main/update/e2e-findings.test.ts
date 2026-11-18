/**
 * **The E2E campaign's findings against ba45404** (2026-11-19, D-4 to D-9 and B3), as tests.
 * D-1 (repair in its own process) is proven by the release gate's repair step.
 */
import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { journalTarget, UpdateEngine, UPDATES_DIR } from './engine.js';
import { APP_ID, keyId, verifyManifest, type TrustedKey } from './manifest.js';
import { dmgVolumes, installSource, realTargetOf, swapArgs, swapPaths } from './plan.js';
import { events, mac, makeApp, privateKey, publish, tmp, world, type World } from './fixtures.test-support.js';

function republish(w: World, over: Record<string, unknown>): void {
  // A manifest-only edit of what is served: same payload, new levers and seq.
  const old = JSON.parse(w.served.get('https://example.test/study-manifest-v1.json')!.toString('utf8')) as Record<string, unknown>;
  const m = Buffer.from(JSON.stringify({ ...old, ...over }));
  w.served.set('https://example.test/study-manifest-v1.json', m);
  w.served.set('https://example.test/study-manifest-v1.json.sig', sign('sha256', m, privateKey));
}

describe('D-5: a hidden half-swap bundle is never the target', () => {
  it('maps the hidden bundles to the real one, and swapArgs refuses a hidden target', () => {
    expect(realTargetOf('/Applications/.ChatterED-replaced.app', 'ChatterED')).toBe('/Applications/ChatterED.app');
    expect(realTargetOf('/Applications/.ChatterED-incoming.app', 'ChatterED Test')).toBe('/Applications/ChatterED Test.app');
    expect(realTargetOf('/Applications/ChatterED.app', 'ChatterED')).toBeNull();
    expect(() =>
      swapArgs({ pid: 99999, target: '/Applications/.ChatterED-replaced.app', incoming: '/u/updates.noindex/staged/ChatterED.app', keep: '/u/updates.noindex/previous/ChatterED.app', keepOld: true, toBuild: 2, fromBuild: 1, mode: 'apply', allowDowngrade: false, relaunch: 'no', cdhash: null, updatesDir: '/u/updates.noindex', swapTool: null }),
    ).toThrow();
  });
  it('recovers the journal into its recorded target, whatever path this copy runs from', () => {
    expect(journalTarget('/Applications/ChatterED.app', '/Applications/.ChatterED-replaced.app', 'ChatterED')).toBe('/Applications/ChatterED.app');
    expect(journalTarget(undefined, '/Applications/.ChatterED-replaced.app', 'ChatterED')).toBe('/Applications/ChatterED.app');
    expect(journalTarget('/Applications/.ChatterED-replaced.app', '/Applications/ChatterED.app', 'ChatterED')).toBe('/Applications/ChatterED.app');
  });
});

describe('D-6: a manifest seq', () => {
  const { publicKey, privateKey: sk } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const keys: TrustedKey[] = [{ id: keyId(pem)!, role: 'active', pem }];
  it('is signed in and read (0 when absent)', () => {
    const base = { format: 'chattered-update', schema: 1, appId: APP_ID, arch: 'arm64', channel: 'study', build: 5, version: '0', url: 'https://x/y.zip', size: 1, sha256: 'a'.repeat(64) };
    const now = Math.floor(Date.now() / 1000); // what update-tool writes: the clock in seconds
    for (const [over, seq] of [[{}, 0], [{ seq: 9 }, 9], [{ seq: now }, now], [{ seq: now + 1 }, now + 1]] as const) {
      const b = Buffer.from(JSON.stringify({ ...base, ...over }));
      const r = verifyManifest(b, sign('sha256', b, sk), keys);
      expect(r.ok && r.manifest.seq).toBe(seq);
    }
  });
});

describe.runIf(mac)('D-6: a rollback published after staging wins; a replayed manifest is refused', () => {
  it('discards a staged build the newer manifest no longer offers, at the check and at launch', async () => {
    const w = world();
    publish(w, makeApp(tmp(), 501), { seq: 3 });
    expect(await w.engine.check('t')).toBe(true);
    // The owner pins the channel back to 500 (this build): the staged 501 must not be applied.
    republish(w, { seq: 4, build: 500, pin: true });
    await w.engine.check('t2');
    expect(w.engine.readStaged()).toBeNull();
    expect(events(w).some((e) => e.event === 'update.discarded' && e.why === 'superseded')).toBe(true);
    expect(new UpdateEngine(w.cfg).early().kind).toBe('continue');
  }, 60_000);

  it('at launch, re-checks a staged build against the newest stored manifest', async () => {
    const w = world();
    publish(w, makeApp(tmp(), 501), { seq: 3 });
    expect(await w.engine.check('t')).toBe(true);
    // A newer manifest that blocks 501 arrived and was stored, but the staged copy is still there.
    republish(w, { seq: 4, build: 502, blocked: [501] });
    const m = w.served.get('https://example.test/study-manifest-v1.json')!;
    const dir = join(w.userData, UPDATES_DIR);
    writeFileSync(join(dir, 'last-manifest.json'), m);
    writeFileSync(join(dir, 'last-manifest.json.sig'), w.served.get('https://example.test/study-manifest-v1.json.sig')!);
    expect(new UpdateEngine(w.cfg).early().kind).toBe('continue');
    expect(w.engine.readStaged()).toBeNull();
  }, 60_000);

  it('refuses a manifest with a lower seq than one already seen', async () => {
    const w = world();
    publish(w, makeApp(tmp(), 501), { seq: 5 });
    await w.engine.check('t');
    republish(w, { seq: 4 });
    expect(await w.engine.check('replay')).toBe(false);
    expect(events(w).filter((e) => e.event === 'update.check').pop()).toMatchObject({ result: 'stale_seq' });
  }, 60_000);
});

describe.runIf(mac)('D-7: the last-known-good build survives a rollback cycle', () => {
  it('a build healthy once stays known-good after its health record is reset', () => {
    const w = world();
    w.engine.early();
    w.engine.markHealthy();
    // A rollback cycle elsewhere resets the health record to another build.
    const other = new UpdateEngine({ ...w.cfg, currentBuild: 501 });
    other.early();
    const back = new UpdateEngine(w.cfg);
    back.early();
    expect(back.everHealthy()).toBe(true);
    expect(back.readLaunch().knownGood).toContain(500);
  });
});

describe.runIf(mac)('D-8, D-9: a rejected payload is not fetched again; failures retry sooner', () => {
  it('records a smoke-failed build and skips it at the next check', async () => {
    const w = world();
    publish(w, makeApp(tmp(), 501, { smoke: 'fail' }));
    expect(await w.engine.check('t')).toBe(false);
    expect(await w.engine.check('t2')).toBe(false);
    expect(events(w).filter((e) => e.event === 'update.downloaded')).toHaveLength(1);
    expect(events(w).filter((e) => e.event === 'update.check').pop()).toMatchObject({ result: 'rejected' });
  }, 60_000);

  it('backs off 15, 30, 60 … minutes after failures, capped at the normal interval', async () => {
    const w = world();
    const base = 4 * 3600_000;
    expect(w.engine.nextCheckMs(base)).toBe(base);
    await w.engine.check('offline');
    expect(w.engine.nextCheckMs(base)).toBe(15 * 60_000);
    await w.engine.check('offline');
    expect(w.engine.nextCheckMs(base)).toBe(30 * 60_000);
    for (let i = 0; i < 6; i += 1) await w.engine.check('offline');
    expect(w.engine.nextCheckMs(base)).toBe(base);
    publish(w, makeApp(tmp(), 500));
    await w.engine.check('back');
    expect(w.engine.nextCheckMs(base)).toBe(base);
  }, 60_000);

  it('removes the journal metadata after a swap that went well', () => {
    const w = world();
    const paths = swapPaths({ target: w.cfg.bundlePath, updatesDir: join(w.userData, UPDATES_DIR) });
    mkdirSync(join(w.userData, UPDATES_DIR), { recursive: true });
    writeFileSync(`${paths.journal}.json`, '{}');
    writeFileSync(paths.result, JSON.stringify({ mode: 'apply', status: 'ok', cause: '', from: 499, to: 500, via: 'swap', at: 't' }));
    w.engine.early();
    expect(existsSync(`${paths.journal}.json`)).toBe(false);
  });
});

describe('B3: installing from a translocated launch (after Open Anyway)', () => {
  const info = [
    '================================================',
    'image-path      : /Users/p/Downloads/ChatterED-Study-0.1.0-S01-arm64.dmg',
    '/dev/disk4          \tGUID_partition_scheme          \t',
    '/dev/disk4s1        \tApple_HFS                      \t/Volumes/ChatterED 0.1.0',
    '================================================',
    'image-path      : /Users/p/Downloads/Other.dmg',
    '/dev/disk5s1        \tApple_HFS                      \t/Volumes/Other',
  ].join('\n');

  it('finds the mounted disk images', () => {
    expect(dmgVolumes(info)).toEqual(['/Volumes/ChatterED 0.1.0', '/Volumes/Other']);
  });

  it('copies from the real DMG path, not the translocation mount, and ejects that volume', () => {
    const r = installSource({
      running: '/private/var/folders/x/T/AppTranslocation/ABCD/d/ChatterED.app',
      location: 'translocated',
      productName: 'ChatterED',
      volumes: dmgVolumes(info),
      matches: (p) => p === '/Volumes/ChatterED 0.1.0/ChatterED.app',
    });
    expect(r).toEqual({ source: '/Volumes/ChatterED 0.1.0/ChatterED.app', eject: '/Volumes/ChatterED 0.1.0' });
  });

  it('falls back to the running copy when no DMG matches, and ejects its own volume when run from one', () => {
    expect(
      installSource({ running: '/private/var/folders/x/T/AppTranslocation/ABCD/d/ChatterED.app', location: 'translocated', productName: 'ChatterED', volumes: ['/Volumes/Other'], matches: () => false }),
    ).toEqual({ source: '/private/var/folders/x/T/AppTranslocation/ABCD/d/ChatterED.app', eject: null });
    expect(installSource({ running: '/Volumes/ChatterED 0.1.0/ChatterED.app', location: 'dmg', productName: 'ChatterED', volumes: [], matches: () => false })).toEqual({
      source: '/Volumes/ChatterED 0.1.0/ChatterED.app',
      eject: '/Volumes/ChatterED 0.1.0',
    });
    expect(installSource({ running: '/Users/p/Downloads/ChatterED.app', location: 'ok', productName: 'ChatterED', volumes: [], matches: () => true })).toEqual({
      source: '/Users/p/Downloads/ChatterED.app',
      eject: null,
    });
  });
});


describe.runIf(mac)('E2E re-run item 2: one stager at a time', () => {
  it('stands aside while a live repair process or another stager is at work, and keeps their work folders', async () => {
    const { spawn } = await import('node:child_process');
    const other = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
    try {
      const w = world();
      publish(w, makeApp(tmp(), 501));
      const dir = join(w.userData, UPDATES_DIR);
      mkdirSync(join(dir, 'work-abc'), { recursive: true });
      writeFileSync(join(dir, 'repair.pid'), String(other.pid));
      new UpdateEngine(w.cfg).early();
      expect(existsSync(join(dir, 'work-abc'))).toBe(true);
      expect(await w.engine.check('t')).toBe(false);
      expect(events(w).filter((e) => e.event === 'update.check').pop()).toMatchObject({ result: 'busy_repair' });
      writeFileSync(join(dir, 'repair.pid'), '999999'); // a repair that is gone
      mkdirSync(join(dir, 'stage.lock'));
      writeFileSync(join(dir, 'stage.lock', 'pid'), String(other.pid));
      expect(await w.engine.check('t2')).toBe(false);
      expect(events(w).filter((e) => e.event === 'update.check').pop()).toMatchObject({ result: 'busy_staging' });
      writeFileSync(join(dir, 'stage.lock', 'pid'), '999999'); // a stager that died
      expect(await w.engine.check('t3')).toBe(true);
      expect(existsSync(join(dir, 'stage.lock'))).toBe(false);
    } finally {
      other.kill();
    }
  }, 60_000);
});

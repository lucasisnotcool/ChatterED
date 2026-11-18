/**
 * **The independent review's findings, as tests** (review of ba45404, 2026-11-19, R1–R7), and
 * the invariant they all come down to: **no state on disk can make every launch exit.** Each
 * test failed before its fix.
 */
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { UpdateEngine, UPDATES_DIR } from './engine.js';
import { APP_ID, keyId, verifyManifest, type TrustedKey } from './manifest.js';
import { SWAP_SCRIPT, swapArgs, swapPaths } from './plan.js';
import { events, mac, makeApp, publish, tmp, world, type World } from './fixtures.test-support.js';

function failResult(w: World, mode: 'apply' | 'rollback', from: number, to: number, cause = 'incoming_unsound') {
  const paths = swapPaths({ target: w.cfg.bundlePath, updatesDir: join(w.userData, UPDATES_DIR) });
  writeFileSync(paths.result, JSON.stringify({ mode, status: 'failed', cause, from, to, via: 'none', at: 't' }));
}

function launch(w: World): string {
  const r = new UpdateEngine(w.cfg).early();
  return r.kind === 'exit' ? r.why : 'continue';
}

/** The longest run of launches that exited before the app's code. */
function longestExitRun(seq: string[]): number {
  let run = 0;
  let best = 0;
  for (const s of seq) {
    run = s === 'continue' ? 0 : run + 1;
    best = Math.max(best, run);
  }
  return best;
}

describe.runIf(mac)('review R1–R3: a helper that keeps failing never keeps the app closed', () => {
  it('R1: a rollback whose helper fails is tried twice at most, then the app opens', () => {
    const w = world();
    makeApp(join(w.userData, UPDATES_DIR, 'previous'), 499);
    launch(w);
    launch(w);
    const out: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const r = launch(w);
      out.push(r);
      if (r === 'rolling_back') failResult(w, 'rollback', 500, 499);
    }
    expect(out.filter((x) => x === 'rolling_back').length).toBeLessThanOrEqual(2);
    expect(out.slice(-3)).toEqual(['continue', 'continue', 'continue']);
    expect(events(w).some((e) => e.event === 'update.gave_up' && e.mode === 'rollback')).toBe(true);
  });

  it('R2: a launch-path apply whose helper leaves no result.json is tried twice at most', async () => {
    const w = world();
    publish(w, makeApp(tmp(), 501));
    expect(await w.engine.check('t')).toBe(true);
    const out: string[] = [];
    for (let i = 0; i < 6; i += 1) out.push(launch(w));
    expect(out.filter((x) => x === 'applying').length).toBeLessThanOrEqual(2);
    expect(out.slice(-3)).toEqual(['continue', 'continue', 'continue']);
    // And the build is not fetched and staged again.
    expect(await w.engine.check('again')).toBe(false);
    expect(events(w).filter((e) => e.event === 'update.check').pop()).toMatchObject({ result: 'cannot_apply' });
  }, 60_000);

  it('R3: after app_management the build is recorded, never re-downloaded, and the participant is told once', async () => {
    const w = world();
    publish(w, makeApp(tmp(), 501));
    expect(await w.engine.check('t')).toBe(true);
    expect(launch(w)).toBe('applying');
    failResult(w, 'apply', 500, 501, 'app_management');
    expect(launch(w)).toBe('continue');
    expect(new UpdateEngine(w.cfg).manualInstallNotice()).toMatchObject({ build: 501, cause: 'app_management' });
    expect(await w.engine.check('t2')).toBe(false);
    expect(events(w).filter((e) => e.event === 'update.downloaded')).toHaveLength(1);
    expect(launch(w)).toBe('continue');
    // Told once: the notice is consumed.
    const e = new UpdateEngine(w.cfg);
    e.markManualInstallNoticeShown(501);
    expect(e.manualInstallNotice()).toBeNull();
    // A newer build is tried again.
    publish(w, makeApp(tmp(), 502), { build: 502 });
    expect(await w.engine.check('t3')).toBe(true);
  }, 120_000);
});

describe('review R5: a blocked per-install target does not strand that install', () => {
  it('ignores the target and uses the channel default', () => {
    const { publicKey: pk, privateKey: sk } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const p = pk.export({ type: 'spki', format: 'pem' }).toString();
    const keys: TrustedKey[] = [{ id: keyId(p)!, role: 'active', pem: p }];
    const body = Buffer.from(
      JSON.stringify({
        format: 'chattered-update',
        schema: 1,
        appId: APP_ID,
        arch: 'arm64',
        channel: 'study',
        build: 503,
        version: '0.1.0',
        url: 'https://x/y.zip',
        size: 10,
        sha256: 'a'.repeat(64),
        blocked: [501],
        targets: { install0001: { build: 501, url: 'https://x/z.zip', size: 10, sha256: 'b'.repeat(64), pin: true } },
      }),
    );
    const sig = sign('sha256', body, sk);
    const r = verifyManifest(body, sig, keys, { installId: 'install0001' });
    expect(r.ok && [r.manifest.build, r.manifest.targeted, r.manifest.pin]).toEqual([503, false, false]);
  });
});

describe.runIf(mac)('review R6, R7', () => {
  it('R6: an interrupted staging folder is swept at the next launch', () => {
    const w = world();
    const orphan = join(w.userData, UPDATES_DIR, 'work-deadbeef0000', 'x', 'ChatterED.app');
    mkdirSync(orphan, { recursive: true });
    writeFileSync(join(w.userData, UPDATES_DIR, 'work-deadbeef0000', 'payload.zip'), Buffer.alloc(1024));
    w.engine.early();
    expect(existsSync(join(w.userData, UPDATES_DIR, 'work-deadbeef0000'))).toBe(false);
  });

  it('R7: target == keep is refused by swapArgs and by the helper itself', () => {
    const root = tmp();
    const updates = join(root, 'updates.noindex');
    const target = join(updates, 'previous', 'ChatterED.app');
    const staged = join(updates, 'staged', 'ChatterED.app');
    const tools = join(root, 'tools');
    mkdirSync(tools);
    const mk = (p: string, b: number) => {
      mkdirSync(join(p, 'Contents'), { recursive: true });
      writeFileSync(join(p, 'Contents', 'Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleVersion</key><string>${b}</string></dict></plist>`);
    };
    mk(target, 500);
    mk(staged, 501);
    expect(() =>
      swapArgs({ pid: 99999, target, incoming: staged, keep: target, keepOld: true, toBuild: 501, fromBuild: 500, mode: 'apply', allowDowngrade: false, relaunch: 'no', cdhash: null, updatesDir: updates, swapTool: null }),
    ).toThrow();
    writeFileSync(join(tools, 'ok'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
    const script = join(tools, 'swap-helper.sh');
    writeFileSync(script, SWAP_SCRIPT, { mode: 0o700 });
    const dead = spawnSync('/usr/bin/true').pid!;
    const args = [String(dead), target, staged, target, '1', '501', '500', 'apply', '0', 'no', '-', join(updates, 'result.json'), join(updates, 'swap.lock'), '2', join(updates, '.in.app'), join(updates, '.aside.app'), join(updates, 'swap-journal'), '-'];
    spawnSync('/bin/bash', [script, ...args], {
      env: { PATH: '/usr/bin:/bin', CHATTERED_HELPER_CODESIGN: join(tools, 'ok'), CHATTERED_HELPER_XATTR: '/usr/bin/true', CHATTERED_HELPER_LSREGISTER: '/usr/bin/true', CHATTERED_HELPER_OPEN: '/usr/bin/true' },
    });
    const at = (p: string) => (existsSync(join(p, 'Contents', 'Info.plist')) ? readFileSync(join(p, 'Contents', 'Info.plist'), 'utf8').match(/<string>(\d+)/)?.[1] : 'missing');
    expect([at(target), at(staged)]).toEqual(['500', '501']);
    expect(JSON.parse(readFileSync(join(updates, 'result.json'), 'utf8'))).toMatchObject({ status: 'failed', cause: 'target_is_keep' });
  });
});

describe.runIf(mac)('the swap lock: only a live helper, and only for a while, holds the app closed', () => {
  const helpers: { kill(): void }[] = [];
  afterAll(() => helpers.forEach((h) => h.kill()));

  it('ignores and clears a lock whose PID is some other live process', () => {
    const w = world();
    const lock = swapPaths({ target: w.cfg.bundlePath, updatesDir: join(w.userData, UPDATES_DIR) }).lock;
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, 'pid'), String(process.pid)); // vitest: alive, but not a swap helper
    expect(launch(w)).toBe('continue');
    expect(existsSync(lock)).toBe(false);
  });

  it('waits for a real helper, but not for one older than ten minutes', () => {
    const w = world();
    const dir = tmp();
    const fake = join(dir, 'swap-helper.sh');
    writeFileSync(fake, '#!/bin/bash\nsleep 30\n', { mode: 0o755 });
    const child = spawn('/bin/bash', [fake], { stdio: 'ignore' });
    helpers.push(child);
    const lock = swapPaths({ target: w.cfg.bundlePath, updatesDir: join(w.userData, UPDATES_DIR) }).lock;
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, 'pid'), String(child.pid));
    expect(launch(w)).toBe('swap_in_progress');
    const old = new Date(Date.now() - 11 * 60_000);
    spawnSync('/usr/bin/touch', ['-t', `${old.getFullYear()}${String(old.getMonth() + 1).padStart(2, '0')}${String(old.getDate()).padStart(2, '0')}${String(old.getHours()).padStart(2, '0')}${String(old.getMinutes()).padStart(2, '0')}`, join(lock, 'pid')]);
    expect(launch(w)).toBe('continue');
  });
});

// ── the invariant ───────────────────────────────────────────────────────────

/** A small seeded PRNG, so a failing case can be replayed from its seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function fakeBundle(path: string, build: number | null): void {
  mkdirSync(join(path, 'Contents'), { recursive: true });
  if (build !== null) {
    writeFileSync(join(path, 'Contents', 'Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleVersion</key><string>${build}</string></dict></plist>`);
  }
}

describe.runIf(mac)('invariant: no state on disk makes every launch exit', () => {
  const CASES = 120;
  it(`holds for ${CASES} random states, whatever the helper does`, () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= CASES; seed += 1) {
      const r = rng(seed);
      const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
      const w = world({ spawnHelper: () => undefined });
      const upd = join(w.userData, UPDATES_DIR);
      mkdirSync(upd, { recursive: true });
      const paths = swapPaths({ target: w.cfg.bundlePath, updatesDir: upd });
      const junk = () => pick(['', '{', 'null', '[]', '"x"', '{"badBuilds":"no","launch":7}', '\u0000\u0001']);

      pick<() => void>([
        () => undefined,
        () => writeFileSync(join(upd, 'state.json'), junk()),
        () => writeFileSync(join(upd, 'state.json'), JSON.stringify({ badBuilds: [500, 501], applyFailures: 99, rotation: { add: ['x'], revoke: 5 } })),
      ])();
      pick<() => void>([
        () => undefined,
        () => writeFileSync(join(upd, 'launch.json'), junk()),
        () =>
          writeFileSync(
            join(upd, 'launch.json'),
            JSON.stringify({
              launch: { build: 500, healthy: false, clean: false },
              health: { build: 500, everHealthy: false, crashes: Math.floor(r() * 9) },
              pending: { build: pick([499, 500, 501]), mode: pick(['apply', 'rollback']), attempts: Math.floor(r() * 5) },
              lastResult: pick([null, { mode: 'rollback', status: 'failed' }, { mode: 'apply', status: 'ok' }]),
            }),
          ),
        () => writeFileSync(join(upd, 'launch.json'), JSON.stringify({ health: { build: 777, everHealthy: true, crashes: -3 }, launch: { build: 'x' } })),
      ])();
      pick<() => void>([
        () => undefined,
        () => {
          fakeBundle(join(upd, 'staged', 'ChatterED.app'), pick([499, 500, 501, 600, null]));
          writeFileSync(join(upd, 'staged', 'staged.json'), pick([junk(), JSON.stringify({ build: pick([499, 500, 501, 600]), cdhash: null, downgrade: r() < 0.5, stagedAt: 't' })]));
        },
        () => fakeBundle(join(upd, 'staged', 'ChatterED.app'), 501),
      ])();
      pick<() => void>([() => undefined, () => fakeBundle(join(upd, 'previous', 'ChatterED.app'), pick([499, 501, 500, null]))])();
      pick<() => void>([
        () => undefined,
        () => writeFileSync(paths.journal, pick(['aside /nowhere/ChatterED.app', 'swapped /x/.ChatterED-replaced.app', 'swap ' + join(upd, 'staged', 'ChatterED.app'), junk()])),
        () => {
          writeFileSync(paths.journal, 'swap /nope.app');
          writeFileSync(`${paths.journal}.json`, junk());
        },
      ])();
      pick<() => void>([
        () => undefined,
        () => {
          mkdirSync(paths.lock, { recursive: true });
          writeFileSync(join(paths.lock, 'pid'), pick([String(process.pid), '1', 'garbage', '999999', '']));
        },
        () => mkdirSync(paths.lock, { recursive: true }),
      ])();
      pick<() => void>([
        () => undefined,
        () => writeFileSync(paths.result, junk()),
        () => writeFileSync(paths.result, JSON.stringify({ mode: pick(['apply', 'rollback']), status: pick(['ok', 'failed', 'rolled_back']), cause: 'x', from: 500, to: pick([499, 501]), via: 'swap', at: 't' })),
      ])();
      const readOnly = r() < 0.15;
      if (readOnly) chmodSync(upd, 0o500);

      const seq: string[] = [];
      try {
        for (let i = 0; i < 8; i += 1) {
          const out = launch(w);
          seq.push(out);
          // Whatever the helper does: nothing at all, or a failure.
          if (out !== 'continue' && r() < 0.5 && !readOnly) {
            try {
              writeFileSync(paths.result, JSON.stringify({ mode: out === 'rolling_back' ? 'rollback' : 'apply', status: 'failed', cause: 'x', from: 500, to: 501, via: 'none', at: 't' }));
            } catch {
              /* a read-only folder */
            }
          }
        }
      } catch (err) {
        failures.push(`seed ${seed}: threw ${(err as Error).message}`);
      } finally {
        if (readOnly) chmodSync(upd, 0o700);
      }
      if (longestExitRun(seq) > 2 || seq.slice(-2).some((s) => s !== 'continue')) failures.push(`seed ${seed}: ${seq.join(',')}`);
      rmSync(w.userData, { recursive: true, force: true });
    }
    expect(failures).toEqual([]);
  }, 300_000);
});

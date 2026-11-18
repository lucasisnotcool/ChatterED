import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildNumber,
  bundleOfExecutable,
  classifyLocation,
  jitter,
  MAX_CRASHED_LAUNCHES,
  oldCopies,
  parseSwapResult,
  probationStep,
  recoverJournal,
  SWAP_SCRIPT,
  swapArgs,
  swapPaths,
  updaterMode,
  isAppMain,
  type SwapParams,
} from './plan.js';

describe('where a copy runs from', () => {
  const yes = () => true;
  it('classifies a DMG, translocation, an unwritable folder and a sound install', () => {
    expect(classifyLocation('/Volumes/ChatterED 0.1.0/ChatterED.app', yes)).toBe('dmg');
    expect(classifyLocation('/private/var/folders/x/T/AppTranslocation/ABC/d/ChatterED.app', yes)).toBe('translocated');
    expect(classifyLocation('/Applications/ChatterED.app', (p) => p !== '/Applications')).toBe('unwritable');
    expect(classifyLocation('/Applications/ChatterED.app', yes)).toBe('ok');
    expect(classifyLocation('relative/ChatterED.app', yes)).toBe('not_bundle');
    expect(classifyLocation('/usr/local/bin/electron', yes)).toBe('not_bundle');
  });
  it('finds the bundle of an executable, and reads build numbers', () => {
    expect(bundleOfExecutable('/Applications/ChatterED Test.app/Contents/MacOS/ChatterED Test')).toBe('/Applications/ChatterED Test.app');
    expect(bundleOfExecutable('/opt/node/bin/node')).toBeNull();
    expect(buildNumber('476')).toBe(476);
    expect(buildNumber('0.1.0')).toBe(0);
    expect(buildNumber(null)).toBe(0);
  });
});

describe('updaterMode', () => {
  const on = { platform: 'darwin', packaged: true, channel: 'study', hasPublicKey: true, envSwitch: undefined, disabledByFile: false };
  it('is on for a packaged channel build with keys', () => expect(updaterMode(on)).toEqual({ enabled: true }));
  it.each([
    [{ packaged: false }, 'dev'],
    [{ platform: 'linux' }, 'platform'],
    [{ channel: null }, 'no_channel'],
    [{ hasPublicKey: false }, 'no_key'],
    [{ envSwitch: 'off' }, 'env_off'],
    [{ disabledByFile: true }, 'config_off'],
  ])('is off for %o (%s)', (over, reason) => {
    expect(updaterMode({ ...on, ...over })).toEqual({ enabled: false, reason });
  });
});

describe('probation', () => {
  it('rolls a never-healthy build back after the crashed launches, not before', () => {
    let health = probationStep(null, null, 501, 500).health;
    expect(health).toEqual({ build: 501, everHealthy: false, crashes: 0 });
    let step = probationStep({ build: 501, healthy: false, clean: false }, health, 501, 500);
    expect(step.action).toBe('none');
    health = step.health;
    step = probationStep({ build: 501, healthy: false, clean: false }, health, 501, 500);
    expect(step).toEqual({ action: 'rollback', health: { build: 501, everHealthy: false, crashes: MAX_CRASHED_LAUNCHES }, bad: 501 });
  });
  it('does not count a clean quit or a healthy launch, and a healthy build is out of probation', () => {
    const h = { build: 501, everHealthy: false, crashes: 1 };
    expect(probationStep({ build: 501, healthy: false, clean: true }, h, 501, 500).action).toBe('none');
    expect(probationStep({ build: 501, healthy: true, clean: false }, h, 501, 500).action).toBe('none');
    const healthy = { build: 501, everHealthy: true, crashes: 5 };
    expect(probationStep({ build: 501, healthy: false, clean: false }, healthy, 501, 500).action).toBe('none');
  });
  it('has nothing to roll back to without a previous build', () => {
    const h = { build: 501, everHealthy: false, crashes: 5 };
    expect(probationStep({ build: 501, healthy: false, clean: false }, h, 501, null).action).toBe('none');
    expect(probationStep({ build: 501, healthy: false, clean: false }, h, 501, 501).action).toBe('none');
  });
});

describe('small rules', () => {
  it('jitters within the spread', () => {
    expect(jitter(100, 10, 0)).toBe(90);
    expect(jitter(100, 10, 0.5)).toBe(100);
  });
  it('lists old copies to trash, never the running one, the destination, DMGs, the Trash or staged copies', () => {
    const o = { running: '/Volumes/X/ChatterED.app', destination: '/Applications/ChatterED.app', home: '/Users/p', updatesDir: '/Users/p/Library/Application Support/ChatterED/updates.noindex' };
    expect(
      oldCopies(
        [
          '/Volumes/X/ChatterED.app',
          '/Applications/ChatterED.app',
          '/Users/p/Applications/ChatterED.app',
          '/Users/p/Downloads/ChatterED.app',
          '/Users/p/.Trash/ChatterED.app',
          '/Users/p/Library/Application Support/ChatterED/updates.noindex/previous/ChatterED.app',
          '/Users/p/Downloads/Other.app/Contents/ChatterED.app',
          '',
        ],
        o,
      ),
    ).toEqual(['/Users/p/Applications/ChatterED.app', '/Users/p/Downloads/ChatterED.app']);
  });
  it('reads a helper result and ignores junk', () => {
    expect(parseSwapResult('{"mode":"apply","status":"ok","cause":"","from":1,"to":2,"via":"swap","at":"t"}')).toMatchObject({ status: 'ok', via: 'swap', to: 2 });
    expect(parseSwapResult('nope')).toBeNull();
    expect(parseSwapResult('{"mode":"x","status":"ok"}')).toBeNull();
  });
});

const params = (over: Partial<SwapParams> = {}): SwapParams => ({
  pid: 99999,
  target: '/Applications/ChatterED.app',
  incoming: '/Users/p/Library/Application Support/ChatterED/updates.noindex/staged/ChatterED.app',
  keep: '/Users/p/Library/Application Support/ChatterED/updates.noindex/previous/ChatterED.app',
  keepOld: true,
  toBuild: 501,
  fromBuild: 500,
  mode: 'apply',
  allowDowngrade: false,
  relaunch: 'front',
  cdhash: null,
  updatesDir: '/Users/p/Library/Application Support/ChatterED/updates.noindex',
  swapTool: null,
  ...over,
});

describe('swapArgs', () => {
  it('passes every value as its own word, spaces and all', () => {
    const a = swapArgs(params());
    expect(a).toHaveLength(18);
    expect(a[2]).toContain('Application Support');
    expect(a[17]).toBe('-');
  });
  it('refuses paths that are not absolute bundles, a bad pid or cdhash', () => {
    expect(() => swapArgs(params({ target: '/' }))).toThrow();
    expect(() => swapArgs(params({ target: 'ChatterED.app' }))).toThrow();
    expect(() => swapArgs(params({ incoming: '/x/ChatterED.app\n/evil.app' }))).toThrow();
    expect(() => swapArgs(params({ pid: 1 }))).toThrow();
    expect(() => swapArgs(params({ cdhash: '$(rm -rf ~)' }))).toThrow();
  });
});

describe('recoverJournal', () => {
  function fakeFs(files: Record<string, number>) {
    const ops: string[] = [];
    return {
      ops,
      files,
      fs: {
        exists: (p: string) => p in files,
        rename: (a: string, b: string) => {
          ops.push(`mv ${a} ${b}`);
          files[b] = files[a]!;
          delete files[a];
        },
        remove: (p: string) => {
          if (p in files) ops.push(`rm ${p}`);
          delete files[p];
        },
        buildOf: (p: string) => files[p] ?? 0,
      },
    };
  }
  const p = { target: '/A/ChatterED.app', keep: '/U/previous/ChatterED.app', keepOld: true, aside: '/A/.ChatterED-replaced.app', near: '/A/.ChatterED-incoming.app', toBuild: 501 };

  it('finishes a swap that happened: the old build becomes N-1', () => {
    const f = fakeFs({ '/A/ChatterED.app': 501, '/U/staged/ChatterED.app': 500 });
    expect(recoverJournal('swap /U/staged/ChatterED.app', f.fs, p)).toBe('completed');
    expect(f.files).toEqual({ '/A/ChatterED.app': 501, '/U/previous/ChatterED.app': 500 });
  });
  it('leaves a swap that never happened', () => {
    const f = fakeFs({ '/A/ChatterED.app': 500, '/U/staged/ChatterED.app': 501 });
    expect(recoverJournal('swap /U/staged/ChatterED.app', f.fs, p)).toBe('untouched');
    expect(f.ops).toEqual([]);
  });
  it('puts the old bundle back when the target is missing between two renames', () => {
    const f = fakeFs({ '/A/.ChatterED-replaced.app': 500, '/U/staged/ChatterED.app': 501 });
    expect(recoverJournal('aside /U/staged/ChatterED.app', f.fs, p)).toBe('reverted');
    expect(f.files['/A/ChatterED.app']).toBe(500);
  });
  it('deletes the old one when it was never healthy, and ignores junk', () => {
    const f = fakeFs({ '/A/ChatterED.app': 501, '/A/.ChatterED-replaced.app': 500 });
    expect(recoverJournal('swapped /A/.ChatterED-replaced.app', f.fs, { ...p, keepOld: false })).toBe('completed');
    expect(f.files).toEqual({ '/A/ChatterED.app': 501 });
    expect(recoverJournal('garbage', f.fs, p)).toBe('none');
  });
});

// ── the helper itself, run for real (macOS: it needs plutil and bash) ─────────

const mac = process.platform === 'darwin' && existsSync('/usr/bin/plutil');
const roots: string[] = [];
afterAll(() => {
  for (const r of roots) {
    try {
      execFileSync('/bin/chmod', ['-R', 'u+w', r]);
    } catch {
      /* best effort */
    }
    rmSync(r, { recursive: true, force: true });
  }
});

function plist(build: number | string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleVersion</key><string>${build}</string></dict></plist>
`;
}

function fakeBundle(path: string, build: number, opts: { broken?: boolean; cdhash?: string } = {}): void {
  mkdirSync(join(path, 'Contents'), { recursive: true });
  writeFileSync(join(path, 'Contents', 'Info.plist'), plist(build));
  if (opts.broken) writeFileSync(join(path, 'Contents', 'BROKEN'), '');
  writeFileSync(join(path, 'Contents', 'cdhash'), opts.cdhash ?? 'c'.repeat(40));
}

function swapTool(dir: string): string | null {
  if (!existsSync('/usr/bin/clang')) return null;
  const out = join(dir, 'chattered-swap');
  try {
    execFileSync('/usr/bin/clang', ['-O2', '-o', out, join(__dirname, '..', '..', '..', 'build', 'swap-bundle.c')], { stdio: 'ignore' });
    return out;
  } catch {
    return null;
  }
}

/** A sandbox whose path has a space, quotes and a `$(…)` in it, with fake tools. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'chattered-swap-'));
  roots.push(root);
  const base = join(root, `Application Support`, `we'ird "dir" $(touch PWNED)`);
  const apps = join(base, 'Applications');
  const updates = join(base, 'updates.noindex');
  const tools = join(root, 'tools');
  for (const d of [apps, updates, tools]) mkdirSync(d, { recursive: true });
  const codesign = join(tools, 'codesign');
  // --verify fails on a bundle with Contents/BROKEN, or once FAIL_AFTER verifications have passed.
  writeFileSync(
    codesign,
    `#!/bin/bash
for last; do :; done
if [ "$1" = "-dv" ]; then echo "CDHash=$(cat "$last/Contents/cdhash")" >&2; exit 0; fi
n=$(cat "${tools}/count" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${tools}/count"
if [ -n "\${FAIL_AFTER:-}" ] && [ "$n" -gt "$FAIL_AFTER" ]; then exit 1; fi
[ -e "$last/Contents/BROKEN" ] && exit 1
exit 0
`,
    { mode: 0o755 },
  );
  const open = join(tools, 'open');
  writeFileSync(open, `#!/bin/bash\nprintf '%s\\n' "$*" >> "${tools}/opened"\n`, { mode: 0o755 });
  return { root, apps, updates, tools, target: join(apps, 'ChatterED.app'), staged: join(updates, 'staged', 'ChatterED.app'), keep: join(updates, 'previous', 'ChatterED.app') };
}

function run(s: ReturnType<typeof sandbox>, over: Partial<SwapParams>, env: Record<string, string> = {}) {
  const script = join(s.tools, 'helper.sh');
  writeFileSync(script, SWAP_SCRIPT, { mode: 0o700 });
  const dead = spawnSync('/usr/bin/true').pid!;
  const args = swapArgs(params({ pid: dead, target: s.target, incoming: s.staged, keep: s.keep, updatesDir: s.updates, waitSeconds: 2, ...over }));
  const r = spawnSync('/bin/bash', [script, ...args], {
    env: {
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      CHATTERED_HELPER_CODESIGN: join(s.tools, 'codesign'),
      CHATTERED_HELPER_OPEN: join(s.tools, 'open'),
      CHATTERED_HELPER_XATTR: '/usr/bin/true',
      CHATTERED_HELPER_LSREGISTER: '/usr/bin/true',
      CHATTERED_HELPER_VERIFY_SECS: '0',
      ...env,
    },
    encoding: 'utf8',
  });
  const resultFile = swapPaths({ target: s.target, updatesDir: s.updates }).result;
  return { code: r.status, result: existsSync(resultFile) ? parseSwapResult(readFileSync(resultFile, 'utf8')) : null };
}

const buildAt = (p: string) => buildNumber(execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', join(p, 'Contents', 'Info.plist')], { encoding: 'utf8' }));

function noPwned(root: string): boolean {
  const walk = (d: string): boolean => readdirSync(d, { withFileTypes: true }).every((e) => e.name !== 'PWNED' && (!e.isDirectory() || walk(join(d, e.name))));
  return walk(root) && !existsSync('PWNED');
}

describe.runIf(mac)('SWAP_SCRIPT, run for real', () => {
  it.each([['atomic swap', true], ['two renames', false]])('applies a staged build (%s), keeps the old one as N-1, relaunches', (_name, withTool) => {
    const s = sandbox();
    fakeBundle(s.target, 500);
    fakeBundle(s.staged, 501);
    const tool = withTool ? swapTool(s.tools) : null;
    if (withTool && !tool) return; // no clang here
    const { code, result } = run(s, { swapTool: tool });
    expect(code).toBe(0);
    expect(result).toMatchObject({ status: 'ok', via: withTool ? 'swap' : 'rename', from: 500, to: 501 });
    expect(buildAt(s.target)).toBe(501);
    expect(buildAt(s.keep)).toBe(500);
    expect(existsSync(s.staged)).toBe(false);
    expect(readFileSync(join(s.tools, 'opened'), 'utf8')).toContain(s.target);
    expect(existsSync(join(s.updates, 'swap-journal'))).toBe(false);
    expect(noPwned(s.root)).toBe(true);
  });

  it.each([['atomic swap', true], ['two renames', false]])('rolls back when the swapped-in bundle fails its check (%s)', (_name, withTool) => {
    const s = sandbox();
    fakeBundle(s.target, 500);
    fakeBundle(s.staged, 501);
    const tool = withTool ? swapTool(s.tools) : null;
    if (withTool && !tool) return;
    const { result } = run(s, { swapTool: tool }, { FAIL_AFTER: '1' });
    expect(result).toMatchObject({ status: 'rolled_back', cause: 'verify_after' });
    expect(buildAt(s.target)).toBe(500);
    // The app exited for this swap: it is reopened, failure or not (review #1).
    expect(readFileSync(join(s.tools, 'opened'), 'utf8')).toContain(s.target);
  });

  it('refuses an unsound staged build, a CDHash mismatch, and a build not newer than the installed one', () => {
    const s = sandbox();
    fakeBundle(s.target, 500);
    fakeBundle(s.staged, 501, { broken: true });
    expect(run(s, {}).result).toMatchObject({ status: 'failed', cause: 'incoming_unsound' });
    rmSync(s.staged, { recursive: true });
    fakeBundle(s.staged, 501);
    expect(run(s, { cdhash: 'd'.repeat(40) }).result).toMatchObject({ status: 'failed', cause: 'incoming_unsound' });
    rmSync(s.target, { recursive: true });
    fakeBundle(s.target, 600); // the participant installed a newer DMG meanwhile
    expect(run(s, {}).result).toMatchObject({ status: 'failed', cause: 'not_newer' });
    expect(buildAt(s.target)).toBe(600);
    expect(run(s, { allowDowngrade: true, relaunch: 'no' }).result).toMatchObject({ status: 'ok' });
    expect(buildAt(s.target)).toBe(501);
  });

  it('reports a refused rename as app_management and leaves the app as it was', () => {
    const s = sandbox();
    fakeBundle(s.target, 500);
    fakeBundle(s.staged, 501);
    chmodSync(s.apps, 0o555);
    try {
      const { result } = run(s, { swapTool: swapTool(s.tools) });
      expect(result).toMatchObject({ status: 'failed', cause: 'app_management' });
    } finally {
      chmodSync(s.apps, 0o755);
    }
    expect(buildAt(s.target)).toBe(500);
    expect(buildAt(s.staged)).toBe(501);
  });

  it('rolls back to the kept previous build and deletes the failing one', () => {
    const s = sandbox();
    fakeBundle(s.target, 501);
    fakeBundle(s.keep, 500);
    const { result } = run(s, { mode: 'rollback', incoming: s.keep, keepOld: false, toBuild: 500, fromBuild: 501, swapTool: swapTool(s.tools) });
    expect(result).toMatchObject({ status: 'ok', mode: 'rollback' });
    expect(buildAt(s.target)).toBe(500);
    expect(existsSync(s.keep)).toBe(false);
  });

  it('does nothing while another helper holds the lock, and takes over a lock that is not a helper’s', () => {
    const s = sandbox();
    fakeBundle(s.target, 500);
    fakeBundle(s.staged, 501);
    const lock = swapPaths({ target: s.target, updatesDir: s.updates }).lock;
    const fake = join(s.tools, 'swap-helper.sh');
    writeFileSync(fake, '#!/bin/bash\nsleep 20\n', { mode: 0o755 });
    const other = spawn('/bin/bash', [fake], { stdio: 'ignore' });
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, 'pid'), String(other.pid));
      const { code, result } = run(s, {});
      expect(code).toBe(0);
      expect(result).toBeNull();
      expect(buildAt(s.target)).toBe(500);
    } finally {
      other.kill();
    }
    // A live PID that is not a helper (this test runner) holds nothing.
    writeFileSync(join(lock, 'pid'), String(process.pid));
    expect(run(s, { relaunch: 'no' }).result).toMatchObject({ status: 'ok' });
    expect(buildAt(s.target)).toBe(501);
  });

  it('reopens the app after any failure once it has exited, and not when told not to', () => {
    const s = sandbox();
    fakeBundle(s.target, 600);
    fakeBundle(s.staged, 501);
    expect(run(s, {}).result).toMatchObject({ status: 'failed', cause: 'not_newer' });
    expect(readFileSync(join(s.tools, 'opened'), 'utf8')).toContain(s.target);
    rmSync(join(s.tools, 'opened'));
    expect(run(s, { relaunch: 'no' }).result).toMatchObject({ status: 'failed', cause: 'not_newer' });
    expect(existsSync(join(s.tools, 'opened'))).toBe(false);
  });
});

describe('the one-off install only quits the app itself', () => {
  it('recognises the app main process, not its helpers or anything else', () => {
    expect(isAppMain('/Applications/ChatterED.app/Contents/MacOS/ChatterED', 'ChatterED')).toBe(true);
    expect(isAppMain('/Applications/ChatterED.app/Contents/MacOS/ChatterED --user-data-dir=/x', 'ChatterED')).toBe(true);
    expect(isAppMain('/Applications/ChatterED.app/Contents/Frameworks/ChatterED Helper (Renderer).app/Contents/MacOS/ChatterED Helper (Renderer)', 'ChatterED')).toBe(false);
    expect(isAppMain('/Applications/Safari.app/Contents/MacOS/Safari', 'ChatterED')).toBe(false);
  });
});

describe.runIf(mac)('the reopen after a swap (E2E: open only activated a copy still running)', () => {
  function relaunchOf(s: ReturnType<typeof sandbox>) {
    return JSON.parse(readFileSync(join(s.updates, 'relaunch.json'), 'utf8')) as { ok: boolean; attempts: number; waited_ms: number };
  }

  it('waits until nothing runs from the bundle, opens it, and sees its main process come up', () => {
    const s = sandbox();
    fakeBundle(s.target, 500);
    fakeBundle(s.staged, 501);
    // The staged bundle has an executable; "open" starts it, as LaunchServices would.
    mkdirSync(join(s.staged, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(join(s.staged, 'Contents', 'MacOS', 'ChatterED'), '#!/bin/bash\nsleep 5\n', { mode: 0o755 });
    writeFileSync(join(s.tools, 'open'), `#!/bin/bash\nfor last; do :; done\nprintf '%s\\n' "$*" >> "${s.tools}/opened"\nnohup "$last/Contents/MacOS/ChatterED" >/dev/null 2>&1 &\n`, { mode: 0o755 });
    const { result } = run(s, {}, { CHATTERED_HELPER_VERIFY_SECS: '3' });
    expect(result).toMatchObject({ status: 'ok' });
    expect(relaunchOf(s)).toMatchObject({ ok: true, attempts: 1 });
    spawnSync('/usr/bin/pkill', ['-f', `${s.target}/Contents/MacOS/ChatterED`]);
  });

  it('opens again with -n when no main process appears, and says so', () => {
    const s = sandbox();
    fakeBundle(s.target, 500);
    fakeBundle(s.staged, 501);
    const { result } = run(s, {}, { CHATTERED_HELPER_VERIFY_SECS: '1' });
    expect(result).toMatchObject({ status: 'ok' });
    expect(relaunchOf(s)).toMatchObject({ ok: false, attempts: 2 });
    const opened = readFileSync(join(s.tools, 'opened'), 'utf8').trim().split('\n');
    expect(opened).toHaveLength(2);
    expect(opened[1]).toContain('-n');
  });
});

/**
 * **The one-off install from the DMG**: the participants' current copies have no updater, so the
 * new DMG has to replace them once. Runs from the bootstrap **before the single-instance lock**: an
 * old copy that is still running holds the lock, and without this the new copy would hand over to
 * it and quit, leaving the participant on the old build with no sign anything went wrong.
 *
 * When this copy is not in an Applications folder (a mounted DMG, App Translocation, Downloads):
 *
 *  1. Translocated, with the same build already in /Applications: that copy is the one to run.
 *     Strip its quarantine (so it is not translocated again) and open it.
 *  2. Otherwise one dialog: "Install ChatterED into Applications?", naming what it replaces, with a
 *     checkbox to move other old copies to the Trash (never deleted outright).
 *  3. A running old copy is asked to quit: SIGTERM to the PID in `<userData>/SingletonLock`, which
 *     Electron handles as an ordinary quit. If it does not quit in 15 s, one dialog says how.
 *  4. Our own install (`installOwn`): `ditto --noqtn` the bundle (from the real DMG path when
 *     translocated) to a hidden sibling in /Applications, verify it, swap it with the old copy in
 *     one step (`chattered-swap`), then trash the old one. Only if that fails,
 *     `app.moveToApplicationsFolder`, which trashes the old copy before copying. A throw (App
 *     Management, a non-admin account) shows the manual steps. Other old copies are named in the
 *     dialog, never touched.
 *  5. The relaunched copy finishes (`finishSelfInstall`): `install.oneoff` is logged first, then
 *     quarantine is stripped and the disk image it came from is detached.
 *
 * Electron 44's mover targets /Applications only (checked in the framework binary), so this path is
 * verified by its decision functions in tests and by hand (app/docs/STUDY-RELEASE.md).
 */
import { app, dialog, shell } from 'electron';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { plistValue, UPDATES_DIR } from './engine.js';
import { buildNumber, dmgVolumes, installSource, isAppMain, oldCopies, RELAUNCH_SCRIPT, type LocationKind } from './plan.js';

const execFileP = promisify(execFile);

export interface SelfInstallCtx {
  bundle: string;
  appId: string;
  productName: string;
  userData: string;
  home: string;
  build: number;
  location: LocationKind;
  log(level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>): void;
}

const PENDING = 'selfinstall.json';
const APP_MANAGEMENT_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles';

/**
 * The PID in Electron's `SingletonLock` symlink (`<host>-<pid>`), only if the lock is this Mac's
 * and that PID really is this app's main process (review #9): a stale lock whose PID now belongs
 * to the participant's browser must never be sent SIGTERM.
 */
export function lockHolder(userData: string, productName: string): number | null {
  try {
    const target = readlinkSync(join(userData, 'SingletonLock'));
    const m = /^(.*)-(\d+)$/.exec(target);
    if (!m || m[1] !== hostname()) return null;
    const pid = Number(m[2]);
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return null;
    process.kill(pid, 0);
    const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    return isAppMain(command, productName) ? pid : null;
  } catch {
    return null;
  }
}

export { isAppMain };

async function waitGone(pid: number, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function manualSteps(name: string): string {
  return (
    `1. Quit ${name} (${name} ▸ Quit, or ⌘Q).\n` +
    `2. In the ${name} disk image window, drag ${name} onto Applications and choose Replace.\n` +
    `3. Open ${name} from Applications.\n\n` +
    'Your notes, progress and study credit are kept.'
  );
}

/** Other copies of this app, from Spotlight plus ~/Applications. */
export function findOldCopies(c: SelfInstallCtx, destination: string): string[] {
  let hits: string[] = [];
  try {
    hits = execFileSync('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == '${c.appId}'`], {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\n');
  } catch {
    hits = [];
  }
  const userApps = join(c.home, 'Applications', `${c.productName}.app`);
  if (existsSync(userApps)) hits.push(userApps);
  return oldCopies(hits, { running: c.bundle, destination, home: c.home, updatesDir: join(c.userData, UPDATES_DIR) }).filter(
    (p) => plistValue(p, 'CFBundleIdentifier') === c.appId,
  );
}

export async function maybeSelfInstall(c: SelfInstallCtx): Promise<'quitting' | 'continue'> {
  const name = c.productName;
  const destination = `/Applications/${name}.app`;
  c.log('info', 'selfinstall.offered', { location: c.location, build: c.build });

  // 1. Translocated, and this very build is already in Applications: run that one.
  if (c.location === 'translocated' && existsSync(destination) && buildNumber(plistValue(destination, 'CFBundleVersion')) === c.build) {
    try {
      execFileSync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', destination], { stdio: 'ignore', timeout: 30_000 });
    } catch {
      /* exits 1 on some systems when there is nothing to remove */
    }
    c.log('info', 'selfinstall.untranslocate', { build: c.build });
    execFile('/usr/bin/open', ['-n', destination], () => undefined);
    app.quit();
    return 'quitting';
  }

  const replaces = existsSync(destination) ? buildNumber(plistValue(destination, 'CFBundleVersion')) : null;
  const others = findOldCopies(c, destination);
  const running = lockHolder(c.userData, c.productName);
  // Other old copies are only named, never touched: trashing one in Downloads needs folder access
  // a fresh install does not have, and it is not worth a prompt (E2E D-4).
  const detail = [
    replaces !== null ? `This replaces the older copy in Applications.` : `This puts ${name} in your Applications folder.`,
    running ? `The ${name} that is open now will be closed first.` : '',
    'Your notes, progress and study credit are kept.',
    others.length ? `\n\nThere is also an older copy at ${others.map((p) => p.split(c.home).join('~')).join(', ')}; you can move it to the Trash.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const { response } = await dialog.showMessageBox({
    type: 'question',
    message: `Install ${name} into Applications?`,
    detail,
    buttons: ['Install', 'Not now'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) {
    c.log('info', 'selfinstall.declined', {});
    return 'continue';
  }

  // 3. The old copy holds the lock: ask it to quit, the way the Dock's Quit would.
  if (running) {
    try {
      process.kill(running, 'SIGTERM');
    } catch {
      /* gone already */
    }
    const gone = await waitGone(running, 15_000);
    c.log(gone ? 'info' : 'warn', 'selfinstall.quit_old', { gone });
    if (!gone) {
      await dialog.showMessageBox({
        type: 'warning',
        message: `Quit the open ${name} first`,
        detail: `Click ${name} in the Dock, press ⌘Q, then open this ${name} again.`,
        buttons: ['OK'],
      });
      app.quit();
      return 'quitting';
    }
  }

  // Where to copy from (the real DMG path when translocated) and which disk image to eject.
  let volumes: string[] = [];
  try {
    volumes = dmgVolumes((await execFileP('/usr/bin/hdiutil', ['info'], { timeout: 15_000 })).stdout);
  } catch {
    volumes = [];
  }
  const { source, eject } = installSource({
    running: c.bundle,
    location: c.location,
    productName: name,
    volumes,
    matches: (p) => existsSync(p) && plistValue(p, 'CFBundleIdentifier') === c.appId && buildNumber(plistValue(p, 'CFBundleVersion')) === c.build,
  });

  const pendingDir = join(c.userData, UPDATES_DIR);
  try {
    mkdirSync(pendingDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(pendingDir, PENDING), JSON.stringify({ at: new Date().toISOString(), from: replaces, to: c.build, location: c.location, eject }), { mode: 0o600 });
  } catch {
    /* install.oneoff will not be logged; the install still works */
  }

  // Our own install first: never a moment without the old copy, and nothing in the Trash until the
  // new one is in place (Electron's mover trashes the old copy before it copies; E2E D-4).
  const own = await installOwn(c, source, destination);
  if (own.ok) {
    c.log('info', 'selfinstall.installed', { from: replaces, to: c.build, via: own.via });
    // Reopen from Applications once this process has exited (positional args: no interpolation).
    spawn('/bin/bash', ['-c', RELAUNCH_SCRIPT, 'relaunch', String(process.pid), '', destination], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
    return 'quitting';
  }
  c.log('warn', 'selfinstall.own_failed', { cause: own.cause });

  let cause = '';
  let moved = false;
  try {
    moved = app.moveToApplicationsFolder({ conflictHandler: (kind) => kind === 'exists' });
  } catch (err) {
    cause = err instanceof Error ? err.message : String(err);
  }
  if (moved) {
    c.log('info', 'selfinstall.moved', { from: replaces, to: c.build });
    return 'quitting';
  }
  rmSync(join(pendingDir, PENDING), { force: true });
  const blocked = /not permitted|denied|Failed to delete/i.test(cause);
  c.log('error', 'selfinstall.failed', { cause: blocked ? 'app_management' : cause.slice(0, 120) || 'declined' });
  const { response: r2 } = await dialog.showMessageBox({
    type: 'warning',
    message: `${name} could not install itself`,
    detail: blocked
      ? `macOS stopped ${name} from replacing the old copy. You can allow it in System Settings ▸ Privacy & Security ▸ App Management, or do it by hand:\n\n${manualSteps(name)}`
      : manualSteps(name),
    buttons: blocked ? ['OK', 'Open App Management'] : ['OK'],
  });
  if (blocked && r2 === 1) void shell.openExternal(APP_MANAGEMENT_URL);
  return 'continue';
}

/**
 * Copy `source` to a hidden sibling in /Applications (`ditto --noqtn`: no quarantine), verify it,
 * then swap it with the old copy in one step (`chattered-swap`, renamex_np) or rename it in if there
 * is none; the old copy goes to the Trash only after. Any failure leaves the old copy as it was.
 */
async function installOwn(c: SelfInstallCtx, source: string, destination: string): Promise<{ ok: true; via: string } | { ok: false; cause: string }> {
  const tmp = `/Applications/.${c.productName}-installing.app`;
  try {
    rmSync(tmp, { recursive: true, force: true });
    await execFileP('/usr/bin/ditto', ['--noqtn', source, tmp], { timeout: 10 * 60_000 });
    await execFileP('/usr/bin/codesign', ['--verify', '--deep', '--strict', tmp], { timeout: 5 * 60_000 });
    if (buildNumber(plistValue(tmp, 'CFBundleVersion')) !== c.build) throw new Error('copy_build');
    let via = 'rename';
    if (existsSync(destination)) {
      const tool = join(process.resourcesPath, 'chattered-swap');
      if (!existsSync(tool)) throw new Error('no_swap_tool');
      await execFileP(tool, [tmp, destination], { timeout: 60_000 });
      via = 'swap';
      // `tmp` now holds the old copy.
      try {
        await shell.trashItem(tmp);
      } catch {
        rmSync(tmp, { recursive: true, force: true });
      }
    } else {
      renameSync(tmp, destination);
    }
    try {
      execFileSync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', destination], { stdio: 'ignore', timeout: 30_000 });
    } catch {
      /* nothing to strip */
    }
    return { ok: true, via };
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    const m = err instanceof Error ? err.message : String(err);
    return { ok: false, cause: /not permitted|denied/i.test(m) ? 'app_management' : m.slice(0, 120) };
  }
}

/** On the first launch from Applications after a self-install: log, strip, detach. */
export async function finishSelfInstall(c: SelfInstallCtx): Promise<void> {
  const file = join(c.userData, UPDATES_DIR, PENDING);
  if (!existsSync(file)) return;
  let p: { at?: string; from?: number | null; to?: number; eject?: string | null } = {};
  try {
    p = JSON.parse(readFileSync(file, 'utf8')) as typeof p;
  } catch {
    p = {};
  }
  rmSync(file, { force: true });
  if (!p.at || Date.now() - Date.parse(p.at) > 24 * 3600_000) return;
  // First, so it is logged however the rest goes (E2E D-4: it was missing when the old copy had quit).
  c.log('info', 'install.oneoff', { from: typeof p.from === 'number' ? p.from : null, to: c.build });
  try {
    execFileSync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', c.bundle], { stdio: 'ignore', timeout: 30_000 });
  } catch {
    /* nothing to strip */
  }
  // The disk image it came from, and any other ChatterED one still mounted.
  let detached = 0;
  try {
    const vols = new Set(dmgVolumes((await execFileP('/usr/bin/hdiutil', ['info'], { timeout: 15_000 })).stdout));
    if (typeof p.eject === 'string') vols.add(p.eject);
    for (const vol of vols) {
      const inside = join(vol, `${c.productName}.app`);
      if (existsSync(inside) && plistValue(inside, 'CFBundleIdentifier') === c.appId) {
        try {
          await execFileP('/usr/bin/hdiutil', ['detach', vol], { timeout: 30_000 });
          detached += 1;
        } catch {
          /* in use; the participant can eject it */
        }
      }
    }
  } catch {
    /* no hdiutil info */
  }
  c.log('info', 'selfinstall.finished', { detached });
}

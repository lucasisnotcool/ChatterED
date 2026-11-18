/**
 * **Stage 0: the app's real entry point** (`package.json` `main`). It imports Electron, Node's
 * built-ins and `./update/*` only, and nothing else of the app's, so it runs whatever a future
 * build breaks in `index.ts`, the database, the renderer or a native module. Keep it small and
 * leave it alone during the study (`update.contract.test.ts` holds it to its imports).
 *
 * Every launch, in order:
 *  1. **Smoke mode** (`--chattered-smoke=<ok file>`): this is a staged build being tried by the
 *     running one. Copy the real database (`VACUUM INTO`, read-only), force the scripted backend
 *     on the copy, load the app with a hidden window, and write the ok file when the renderer is up.
 *  2. **One-off install** when not in an Applications folder (`selfinstall.ts`), before the lock.
 *  3. The single-instance lock.
 *  4. **The engine's launch work** (`engine.early`): log the last swap, finish a half-done one, swap
 *     in a staged update now (exit, the helper reopens), or roll back a build that keeps failing.
 *  5. The updater's utilityProcess (checks every ~4 h and on wake), the idle/locked relaunch, the
 *     finish of a self-install.
 *  6. `import('./index.js')`, in try/catch. A throw there, or `failBoot`, is **repair mode**.
 */
import { app, BrowserWindow, clipboard, dialog, powerMonitor, shell, utilityProcess, type UtilityProcess } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { accessSync, constants as fsConstants, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readBaked } from './update/baked.js';
import { appendLog, plistValue, UpdateEngine, type EngineConfig } from './update/engine.js';
import { debugReport, startupFailed } from './update/failure.js';
import { trustedKeys, verifyManifest } from './update/manifest.js';
import { ensureInstallId } from './update/installid.js';
import { buildNumber, bundleOfExecutable, classifyLocation, IDLE_RELAUNCH_SECONDS, MAX_CRASHED_LAUNCHES, realTargetOf, RELAUNCH_SCRIPT, updaterMode } from './update/plan.js';
import { faultActive, isBusy, runtime, setRuntime, type UpdateRuntime } from './update/runtime.js';
import { finishSelfInstall, maybeSelfInstall } from './update/selfinstall.js';

const baked = readBaked(join(__dirname, 'update'));

function arg(prefix: string): string | null {
  const a = process.argv.find((x) => x.startsWith(prefix));
  return a ? a.slice(prefix.length) : null;
}

function writable(p: string): boolean {
  try {
    accessSync(p, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const smokeOk = arg('--chattered-smoke=');
if (smokeOk) app.setAppLogsPath(join(app.getPath('userData'), 'logs'));

const bundle = app.isPackaged ? bundleOfExecutable(app.getPath('exe')) : null;
/** CFBundleVersion: what the helper checks. A non-number (an old `0.1.0` build) is build 0. */
const build = bundle ? buildNumber(plistValue(bundle, 'CFBundleVersion')) : baked.build;
const userData = app.getPath('userData');
const logFile = join((() => {
  try {
    return app.getPath('logs');
  } catch {
    return join(homedir(), 'Library', 'Logs', baked.productName);
  }
})(), 'main.log');
const logBase = { v: app.getVersion(), build, sha: baked.sha, packaged: app.isPackaged };
/**
 * Test variant only: a fault from Info.plist (`ChatterEDTestFault`) beats the compiled one, so the
 * gate and the E2E campaign can make a bad N+1 by re-stamping a copy instead of rebuilding.
 */
const FAULTS = ['crash-at-launch', 'crash-at-launch-live', 'fail-migration', 'fail-migration-live', 'hang-boot', 'hang-boot-live', 'never-healthy-live'];
const plistFault = baked.test && bundle ? plistValue(bundle, 'ChatterEDTestFault') : null;
const fault = baked.test ? ((plistFault && FAULTS.includes(plistFault) ? plistFault : baked.fault) as UpdateRuntime['fault']) : null;
const log = (level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}) =>
  appendLog(logFile, logBase, level, event, fields);

function baseRuntime(over: Partial<UpdateRuntime>): UpdateRuntime {
  return {
    build,
    sha: baked.sha,
    channel: baked.channel,
    disabledReason: null,
    smoke: false,
    fault,
    takeNote: () => null,
    rendererReady: () => undefined,
    repair: () => 'none',
    debugInfo: () => ({ build, sha: baked.sha, channel: baked.channel }),
    bootstrapReport: (error) =>
      [
        `${baked.productName} startup report (bootstrap only)`,
        `build: ${build}  sha: ${baked.sha}  version: ${app.getVersion()}  variant: ${baked.variant}`,
        `macOS: ${process.getSystemVersion()}  arch: ${process.arch}`,
        `bundle: ${(bundle ?? app.getPath('exe')).split(homedir()).join('~')}`,
        `userData: ${userData.split(homedir()).join('~')}`,
        `error: ${error.split(homedir()).join('~')}`,
        `update: ${JSON.stringify(runtime().debugInfo())}`,
      ].join('\n') + '\n',
    ...over,
  };
}

// ── 1. smoke mode ─────────────────────────────────────────────────────────

function runSmoke(okFile: string): void {
  const write = (ok: boolean, stage: string) => {
    try {
      writeFileSync(okFile, JSON.stringify({ ok, stage, build }));
    } catch {
      /* the parent then sees no ok file, which is a failure */
    }
  };
  setRuntime(
    baseRuntime({
      smoke: true,
      rendererReady: () => {
        write(true, 'ready');
        app.exit(0);
      },
      repair: () => {
        write(false, 'boot');
        app.exit(1);
        return 'exiting';
      },
    }),
  );
  // A simulated crash: exit before anything is marked, without the crash reporter's dialog.
  if (faultActive('crash-at-launch')) process.exit(70);
  setTimeout(() => {
    write(false, 'timeout');
    app.exit(3);
  }, 120_000).unref();
  // This build's own updater, against the manifest that brought it (review #6): its keys verify
  // it, it is on that channel, it would look for updates, and it can swap. A build that boots but
  // could never update itself again is refused here, before it is ever installed.
  const problem = smokeUpdaterProblem(arg('--chattered-smoke-manifest='));
  if (problem) {
    write(false, `updater:${problem}`);
    app.exit(1);
    return;
  }
  const db = arg('--chattered-smoke-db=');
  if (db && existsSync(db)) {
    try {
      // The native module this build ships, loaded the way the app loads it.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require('better-sqlite3') as new (f: string, o?: object) => {
        exec(sql: string): void;
        prepare(sql: string): { run(...a: unknown[]): void };
        close(): void;
      };
      const copy = join(userData, 'app.db');
      const src = new Database(db, { readonly: true, fileMustExist: true });
      src.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
      src.close();
      // The copy must never reach a real model: no key file is copied, and the backend is scripted.
      const dst = new Database(copy);
      dst.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('llm_backend', 'scripted', ?)`).run(new Date().toISOString());
      dst.close();
    } catch {
      write(false, 'db_copy');
      app.exit(1);
      return;
    }
  }
  void app.whenReady().then(() => app.dock?.hide());
  import('./index.js').catch(() => {
    write(false, 'import');
    app.exit(1);
  });
}

function smokeUpdaterProblem(manifestFile: string | null): string | null {
  if (!manifestFile) return null; // an older parent passes none
  try {
    const bytes = readFileSync(manifestFile);
    const sig = readFileSync(`${manifestFile}.sig`);
    let rotation = { add: [] as string[], revoke: [] as string[] };
    try {
      const r = JSON.parse(readFileSync(join(manifestFile, '..', 'rotation.json'), 'utf8')) as typeof rotation;
      rotation = { add: Array.isArray(r.add) ? r.add : [], revoke: Array.isArray(r.revoke) ? r.revoke : [] };
    } catch {
      /* no rotation */
    }
    const v = verifyManifest(bytes, sig, trustedKeys(baked.keys, rotation), { allowHttp: baked.test });
    if (!v.ok) return `manifest_${v.reason}`;
    if (v.manifest.channel !== baked.channel) return 'channel';
    if (v.manifest.appId !== baked.appId) return 'app_id';
    const mode = updaterMode({
      platform: process.platform,
      packaged: app.isPackaged,
      channel: baked.channel,
      hasPublicKey: baked.keys.length > 0,
      envSwitch: undefined,
      disabledByFile: false,
    });
    if (!mode.enabled) return `mode_${mode.reason}`;
    if (!existsSync(join(process.resourcesPath, 'chattered-swap'))) return 'no_swap_tool';
    return null;
  } catch (err) {
    return `check_${(err as Error).message.slice(0, 40)}`;
  }
}

/** The engine's settings for this build: the same in the app, its worker and repair mode. */
function engineConfig(bundlePath: string, installId: string | null, role: 'main' | 'worker', pid: number): EngineConfig {
  const helperEnv: Record<string, string> = {};
  if (baked.test) for (const [k, v] of Object.entries(process.env)) if (k.startsWith('CHATTERED_HELPER_') && v) helperEnv[k] = v;
  return {
    bundlePath,
    appId: baked.appId,
    productName: baked.productName,
    swapTool: join(process.resourcesPath, 'chattered-swap'),
    installId,
    role,
    userDataDir: userData,
    currentBuild: build,
    sha: baked.sha,
    channel: baked.channel!,
    keys: baked.keys,
    manifestUrls: baked.manifestUrls,
    allowHttp: baked.test,
    osVersion: process.getSystemVersion(),
    logFile,
    logBase,
    pid,
    helperEnv,
    ...(baked.test && process.env.CHATTERED_TEST_FIRST_CHECK_MS ? { firstCheckMs: Number(process.env.CHATTERED_TEST_FIRST_CHECK_MS) || undefined } : {}),
  };
}

/**
 * **Repair mode's search, in its own process** (`--chattered-repair=<app pid>`, started by the app
 * whose boot failed). No window, no Dock icon, no lock, none of the app's code. Checks now; if a fix
 * is staged, hands it to the helper (which waits for the app to exit), then ends the failed app:
 * SIGTERM, then SIGKILL, since its startup-failure dialog may be up. Gives up after 20 minutes.
 */
function runRepair(appPid: number): void {
  void app.whenReady().then(() => app.dock?.hide());
  setTimeout(() => app.exit(0), 21 * 60_000).unref();
  const mode = updaterMode({
    platform: process.platform,
    packaged: app.isPackaged,
    channel: baked.channel,
    hasPublicKey: baked.keys.length > 0,
    envSwitch: process.env.CHATTERED_UPDATES,
    disabledByFile: existsSync(join(userData, 'updates-disabled')),
  });
  if (!mode.enabled || !bundle || !Number.isInteger(appPid) || appPid <= 1) {
    app.exit(0);
    return;
  }
  const engine = new UpdateEngine(engineConfig(bundle, ensureInstallId(userData), 'worker', appPid));
  // The app's worker stands aside while this file names a live repair (`engine.check`).
  const pidFile = join(engine.dir, 'repair.pid');
  try {
    writeFileSync(pidFile, String(process.pid), { mode: 0o600 });
  } catch {
    /* the worker may check at the same time; the staging lock still keeps them apart */
  }
  const done = (code: number) => {
    try {
      rmSync(pidFile, { force: true });
    } catch {
      /* gone */
    }
    app.exit(code);
  };
  const appAlive = () => {
    try {
      process.kill(appPid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const until = Date.now() + 20 * 60_000;
  // Check now, then every ~60 s while the failed app's dialog is up, so a fix published meanwhile
  // still arrives (E2E item 3). If the participant quit, a staged fix waits for the next launch.
  const attempt = async (): Promise<void> => {
    const staged = await engine.check('repair');
    if (staged && !appAlive()) {
      engine.log('info', 'update.repair_staged', { to: engine.readStaged()?.build ?? null });
      done(0);
      return;
    }
    if (staged && engine.spawnSwap({ mode: 'apply', relaunch: 'front' })) {
      engine.log('info', 'update.repair_swap', { to: engine.readStaged()?.build ?? null });
      try {
        process.kill(appPid, 'SIGTERM');
      } catch {
        /* already gone */
      }
      // This process runs from the bundle being swapped: it must be gone before the helper reopens
      // it (`open` would only activate it). The SIGKILL fallback lives in its own detached shell.
      spawn('/bin/sh', ['-c', 'sleep 8; kill -9 "$1" 2>/dev/null', 'sh', String(appPid)], { detached: true, stdio: 'ignore' }).unref();
      done(0);
      return;
    }
    if (Date.now() + 60_000 > until || !appAlive()) {
      engine.log('info', 'update.repair_none', { app_alive: appAlive() });
      done(0);
      return;
    }
    setTimeout(() => void attempt().catch(() => done(0)), 60_000);
  };
  void attempt().catch(() => done(0));
}

/** A repair process is at work (its pid file names a live process). */
function repairRunning(): boolean {
  try {
    const pid = Number(readFileSync(join(userData, 'updates.noindex', 'repair.pid'), 'utf8').trim());
    if (!Number.isInteger(pid) || pid <= 1) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ── 2-6. an ordinary launch ─────────────────────────────────────────────────

async function start(): Promise<void> {
  // A modal dialog (the startup failure, the update notice) must never keep the app from quitting
  // when the system, the repair process or a helper asks it to (E2E item 4).
  for (const sig of ['SIGTERM', 'SIGHUP'] as const) process.on(sig, () => app.exit(0));
  const location = bundle ? classifyLocation(bundle, writable) : 'not_bundle';

  // 1a. A copy running from a hidden half-swap bundle (`.ChatterED-replaced.app`: a helper was
  // killed between its two renames). Put it back under the app's name first, then open that (D-5).
  const realTarget = bundle ? realTargetOf(bundle, baked.productName) : null;
  if (bundle && realTarget) {
    // Renaming the bundle this process runs from crashes it on the way out (E2E: EXC_BREAKPOINT
    // and a "quit unexpectedly" dialog), so the move and the reopen happen once it has exited.
    log('warn', 'update.hidden_bundle', { target_exists: existsSync(realTarget) });
    spawn('/bin/bash', ['-c', RELAUNCH_SCRIPT, 'relaunch', String(process.pid), bundle, realTarget], { detached: true, stdio: 'ignore' }).unref();
    process.exit(0);
  }

  // 1b. A copy inside userData (the kept N-1 or a staged build, opened from a stale Dock or Finder
  // reference) is never the app: open the installed one and quit (review #10).
  if (bundle && (bundle === userData || bundle.startsWith(`${userData}/`))) {
    const installed = `/Applications/${baked.productName}.app`;
    log('warn', 'update.handover', { from: 'userdata', installed: existsSync(installed) });
    if (existsSync(installed)) {
      execFile('/usr/bin/open', [installed], () => undefined);
      app.quit();
      return;
    }
  }

  // 2. The one-off install, before the lock an old running copy holds.
  if (bundle && process.platform === 'darwin' && !app.isInApplicationsFolder()) {
    await app.whenReady();
    const ctx = { bundle, appId: baked.appId, productName: baked.productName, userData, home: homedir(), build, location, log };
    try {
      if ((await maybeSelfInstall(ctx)) === 'quitting') return;
    } catch (err) {
      log('error', 'selfinstall.failed', { cause: (err as Error).message });
    }
  }

  // 3. One ChatterED at a time.
  if (!app.requestSingleInstanceLock()) {
    // The running copy comes forward instead (or, if its boot failed, its dialog is still up).
    log('info', 'app.second_instance', { repairing: repairRunning() });
    app.quit();
    return;
  }

  // 4. The engine.
  const installId = ensureInstallId(userData);
  const mode = updaterMode({
    platform: process.platform,
    packaged: app.isPackaged,
    channel: baked.channel,
    hasPublicKey: baked.keys.length > 0,
    envSwitch: process.env.CHATTERED_UPDATES,
    disabledByFile: existsSync(join(userData, 'updates-disabled')),
  });
  let engine: UpdateEngine | null = null;
  let cfg: EngineConfig | null = null;
  const insideUserData = !!bundle && bundle.startsWith(`${userData}/`);
  if (mode.enabled && bundle && !insideUserData) {
    cfg = engineConfig(bundle, installId, 'main', process.pid);
    engine = new UpdateEngine(cfg);
  }
  log('info', 'update.launch', {
    enabled: mode.enabled,
    reason: mode.enabled ? null : mode.reason,
    location,
    channel: baked.channel,
    variant: baked.variant,
    install_id: installId,
  });

  let note: { from: number; to: number } | null = null;
  if (engine) {
    const r = engine.early();
    if (r.kind === 'exit') {
      app.exit(0);
      return;
    }
    note = r.note;
  }

  let healthyTimer: NodeJS.Timeout | null = null;
  setRuntime(
    baseRuntime({
      disabledReason: mode.enabled ? null : mode.reason,
      takeNote: () => {
        const n = note;
        note = null;
        if (n) log('info', 'update.note_shown', { from: n.from, to: n.to });
        return n;
      },
      rendererReady: () => {
        if (!engine || healthyTimer || faultActive('never-healthy')) return;
        // Healthy once the renderer has stayed up a while, not at the first paint.
        healthyTimer = setTimeout(() => engine?.markHealthy(), 30_000);
      },
      repair: (cause) => {
        log('error', 'update.repair', { cause: cause.slice(0, 120) });
        if (!engine) return 'none';
        // A build that keeps failing goes back to N-1 now: no network needed.
        if (!engine.everHealthy() && engine.crashes() + 1 >= MAX_CRASHED_LAUNCHES && engine.rollback('repair')) {
          app.exit(0);
          return 'exiting';
        }
        // The search for a fix runs in its own process (`--chattered-repair`), so neither the
        // startup-failure dialog (app-modal: it blocks this process) nor a quit can stop it. If it
        // stages a fix, it hands it to the helper and ends this process (review D-1).
        try {
          const child = spawn(process.execPath, [`--chattered-repair=${process.pid}`, `--user-data-dir=${userData}`], {
            detached: true,
            stdio: 'ignore',
            env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')),
          });
          child.unref();
          log('info', 'update.repair_started', { pid: child.pid ?? null });
          return 'repairing';
        } catch (err) {
          log('error', 'update.failed', { stage: 'repair_spawn', cause: (err as Error).message });
          return 'none';
        }
      },
      debugInfo: () => ({
        enabled: mode.enabled,
        disabled_reason: mode.enabled ? null : mode.reason,
        kill_switch: { env: process.env.CHATTERED_UPDATES ?? null, file: existsSync(join(userData, 'updates-disabled')) },
        variant: baked.variant,
        keys: baked.keys.map((k) => `${k.role}:${k.id}`),
        quarantined: bundle ? quarantined(bundle) : null,
        ...(engine ? engine.status() : { build, sha: baked.sha, location, install_id: installId }),
      }),
    }),
  );

  if (faultActive('crash-at-launch')) {
    log('error', 'update.fault', { fault: 'crash-at-launch' });
    process.exit(70);
  }
  if (fault) log('warn', 'update.fault_armed', { fault });
  app.on('will-quit', () => engine?.markCleanExit());

  // 5. The worker, the idle relaunch, the self-install's finish.
  void app.whenReady().then(() => {
    // Wherever this copy runs from, as long as it can update itself (it was installed there).
    if (bundle && location === 'ok') {
      void finishSelfInstall({ bundle, appId: baked.appId, productName: baked.productName, userData, home: homedir(), build, location, log }).catch(() => undefined);
    }
    if (!engine || !cfg) return;
    const worker = startWorker(cfg, engine);
    setTimeout(() => void manualInstallNotice(engine!), 5000).unref();
    watchIdle(engine);
    powerMonitor.on('resume', () => worker.post({ type: 'check', reason: 'resume' }));
  });

  // 6. The app.
  try {
    await import('./index.js');
    registerDebugSection();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'boot.import_failed', { cause: message.slice(0, 200) });
    await app.whenReady();
    await startupFailed(message, join(logFile, '..'), err);
  }
}

/**
 * **"ChatterED could not update itself"**, once per build (review #1): App Management refused the
 * swap, or it failed twice. The build is not tried again until a newer one is published, so the
 * participant needs to know what to do instead of watching nothing happen.
 */
async function manualInstallNotice(engine: UpdateEngine): Promise<void> {
  const n = engine.manualInstallNotice();
  if (!n) return;
  engine.markManualInstallNoticeShown(n.build);
  const name = baked.productName;
  const blocked = n.cause === 'app_management';
  log('warn', 'update.manual_notice', { build: n.build, cause: n.cause });
  const buttons = blocked ? ['OK', 'Copy debug info', 'Open App Management'] : ['OK', 'Copy debug info'];
  // A sheet on the app's window, so the main loop keeps running (a quit still quits).
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible());
  const options = {
    type: 'warning' as const,
    message: `${name} could not update itself`,
    detail:
      (blocked
        ? `macOS stopped ${name} from replacing itself. You can allow it in System Settings ▸ Privacy & Security ▸ App Management, then quit and reopen ${name}; it will try again.\n\n`
        : `The new version (build ${n.build}) did not install on this Mac.\n\n`) +
      `Or ask the research team for the new version, then drag ${name} onto Applications and choose Replace. ` +
      'Your notes, progress and study credit are kept.',
    buttons,
    defaultId: 0,
  };
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  if (response === 1) clipboard.writeText(debugReport(`update to build ${n.build} failed: ${n.cause}`));
  if (response === 2 && blocked) {
    engine.forgetCannotApply(n.build);
    void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles');
  }
}

/** The `update` section of the debug report (`src/main/debug/`), if that module loads. */
function registerDebugSection(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const d = require('./debug/index.js') as { registerDebugSection?: (name: string, fn: () => Record<string, unknown>) => unknown };
    d.registerDebugSection?.('update', () => runtime().debugInfo());
  } catch (err) {
    log('warn', 'update.debug_section_failed', { cause: (err as Error).message });
  }
}

function quarantined(path: string): boolean | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    execFileSync('/usr/bin/xattr', ['-p', 'com.apple.quarantine', path], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** The utilityProcess, restarted up to three times; in-process checks if it cannot start at all. */
function startWorker(cfg: EngineConfig, engine: UpdateEngine): { post(m: unknown): void } {
  let child: UtilityProcess | null = null;
  let quitting = false;
  app.on('will-quit', () => {
    quitting = true;
  });
  let restarts = 0;
  const spawnIt = (): void => {
    try {
      child = utilityProcess.fork(join(__dirname, 'update', 'worker.js'), [], { serviceName: `${cfg.productName} Updater`, stdio: 'ignore' });
      child.postMessage({ type: 'config', config: cfg });
      child.on('exit', (code) => {
        child = null;
        if (quitting) return;
        log('warn', 'update.worker_exit', { code, restarts });
        if (restarts < 3) {
          restarts += 1;
          setTimeout(spawnIt, 60_000).unref();
        }
      });
    } catch (err) {
      log('error', 'update.failed', { stage: 'worker', cause: (err as Error).message });
      child = null;
      // No worker: the same checks in this process.
      const tick = () => void engine.check('timer').finally(() => setTimeout(tick, 4 * 3600_000).unref());
      setTimeout(tick, 60_000).unref();
    }
  };
  spawnIt();
  return { post: (m) => child?.postMessage(m) };
}

/**
 * A staged update is swapped in at the next launch, or sooner if the Mac is left: locked for
 * 5 minutes, or idle for 30. Never at logout or shutdown (the helper would be killed mid-swap).
 */
function watchIdle(engine: UpdateEngine): void {
  let shuttingDown = false;
  powerMonitor.on('shutdown', () => {
    shuttingDown = true;
  });
  const attempt = (why: 'idle' | 'locked') => {
    if (shuttingDown || !engine.readStaged()) return;
    // Never in the middle of a model call, a request or a tutorial read: the next tick retries.
    if (isBusy()) {
      log('info', 'update.idle_deferred', { why, busy: true });
      return;
    }
    const idle = powerMonitor.getSystemIdleTime();
    if (idle < (why === 'locked' ? 300 : IDLE_RELAUNCH_SECONDS)) return;
    if (!engine.spawnSwap({ mode: 'apply', relaunch: 'background' })) return;
    log('info', 'update.idle_apply', { why, idle_s: idle });
    app.quit();
    setTimeout(() => app.exit(0), 15_000).unref();
  };
  setInterval(() => attempt('idle'), 5 * 60_000).unref();
  powerMonitor.on('lock-screen', () => setTimeout(() => attempt('locked'), 5 * 60_000 + 1000).unref());
}

const repairFor = arg('--chattered-repair=');
if (smokeOk) runSmoke(smokeOk);
else if (repairFor) runRepair(Number(repairFor));
else
  void start().catch((err: unknown) => {
    log('error', 'boot.bootstrap_failed', { cause: err instanceof Error ? err.message : String(err) });
    // Last resort: still try to run the app.
    void import('./index.js').catch(() => app.exit(1));
  });

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
import { app, powerMonitor, utilityProcess, type UtilityProcess } from 'electron';
import { accessSync, constants as fsConstants, existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readBaked } from './update/baked.js';
import { appendLog, plistValue, UpdateEngine, type EngineConfig } from './update/engine.js';
import { startupFailed } from './update/failure.js';
import { ensureInstallId } from './update/installid.js';
import { buildNumber, bundleOfExecutable, classifyLocation, IDLE_RELAUNCH_SECONDS, MAX_CRASHED_LAUNCHES, updaterMode } from './update/plan.js';
import { faultActive, runtime, setRuntime, type UpdateRuntime } from './update/runtime.js';
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
    repair: async () => false,
    debugInfo: () => ({ build, sha: baked.sha, channel: baked.channel }),
    bootstrapReport: (error) =>
      [
        `${baked.productName} startup report (bootstrap only)`,
        `build: ${build}  sha: ${baked.sha}  version: ${app.getVersion()}  variant: ${baked.variant}`,
        `macOS: ${process.getSystemVersion()}  arch: ${process.arch}`,
        `bundle: ${(bundle ?? app.getPath('exe')).replace(homedir(), '~')}`,
        `userData: ${userData.replace(homedir(), '~')}`,
        `error: ${error.replace(homedir(), '~')}`,
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
      repair: async () => {
        write(false, 'boot');
        app.exit(1);
        return true;
      },
    }),
  );
  // A simulated crash: exit before anything is marked, without the crash reporter's dialog.
  if (faultActive('crash-at-launch')) process.exit(70);
  setTimeout(() => {
    write(false, 'timeout');
    app.exit(3);
  }, 120_000).unref();
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

// ── 2-6. an ordinary launch ─────────────────────────────────────────────────

async function start(): Promise<void> {
  const location = bundle ? classifyLocation(bundle, writable) : 'not_bundle';

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
  if (mode.enabled && bundle) {
    const helperEnv: Record<string, string> = {};
    if (baked.test) for (const [k, v] of Object.entries(process.env)) if (k.startsWith('CHATTERED_HELPER_') && v) helperEnv[k] = v;
    cfg = {
      bundlePath: bundle,
      appId: baked.appId,
      productName: baked.productName,
      swapTool: join(process.resourcesPath, 'chattered-swap'),
      installId,
      role: 'main',
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
      pid: process.pid,
      helperEnv,
      ...(baked.test && process.env.CHATTERED_TEST_FIRST_CHECK_MS ? { firstCheckMs: Number(process.env.CHATTERED_TEST_FIRST_CHECK_MS) || undefined } : {}),
    };
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
      repair: async (cause) => {
        log('error', 'update.repair', { cause: cause.slice(0, 120) });
        if (!engine) return false;
        if (await engine.check('repair')) {
          if (engine.spawnSwap({ mode: 'apply', relaunch: 'front' })) {
            app.exit(0);
            return true;
          }
        }
        if (!engine.everHealthy() && engine.crashes() + 1 >= MAX_CRASHED_LAUNCHES && engine.rollback('repair')) {
          app.exit(0);
          return true;
        }
        return false;
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
    if (bundle && app.isInApplicationsFolder()) {
      void finishSelfInstall({ bundle, appId: baked.appId, productName: baked.productName, userData, home: homedir(), build, location, log }).catch(() => undefined);
    }
    if (!engine || !cfg) return;
    const worker = startWorker(cfg, engine);
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

if (smokeOk) runSmoke(smokeOk);
else
  void start().catch((err: unknown) => {
    log('error', 'boot.bootstrap_failed', { cause: err instanceof Error ? err.message : String(err) });
    // Last resort: still try to run the app.
    void import('./index.js').catch(() => app.exit(1));
  });

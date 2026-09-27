/**
 * The Electron main process.
 *
 * Everything that carries state lives here, outside the webview: the room actor, the silence
 * timer's 1 s tick, the orchestrator, the ledger and the SQLite file. The renderer is a view
 * (architecture-mac.md §B.1, §C.1).
 */
import { app, BrowserWindow, dialog, nativeImage, powerMonitor, powerSaveBlocker, session, shell } from 'electron';
import { basename, join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { release } from 'node:os';
import { pathToFileURL } from 'node:url';
import { openDatabase } from './db/driver.js';
import { runMigrations } from './db/migrations.js';
import { backupDatabase } from './db/backup.js';
import { createStore } from './db/store.js';
import { AppService } from './ipc.js';
import { installMenuFor } from './menu.js';
import { IPC } from '../shared/ipc.js';
import { defaultLogDir, errorClass, fileSink, initLogger, log, type LogLevel } from './log.js';
import { appEntryUrl, guardWindow, installAppGuards, isTrustedSender } from './security.js';
import { CrashBudget, isCrash } from './crash.js';
import { onIntervalActivity } from './clock.js';

/** Release review P1-11. A constant so `renderer.ready` logs what the window was built with. */
const RENDERER_SANDBOX = true;

let mainWindow: BrowserWindow | null = null;
let service: AppService | null = null;
let powerBlockerId: number | null = null;

/**
 * The Vite dev server, for `npm run dev` only. **Ignored in a packaged app** (release review
 * P2-12): honoured there, `launchctl setenv CHATTERED_DEV_SERVER https://…` would load a remote
 * page into the window that holds the whole `window.chattered` bridge.
 */
function devServerUrl(): string | null {
  if (app.isPackaged) return null;
  return process.env.CHATTERED_DEV_SERVER || null;
}

/** The one page the main window may show, and the one IPC senders must be on (`security.ts`). */
function appUrl(): string {
  return appEntryUrl(devServerUrl(), pathToFileURL(join(__dirname, '../renderer/index.html')).href);
}

function dataDir(): string {
  const dir = join(app.getPath('userData'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * The icon, for `npm run dev` only.
 *
 * A packaged build gets its icon from the bundle (`mac.icon` in electron-builder.yml) and macOS
 * reads it from there, so nothing here runs in production. Under `npm run dev` the app is
 * Electron's own bundle, which is why the Dock otherwise shows Electron's icon — `dock.setIcon`
 * is the only thing that changes it, and `BrowserWindow({ icon })` is set too for the Windows
 * and Linux builds this code will outlive.
 */
function devIcon(): Electron.NativeImage | null {
  // dist/main/index.js → app/assets. Absent from a packaged build, which is the point.
  const path = join(__dirname, '../../assets/AppIcon.png');
  if (!existsSync(path)) return null;
  const image = nativeImage.createFromPath(path);
  return image.isEmpty() ? null : image;
}

function createWindow(): BrowserWindow {
  const icon = devIcon();
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    title: 'ChatterED',
    ...(icon ? { icon } : {}),
    backgroundColor: '#F7F7FA',
    // The renderer draws its own title bar and reserves the left TRAFFIC_LIGHT_INSET px of it
    // for these three buttons (issue #21). y: 13 centres 12 px buttons in that 38 px bar.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 13 },
    webPreferences: {
      // One bundled file (scripts/bundle-preload.mjs): a sandboxed preload can `require` only
      // `electron` and a few Node built-ins, not its own sibling modules.
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Release review P1-11. The renderer is a Chromium sandboxed process; the preload is the
      // only thing with `ipcRenderer`, and it exposes named calls, never the channel itself.
      sandbox: RENDERER_SANDBOX,
      webviewTag: false,
      // The countdown hairline and the typing indicator must keep animating when the window
      // is not frontmost — a stalled wait-line reads as a broken app (architecture-mac.md §C.3).
      backgroundThrottling: false,
    },
  });

  /**
   * **Nothing may scale the UI chrome by itself.** ⌘+/⌘−/⌘0 reach the document instead, through
   * the application menu (main/menu.ts), and a pinch reaches the document for the same reason.
   * That is still true, and it is still the point of this line.
   *
   * `'isolated'` rather than `'disabled'`, because `'disabled'` also broke the *other* zoom —
   * View ▸ Larger Text, the app's one accessibility control, which scales the whole interface
   * for someone who cannot read it at 13 px. All three modes were measured live on Electron
   * 44.3.0 / Chromium 152, driving the real menu item over the accessibility API:
   *
   *   - `'disabled'`: `setZoomFactor(1.5)` is **accepted** and reports back as 1.5 from
   *     `getZoomFactor()`, and nothing on screen moves — `window.innerWidth` 1320 → 1320,
   *     `devicePixelRatio` 2 → 2. Setting the mode to `'manual'` immediately before the call
   *     does not rescue it.
   *   - `'manual'`: applied at the *next navigation* only. A factor set before the first load
   *     came up scaled; the same call from the menu afterwards changed nothing.
   *   - `'isolated'`: applied immediately — 1320 → 880 and DPR 2 → 3 at 1.5× — and per
   *     webContents, so no zoom propagates in from another window of the same origin.
   *
   * The thing `'disabled'` was guarding is unaffected: with `'isolated'`, twelve ctrl-wheel
   * events over the nav rail, the flow header and the vault sidebar left `innerWidth` and
   * `devicePixelRatio` untouched. Chromium's ctrl-wheel page zoom is a Chrome-browser feature
   * that Electron does not implement; the risk ui-review-code.md §4 actually found was the
   * *default menu's* zoom roles, and those are claimed in main/menu.ts. Pinch is pinned by the
   * limits call below, and both viewers `preventDefault()` their own ctrl-wheel besides.
   */
  win.webContents.setZoomMode('isolated');
  void win.webContents.setVisualZoomLevelLimits(1, 1);

  /**
   * The macOS three-finger swipe, as a *secondary* path to a page turn. Its own typing says it
   * only fires when System Settings ▸ Trackpad ▸ More Gestures ▸ "Swipe between pages" is set to
   * "Swipe with two or three fingers", which is not the default — so the viewer's own
   * horizontal-wheel latch is the mechanic, and this is a bonus for the people who have it on.
   */
  win.on('swipe', (_event, direction) => {
    if (direction !== 'left' && direction !== 'right') return;
    win.webContents.send(IPC.appCommand, direction === 'left' ? 'page.next' : 'page.prev');
  });

  // Before the first load, so not even the first navigation is unguarded (release review P0-3).
  guardWindow(win, appUrl(), { openExternal: (url) => shell.openExternal(url), log: log() });
  watchRenderer(win);

  const devServer = devServerUrl();
  if (devServer) void win.loadURL(devServer);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));

  // Re-walk the vault when the learner comes back to the window: they may have dropped a new
  // PDF into it from Finder or from a browser download (issue #22 decision 1). mtime diffing
  // makes an unchanged vault nearly free, so this does not need to be rate-limited. Here rather
  // than in boot(), so a window re-created from the Dock gets it too (release review P2-5).
  win.on('focus', () => service?.refreshVault());

  // macOS hides the traffic lights in fullscreen, so the renderer's reserved spacer has to
  // collapse or the title sits 78 px too far right (issue #21). The window is the only thing
  // that knows, so it tells the renderer; the renderer never asks.
  const pushWindowState = () => {
    if (win.isDestroyed()) return;
    win.webContents.send(IPC.windowState, { fullScreen: win.isFullScreen() });
  };
  win.on('enter-full-screen', pushWindowState);
  win.on('leave-full-screen', pushWindowState);
  // A reload re-mounts the renderer with no memory of the last push, so re-state it.
  win.webContents.on('did-finish-load', pushWindowState);

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

/**
 * **A crashed or hung window comes back** (release review P1-13). Everything that matters lives in
 * this process, so a reload re-bootstraps the page from it with nothing lost; the budget stops a
 * page that crashes *because* of what it loads from reloading forever (`crash.ts`).
 */
function watchRenderer(win: BrowserWindow): void {
  const budget = new CrashBudget();
  let asking = false;

  win.webContents.on('preload-error', (_event, _path, error) => {
    // The renderer would otherwise just find no bridge; say why here, where the log is.
    log().error('preload.error', { class: error.name, cause: error.message });
  });
  win.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame) log().error('renderer.load_failed', { code, cause: description });
  });
  // One line per load that says the window is healthy: sandboxed, and the preload's bridge is on
  // the page. A missing bridge is the renderer's fatal screen (bridge.ts); this is its log half.
  win.webContents.on('did-finish-load', () => {
    win.webContents
      .executeJavaScript("typeof window.chattered === 'object' && window.chattered !== null", true)
      .then((bridge: unknown) => {
        const fields = { sandbox: RENDERER_SANDBOX, bridge: bridge === true };
        if (bridge === true) log().info('renderer.ready', fields);
        else log().error('renderer.no_bridge', fields);
      })
      .catch((err: unknown) => log().warn('renderer.probe_failed', { cause: (err as Error).message }));
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    log().error('renderer.gone', { reason: details.reason, exit_code: details.exitCode });
    if (!isCrash(details.reason) || win.isDestroyed()) return;
    if (budget.record(Date.now())) {
      log().info('renderer.reload', { reason: details.reason });
      win.webContents.reload();
      return;
    }
    log().error('renderer.gave_up', { reason: details.reason });
    void dialog
      .showMessageBox(win, {
        type: 'error',
        message: 'ChatterED’s window keeps closing unexpectedly.',
        detail:
          'Your work is saved. Try reopening the window; if it happens again, use Help ▸ Report a ' +
          `Problem and attach the log folder:\n${logDir()}`,
        buttons: ['Reload', 'Quit'],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 1) app.quit();
        else if (!win.isDestroyed()) win.webContents.reload();
      });
  });

  win.on('unresponsive', () => {
    log().warn('renderer.unresponsive', {});
    if (asking || win.isDestroyed()) return;
    asking = true;
    void dialog
      .showMessageBox(win, {
        type: 'warning',
        message: 'ChatterED’s window is not responding.',
        detail: 'You can wait for it, or reload the window. Your work is saved either way.',
        buttons: ['Wait', 'Reload'],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => {
        asking = false;
        if (response === 1 && !win.isDestroyed()) {
          // A hung page cannot run a reload itself. Ending its process is what Chrome's "Exit
          // page" does; `render-process-gone` then reloads it, inside the same budget.
          log().info('renderer.kill', { reason: 'unresponsive' });
          win.webContents.forcefullyCrashRenderer();
        }
      });
  });
  win.on('responsive', () => log().info('renderer.responsive', {}));
}

/** Focus the window a second launch was trying to open (release review P1-3). */
function focusMainWindow(): void {
  if (!app.isReady()) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (service) mainWindow = createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * The log is opened **first**, before the database, the window or anything that can fail — the
 * whole point of it is to be there when something does. The level comes from the environment so
 * a debugging session is `CHATTERED_LOG_LEVEL=debug open -a ChatterED` and needs no rebuild.
 */
function bootLog(): void {
  const raw = (process.env.CHATTERED_LOG_LEVEL ?? '').toLowerCase();
  const level: LogLevel = raw === 'debug' || raw === 'warn' || raw === 'error' ? raw : 'info';
  initLogger({
    sink: fileSink(logDir()),
    level,
    base: { v: app.getVersion(), packaged: app.isPackaged },
  });
  log().info('app.start', {
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform} ${release()}`,
    level,
  });
  process.on('uncaughtException', (err) => {
    log().error('process.uncaught', { class: err.name, cause: err.message });
  });
  process.on('unhandledRejection', (reason) => {
    log().error('process.unhandled_rejection', { cause: reason instanceof Error ? reason.message : String(reason) });
  });
}

/** `app.getPath('logs')` is `~/Library/Logs/ChatterED` on macOS; the fallback is the same path. */
export function logDir(): string {
  try {
    return app.getPath('logs');
  } catch {
    return defaultLogDir();
  }
}

function boot(): void {
  const dir = dataDir();
  const db = openDatabase(join(dir, 'app.db'));
  // An update's first launch copies the database before it touches the schema (release review
  // P1-4): a migration that fails on a real learner's rows must never strand their notes.
  runMigrations(db, join(__dirname, 'db/migrations'), {
    beforeUpgrade: (from, to) => {
      const file = backupDatabase(db, dir, from);
      log().info('db.backup', { from, to, file: basename(file) });
    },
  });
  const store = createStore(db);

  // Before any window exists, so its webContents is covered from the first event.
  const entry = appUrl();
  installAppGuards({
    app,
    session: session.defaultSession,
    isAppContents: (contents) => contents !== null && contents === mainWindow?.webContents,
    log: log(),
  });

  service = new AppService({
    store,
    db,
    appVersion: app.getVersion(),
    osVersion: `${process.platform} ${release()}`,
    userDataDir: dir,
    logDir: logDir(),
    getWindow: () => mainWindow,
    isTrustedSender: (event) => isTrustedSender(event, entry),
  });
  service.register();
  // What this install spent before there was a ledger. Once per launch, idempotent, swallowed
  // on failure — see `AppService.backfillCost`.
  service.backfillCost();

  mainWindow = createWindow();
  // Reload and DevTools are in this menu only while `app.isPackaged` is false.
  installMenuFor(() => mainWindow);

  // App Nap off only while a room's ticks are armed — a napping process does not tick — and
  // back on when none are, so an app left open all day is not kept awake (release review P2-4).
  onIntervalActivity((active) => {
    if (active && powerBlockerId === null) {
      powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
      log().debug('power.blocker', { on: true });
    } else if (!active && powerBlockerId !== null) {
      powerSaveBlocker.stop(powerBlockerId);
      powerBlockerId = null;
      log().debug('power.blocker', { on: false });
    }
  });

  // The recovery pass runs on launch and on every resume. It is idempotent — a stale fire is
  // discarded by timerEpoch — so running it twice is harmless (architecture-mac.md §B.4).
  powerMonitor.on('resume', () => service?.recover());
  service.recover();

  // Warm the Claude CLI detection cache in the background. The probe costs one real Haiku
  // round trip, so it must never sit on the critical path of a launch or a turn (issue #19);
  // it is cached in the settings table and re-used until the learner presses "Check again".
  void service.detectCli().catch(() => undefined);
}

/**
 * **A boot that fails says so, and exits** (release review P1-4). Without this a throw in
 * `boot()` — the native SQLite module not loading, a full disk, a migration failing on a real
 * database — left a Dock icon and no window, and the reason in a log the learner never heard of.
 */
function failBoot(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  try {
    log().error('boot.failed', { class: errorClass(err), cause: message });
  } catch {
    /* no log either; the dialog is all there is */
  }
  dialog.showErrorBox(
    'ChatterED could not start',
    `${message}\n\nNothing has been deleted. The log, which says more, is in:\n${logDir()}\n\n` +
      'Use it with Help ▸ Report a Problem on the next launch, or send it with a note of what happened.',
  );
  app.exit(1);
}

/**
 * **One ChatterED at a time** (release review P1-3). Two processes would share one SQLite file and
 * each run its own room actor, silence timer and ingest — duplicate agent turns, and the same
 * deck ingested (and billed) twice. A second launch (the Dock and a copy on the mounted DMG are
 * different paths, so macOS starts both) hands over to the first and quits.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => focusMainWindow());

  void app.whenReady().then(() => {
    try {
      bootLog();
      const icon = devIcon();
      if (icon && process.platform === 'darwin') app.dock?.setIcon(icon);
      boot();
    } catch (err) {
      failBoot(err);
      return;
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  // Chromium's own helpers (GPU, network, utility). The GPU process is restarted by Chromium;
  // this is so a crash is in the log next to whatever it broke (release review P1-13).
  app.on('child-process-gone', (_event, details) => {
    log().error('child.gone', {
      type: details.type,
      reason: details.reason,
      exit_code: details.exitCode,
      name: details.name ?? null,
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  log().info('app.quit', {});
  // An open Max question is saved with the sitting, not released: a quit cannot wait for his turn.
  // It is released when the file is next opened after the idle gap (`RoomActor.start`, §4.7, #49).
  service?.dispose();
  onIntervalActivity(null);
  if (powerBlockerId !== null) powerSaveBlocker.stop(powerBlockerId);
  powerBlockerId = null;
});

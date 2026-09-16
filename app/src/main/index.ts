/**
 * The Electron main process.
 *
 * Everything that carries state lives here, outside the webview: the room actor, the silence
 * timer's 1 s tick, the orchestrator, the ledger and the SQLite file. The renderer is a view
 * (architecture-mac.md §B.1, §C.1).
 */
import { app, BrowserWindow, nativeImage, powerMonitor, powerSaveBlocker } from 'electron';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { release } from 'node:os';
import { openDatabase } from './db/driver.js';
import { runMigrations } from './db/migrations.js';
import { createStore } from './db/store.js';
import { AppService } from './ipc.js';
import { installMenuFor } from './menu.js';
import { IPC } from '../shared/ipc.js';
import { defaultLogDir, fileSink, initLogger, log, type LogLevel } from './log.js';

let mainWindow: BrowserWindow | null = null;
let service: AppService | null = null;
let powerBlockerId: number | null = null;

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
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
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

  const devServer = process.env.CHATTERED_DEV_SERVER;
  if (devServer) void win.loadURL(devServer);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));

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
    mainWindow = null;
  });
  return win;
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
  runMigrations(db, join(__dirname, 'db/migrations'));
  const store = createStore(db);

  service = new AppService({
    store,
    db,
    appVersion: app.getVersion(),
    osVersion: `${process.platform} ${release()}`,
    userDataDir: dir,
    logDir: logDir(),
    getWindow: () => mainWindow,
  });
  service.register();
  // What this install spent before there was a ledger. Once per launch, idempotent, swallowed
  // on failure — see `AppService.backfillCost`.
  service.backfillCost();

  mainWindow = createWindow();
  // Reload and DevTools are in this menu only while `app.isPackaged` is false.
  installMenuFor(() => mainWindow);

  // Keep App Nap off while the app is open: a napping process does not tick.
  powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');

  // The recovery pass runs on launch and on every resume. It is idempotent — a stale fire is
  // discarded by timerEpoch — so running it twice is harmless (architecture-mac.md §B.4).
  powerMonitor.on('resume', () => service?.recover());
  service.recover();

  // Re-walk the vault when the learner comes back to the window: they may have dropped a new
  // PDF into it from Finder or from a browser download (issue #22 decision 1). mtime diffing
  // makes an unchanged vault nearly free, so this does not need to be rate-limited.
  mainWindow.on('focus', () => service?.refreshVault());

  // Warm the Claude CLI detection cache in the background. The probe costs one real Haiku
  // round trip, so it must never sit on the critical path of a launch or a turn (issue #19);
  // it is cached in the settings table and re-used until the learner presses "Check again".
  void service.detectCli().catch(() => undefined);
}

void app.whenReady().then(() => {
  bootLog();
  const icon = devIcon();
  if (icon && process.platform === 'darwin') app.dock?.setIcon(icon);
  boot();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  log().info('app.quit', {});
  service?.dispose();
  if (powerBlockerId !== null) powerSaveBlocker.stop(powerBlockerId);
});

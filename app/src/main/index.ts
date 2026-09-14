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
import { IPC } from '../shared/ipc.js';

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

function boot(): void {
  const dir = dataDir();
  const db = openDatabase(join(dir, 'app.db'));
  runMigrations(db, join(__dirname, 'db/migrations'));
  const store = createStore(db);

  service = new AppService({
    store,
    appVersion: app.getVersion(),
    osVersion: `${process.platform} ${release()}`,
    userDataDir: dir,
    getWindow: () => mainWindow,
  });
  service.register();

  mainWindow = createWindow();

  // Keep App Nap off while the app is open: a napping process does not tick.
  powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');

  // The recovery pass runs on launch and on every resume. It is idempotent — a stale fire is
  // discarded by timerEpoch — so running it twice is harmless (architecture-mac.md §B.4).
  powerMonitor.on('resume', () => service?.recover());
  service.recover();

  // Warm the Claude CLI detection cache in the background. The probe costs one real Haiku
  // round trip, so it must never sit on the critical path of a launch or a turn (issue #19);
  // it is cached in the settings table and re-used until the learner presses "Check again".
  void service.detectCli().catch(() => undefined);
}

void app.whenReady().then(() => {
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
  service?.dispose();
  if (powerBlockerId !== null) powerSaveBlocker.stop(powerBlockerId);
});

/**
 * The Electron main process.
 *
 * Everything that carries state lives here, outside the webview: the room actor, the silence
 * timer's 1 s tick, the orchestrator, the ledger and the SQLite file. The renderer is a view
 * (architecture-mac.md §B.1, §C.1).
 */
import { app, BrowserWindow, powerMonitor, powerSaveBlocker } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { release } from 'node:os';
import { openDatabase } from './db/driver.js';
import { runMigrations } from './db/migrations.js';
import { createStore } from './db/store.js';
import { AppService } from './ipc.js';

let mainWindow: BrowserWindow | null = null;
let service: AppService | null = null;
let powerBlockerId: number | null = null;

function dataDir(): string {
  const dir = join(app.getPath('userData'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    title: 'ChatterED',
    backgroundColor: '#F7F7FA',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
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

  win.on('closed', () => {
    mainWindow = null;
  });
  return win;
}

function boot(): void {
  const db = openDatabase(join(dataDir(), 'app.db'));
  runMigrations(db, join(__dirname, 'db/migrations'));
  const store = createStore(db);

  service = new AppService({
    store,
    appVersion: app.getVersion(),
    osVersion: `${process.platform} ${release()}`,
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
}

void app.whenReady().then(() => {
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

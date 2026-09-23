/**
 * The application menu.
 *
 * There was none, so Electron's **default** menu shipped — and with it three things ChatterED
 * cannot have (ui-review-code.md §4, §5.9):
 *
 *  1. **⌘+ / ⌘− / ⌘0 belonged to Chromium.** They were bound to the `zoomIn`/`zoomOut`/
 *     `resetZoom` roles, which scale the whole application chrome — nav rail, sidebar, composer
 *     and all — rather than the PDF the learner is looking at. The accelerators are claimed here
 *     and routed to the viewer over `app:command`.
 *  2. **Reload, Force Reload and Toggle Developer Tools were handed to the learner.** ⌘R in a
 *     live study session drops them into `screen: 'loading'` mid-round. They are present in a
 *     dev build and absent from the installed app, gated on `app.isPackaged`.
 *  3. No File, no Help — nothing that names the app's own vocabulary.
 *
 * The menu never reaches into the view: every item either is a standard role, sends one
 * `AppCommand` string to the renderer (which decides what it means), or — for the text size
 * below — drives this window's own `webContents`.
 *
 * ## The two zooms, and why the View menu says so out loud
 *
 * They are different things and a learner has to be able to tell them apart:
 *
 *   - **Zoom** (⌘+ / ⌘− / ⌘0) is the *document*. It goes to whichever viewer is open over
 *     `app:command`, and it scales the deck — the flow's cards, crops and threads, or the page
 *     viewer's pages. Nothing about the app's own chrome moves.
 *   - **Text Size** (⌥⌘+ / ⌥⌘− / ⌥⌘0) is the *application*. It is Chromium's page zoom, driven
 *     here through `webContents.setZoomFactor`, and it scales everything — nav rail, sidebar,
 *     composer, menus of the app's own making. This is the accessibility control every desktop
 *     app is expected to have, and ChatterED had none: with ⌘+ deliberately taken away from
 *     Chromium there was no way at all to make the interface larger.
 *
 * They are in separate groups under separate headings for that reason, and the group heading is
 * a real (disabled) menu item rather than a comment in the source, because the person who needs
 * the distinction is reading the menu, not this file.
 */
import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppCommand } from '../shared/types.js';
import { IPC } from '../shared/ipc.js';

/**
 * The UI text-size ladder, as Chromium zoom factors. 1 is the size the app ships at, and the
 * ends are the ones macOS itself uses for this kind of control: legible down to 80 % and up to
 * a genuine large-text 200 %.
 */
export const TEXT_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
export const DEFAULT_TEXT_SCALE = 1;

export function largerText(current: number): number {
  return TEXT_STEPS.find((z) => z > current + 0.001) ?? TEXT_STEPS[TEXT_STEPS.length - 1]!;
}

export function smallerText(current: number): number {
  return [...TEXT_STEPS].reverse().find((z) => z < current - 0.001) ?? TEXT_STEPS[0];
}

/** A stored factor read defensively: missing, corrupt or off the ladder's ends is 100 %. */
export function readTextScale(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TEXT_SCALE;
  return Math.min(TEXT_STEPS[TEXT_STEPS.length - 1]!, Math.max(TEXT_STEPS[0], n));
}

export interface MenuDeps {
  getWindow(): BrowserWindow | null;
  /** `app.isPackaged` in production; injectable so the template can be tested both ways. */
  isPackaged: boolean;
  /** Injectable for the same reason — the test builds the template without an Electron app. */
  appName?: string;
  /** The persisted UI text scale. Injected so the template builds under plain Node. */
  getTextScale?(): number;
  setTextScale?(value: number): void;
}

export function buildMenuTemplate(deps: MenuDeps): MenuItemConstructorOptions[] {
  const send = (command: AppCommand) => () => {
    deps.getWindow()?.webContents.send(IPC.appCommand, command);
  };

  /**
   * Text size, applied to this window's `webContents`.
   *
   * `createWindow` puts the window in zoom mode `'isolated'`, and that call carries the whole
   * argument for why (main/index.ts): under `'disabled'` this line is accepted, reports back
   * the factor you asked for, and moves nothing on screen. The mode is re-asserted here rather
   * than assumed, so the menu keeps working whatever else has touched the window; it is
   * idempotent and costs nothing.
   *
   * "Isolated" is per-webContents, so nothing propagates in from another window of the same
   * origin, and it leaves ctrl-wheel inert on the chrome — measured, not assumed.
   */
  const applyText = (next: number) => {
    const contents = deps.getWindow()?.webContents;
    if (!contents) return;
    contents.setZoomMode('isolated');
    contents.setZoomFactor(next);
    deps.setTextScale?.(next);
  };

  const textScale = () => readTextScale(deps.getTextScale?.() ?? DEFAULT_TEXT_SCALE);

  const devOnly: MenuItemConstructorOptions[] = deps.isPackaged
    ? []
    : [
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
      ];

  return [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'Open Vault…', accelerator: 'CommandOrControl+Shift+O', click: send('vault.open') },
        { label: 'Re-scan Vault', accelerator: 'CommandOrControl+R', click: send('vault.rescan') },
        { label: 'Edit Topics…', click: send('topics.edit') },
        { type: 'separator' },
        { label: 'Find a File…', accelerator: 'CommandOrControl+Shift+F', click: send('search.files') },
        { type: 'separator' },
        // Both ask for confirmation in main before anything is lost (2026-09-23); no accelerator,
        // because a destructive action one chord away is one mistyped chord away.
        { label: 'Regenerate Notes…', click: send('notes.regenerate') },
        { label: 'New Conversation…', click: send('chat.reset') },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        // Two entries for zoom in: ⌘+ on a US layout arrives as `=` without shift, and an
        // accelerator registered as `Plus` alone does not catch it.
        { label: 'Zoom In', accelerator: 'CommandOrControl+Plus', click: send('zoom.in') },
        { label: 'Zoom In', accelerator: 'CommandOrControl+=', visible: false, click: send('zoom.in') },
        { label: 'Zoom Out', accelerator: 'CommandOrControl+-', click: send('zoom.out') },
        { label: 'Actual Size', accelerator: 'CommandOrControl+0', click: send('zoom.reset') },
        { type: 'separator' },
        { label: 'Fit Width', accelerator: 'CommandOrControl+1', click: send('fit.width') },
        { label: 'Fit Page', accelerator: 'CommandOrControl+2', click: send('fit.page') },
        { type: 'separator' },
        { label: 'Next Page', accelerator: 'CommandOrControl+Down', click: send('page.next') },
        { label: 'Previous Page', accelerator: 'CommandOrControl+Up', click: send('page.prev') },
        { type: 'separator' },
        // The heading is a menu item, not a comment: the person who needs to know that the two
        // zooms are different things is reading the menu. Everything above scales the document;
        // everything below scales the app.
        { label: 'Interface', enabled: false },
        { label: 'Larger Text', accelerator: 'Alt+CommandOrControl+Plus', click: () => applyText(largerText(textScale())) },
        // Same reason as Zoom In's twin: ⌥⌘+ arrives as ⌥⌘= on a US layout.
        { label: 'Larger Text', accelerator: 'Alt+CommandOrControl+=', visible: false, click: () => applyText(largerText(textScale())) },
        { label: 'Smaller Text', accelerator: 'Alt+CommandOrControl+-', click: () => applyText(smallerText(textScale())) },
        { label: 'Default Text', accelerator: 'Alt+CommandOrControl+0', click: () => applyText(DEFAULT_TEXT_SCALE) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...devOnly,
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Settings…', accelerator: 'CommandOrControl+,', click: send('settings.open') },
        { type: 'separator' },
        {
          label: 'How ChatterED Works',
          click: () => void shell.openExternal('https://github.com/lucasisnotcool/ChatterED#readme'),
        },
      ],
    },
  ];
}

export function installApplicationMenu(deps: MenuDeps): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(deps)));
}

/**
 * Where the UI text size is kept: one number, in the same `userData` directory the settings
 * database is in, so it is per install and survives a relaunch. Deliberately its own tiny file
 * rather than a settings row — it is read before the renderer exists and written by the main
 * process, so routing it through the renderer's settings IPC would be the long way round.
 */
function textScalePath(): string {
  return join(app.getPath('userData'), 'ui-text-scale.json');
}

function loadTextScale(): number {
  try {
    return readTextScale(JSON.parse(readFileSync(textScalePath(), 'utf8')) as unknown);
  } catch {
    return DEFAULT_TEXT_SCALE;
  }
}

function storeTextScale(value: number): void {
  try {
    writeFileSync(textScalePath(), JSON.stringify(value), 'utf8');
  } catch {
    // An unwritable userData directory is not worth failing a menu click over.
  }
}

/** `app` is only touched here so `buildMenuTemplate` stays testable under plain Node. */
export function installMenuFor(getWindow: () => BrowserWindow | null): void {
  let scale = loadTextScale();
  installApplicationMenu({
    getWindow,
    isPackaged: app.isPackaged,
    getTextScale: () => scale,
    setTextScale: (value) => {
      scale = value;
      storeTextScale(value);
    },
  });

  // Re-apply on every load, not once: a reload (⌘R is still in a dev build) re-creates the page,
  // and a learner who set the interface larger should not have to set it again to read the app.
  const apply = () => {
    const contents = getWindow()?.webContents;
    if (!contents || scale === DEFAULT_TEXT_SCALE) return;
    contents.setZoomMode('isolated');
    contents.setZoomFactor(scale);
  };
  getWindow()?.webContents.on('did-finish-load', apply);
  apply();
}

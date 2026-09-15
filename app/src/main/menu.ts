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
 * The menu never reaches into the view: every item either is a standard role or sends one
 * `AppCommand` string to the renderer, which decides what it means.
 */
import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import type { AppCommand } from '../shared/types.js';
import { IPC } from '../shared/ipc.js';

export interface MenuDeps {
  getWindow(): BrowserWindow | null;
  /** `app.isPackaged` in production; injectable so the template can be tested both ways. */
  isPackaged: boolean;
  /** Injectable for the same reason — the test builds the template without an Electron app. */
  appName?: string;
}

export function buildMenuTemplate(deps: MenuDeps): MenuItemConstructorOptions[] {
  const send = (command: AppCommand) => () => {
    deps.getWindow()?.webContents.send(IPC.appCommand, command);
  };

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
          click: () => void shell.openExternal('https://github.com/aekyr/ChatterED#readme'),
        },
      ],
    },
  ];
}

export function installApplicationMenu(deps: MenuDeps): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(deps)));
}

/** `app` is only touched here so `buildMenuTemplate` stays testable under plain Node. */
export function installMenuFor(getWindow: () => BrowserWindow | null): void {
  installApplicationMenu({ getWindow, isPackaged: app.isPackaged });
}

/**
 * **Copy Debug Info for the Team** (⇧⌘D, and Help ▸ Copy Debug Info for the Team).
 *
 * One key press: main builds the report (`report.ts`), writes it to the clipboard itself, and asks
 * the window to show it in a small panel, already selected (`DebugReportPanel.svelte`). The
 * participant pastes it into the chat with the research team; `npm run debug:read` reads it back.
 *
 * **It must work when the app is broken.** So:
 *  - the shortcut is caught in `before-input-event`, in this process, before the page sees the
 *    key: a hung or crashed page, or one stuck on the consent screen, still triggers it;
 *  - the report is built here from files and the OS, never from the renderer;
 *  - the clipboard is written before the panel is asked for; and if the panel does not say it is
 *    on screen within `PANEL_TIMEOUT_MS` (no window, a crashed or hung page, no bridge), a native
 *    dialog says "copied" instead.
 *
 * The startup-failure dialog (`update/failure.ts`) needs only `buildDebugReport()`, which has no
 * Electron dependency beyond reading `app`'s paths.
 *
 * The two channels run outside `AppService`'s consent gate on purpose: they copy main's own
 * report and nothing else, and the consent screen is one of the places a participant gets stuck.
 * They still refuse any sender that is not the app's own page.
 */
import { randomUUID } from 'node:crypto';
import { app, clipboard, dialog, ipcMain, type BrowserWindow, type WebContents } from 'electron';
import { log } from '../log.js';
import { DEBUG_COPIED_LINE, DEBUG_IPC, type DebugShow } from '../../shared/debug.js';
import type { IpcSenderLike } from '../security.js';
import { buildDebugReport, ensureInstallId } from './report.js';
import { renderReport } from './wire.js';

export { buildDebugReport, registerDebugSection, ensureInstallId, INSTALL_ID_FILE } from './report.js';
export type { BuildOptions, DebugSectionFn } from './report.js';
export { DEBUG_HEADER, DEBUG_MAX_CHARS, parseReport, diagnose } from './wire.js';

/** How long the panel has to say it is showing before the native dialog takes over. */
export const PANEL_TIMEOUT_MS = 2000;
/** A second trigger this soon after the first (the menu and the key handler both firing) is one. */
const DEBOUNCE_MS = 600;

export interface KeyInput {
  type: string;
  key: string;
  code?: string;
  meta: boolean;
  control: boolean;
  shift: boolean;
  alt: boolean;
  isAutoRepeat?: boolean;
}

/** ⇧⌘D on a Mac (⇧Ctrl+D elsewhere), on key-down, not repeated, with no other modifier. */
export function matchesShortcut(input: KeyInput, platform: string = process.platform): boolean {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return false;
  const mod = platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta;
  const d = input.key.toLowerCase() === 'd' || input.code === 'KeyD';
  return mod && input.shift && !input.alt && d;
}

/** Never throws: a report that cannot be built is still a report, saying why. */
export function safeReport(): string {
  try {
    return buildDebugReport();
  } catch (err) {
    const cause = (err instanceof Error ? err.message : String(err)).split('\n')[0]!.slice(0, 120);
    return renderReport([{ name: '', lines: [{ text: `error: report failed: ${cause}`, prio: 100, group: 'head' }] }]);
  }
}

interface InstallDeps {
  getWindow(): BrowserWindow | null;
  isTrustedSender(event: IpcSenderLike): boolean;
}

let deps: InstallDeps | null = null;
let last: string | null = null;
let lastShownAt = 0;
let pending: { token: string; chars: number; via: string; timer: ReturnType<typeof setTimeout> } | null = null;
const attached = new WeakSet<WebContents>();

function attachShortcut(contents: WebContents): void {
  if (attached.has(contents)) return;
  attached.add(contents);
  contents.on('before-input-event', (event, input) => {
    if (!matchesShortcut(input)) return;
    event.preventDefault();
    showDebugReport('shortcut');
  });
}

/**
 * The one registration line in `index.ts`'s `boot()`, before the window is made. Makes the install
 * id if it is not there yet, so the updater's per-install targeting has it from the first launch.
 */
export function installDebugReport(d: InstallDeps): void {
  deps = d;
  try {
    ensureInstallId(app.getPath('userData'));
  } catch {
    /* the report says why, when it is asked for */
  }
  const refuse = (event: IpcSenderLike) => {
    if (!deps?.isTrustedSender(event)) throw new Error('Refused: this request did not come from the ChatterED window.');
  };
  ipcMain.handle(DEBUG_IPC.shown, (event, token: unknown) => {
    refuse(event);
    if (!pending || pending.token !== token) return;
    clearTimeout(pending.timer);
    log().info('debug.report_shown', { via: pending.via, surface: 'panel', chars: pending.chars });
    pending = null;
  });
  ipcMain.handle(DEBUG_IPC.copy, (event) => {
    refuse(event);
    const text = last ?? safeReport();
    last = text;
    clipboard.writeText(text);
    log().info('debug.report_copied', { chars: text.length });
    return { ok: true, chars: text.length };
  });
  app.on('web-contents-created', (_event, contents) => attachShortcut(contents));
}

function nativeDialog(text: string, via: string, reason: string): void {
  log().info('debug.report_shown', { via, surface: 'dialog', reason, chars: text.length });
  const win = deps?.getWindow() ?? null;
  // The whole report is on the clipboard; the dialog shows its start so they can see what it is.
  const preview = text.length > 1400 ? `${text.slice(0, 1400)}\n…` : text;
  const options = {
    type: 'info' as const,
    message: 'Debug info copied',
    detail: `${DEBUG_COPIED_LINE}\n\n${preview}`,
    buttons: ['Done', 'Copy Again'],
    defaultId: 0,
    cancelId: 0,
  };
  const shown = win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
  void shown
    .then(({ response }) => {
      if (response === 1) clipboard.writeText(text);
    })
    .catch(() => undefined);
}

/** Build, copy, show. `via` is only for the log line. */
export function showDebugReport(via: 'shortcut' | 'menu' = 'menu'): void {
  const now = Date.now();
  if (now - lastShownAt < DEBOUNCE_MS) return;
  lastShownAt = now;
  const text = safeReport();
  last = text;
  try {
    clipboard.writeText(text);
  } catch (err) {
    log().warn('debug.clipboard_failed', { cause: (err as Error).message });
  }
  if (pending) {
    clearTimeout(pending.timer);
    pending = null;
  }
  const win = deps?.getWindow() ?? null;
  const contents = win && !win.isDestroyed() ? win.webContents : null;
  if (!win || !contents || contents.isDestroyed() || contents.isCrashed()) {
    nativeDialog(text, via, win ? 'renderer_gone' : 'no_window');
    return;
  }
  const token = randomUUID();
  pending = {
    token,
    chars: text.length,
    via,
    timer: setTimeout(() => {
      if (pending?.token !== token) return;
      pending = null;
      nativeDialog(text, via, 'no_panel');
    }, PANEL_TIMEOUT_MS),
  };
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  contents.send(DEBUG_IPC.show, { text, token } satisfies DebugShow);
}

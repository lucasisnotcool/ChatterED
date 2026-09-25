/**
 * **What the window may load, open and ask for — and who the IPC bridge answers.**
 *
 * The preload hands every page loaded in the main window the whole `window.chattered` API: read
 * vault files, receive transcripts, spend the learner's model budget. So the rules here are about
 * keeping that window on the app's own page (release review P0-3):
 *
 *   - **Navigation.** The window never leaves the renderer's `index.html`. A dropped `.pdf` or
 *     `.html`, a dragged link, a `location =` from a bug — all refused (`will-navigate`,
 *     `will-redirect`).
 *   - **New windows.** Never. An `https:` link is handed to the default browser; anything else
 *     (a `file:`, a `javascript:`, a custom scheme) goes nowhere.
 *   - **Webviews.** Never attached.
 *   - **Permissions.** Only clipboard writes (Settings ▸ Copy diagnostics), and only for the main
 *     window. No camera, microphone, geolocation, notifications, HID, serial…
 *   - **IPC senders.** A handler runs only for the main frame of a page at the app's own URL.
 *
 * The pure half (URL and permission decisions) is exported for the tests; the Electron half is
 * `guardWindow` and `installAppGuards`, called from `index.ts`.
 */
import type { BrowserWindow, Session, WebContents } from 'electron';

/** The URL the main window is meant to show, as `loadURL`/`loadFile` will report it back. */
export function appEntryUrl(devServer: string | null, rendererIndexFileUrl: string): string {
  return devServer ?? rendererIndexFileUrl;
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * True when `url` is the app's own page. The hash and the query are ignored (the renderer is a
 * single page and never uses either for routing, but a hash change must not read as foreign).
 *
 *  - `file:` — the same file, exactly: under `file://`, "same origin" would be *any* local file.
 *  - `http(s):` (the dev server only) — the same origin; Vite serves modules from many paths.
 */
export function isAppUrl(url: string, appUrl: string): boolean {
  const a = parse(url);
  const b = parse(appUrl);
  if (!a || !b) return false;
  if (b.protocol === 'file:') {
    return a.protocol === 'file:' && a.host === b.host && decodeURI(a.pathname) === decodeURI(b.pathname);
  }
  if (b.protocol === 'http:' || b.protocol === 'https:') return a.origin === b.origin;
  return false;
}

/** What `shell.openExternal` may be handed from a window-open request: a web page, nothing else. */
export function isExternalWebUrl(url: string): boolean {
  const u = parse(url);
  return u !== null && u.protocol === 'https:' && u.hostname.length > 0;
}

/**
 * The permissions the renderer may have. Copy diagnostics writes to the clipboard through
 * `navigator.clipboard.writeText`, which Chromium checks as `clipboard-sanitized-write`.
 */
const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write']);

export function permissionAllowed(permission: string, fromAppPage: boolean): boolean {
  return fromAppPage && ALLOWED_PERMISSIONS.has(permission);
}

/** The slice of `IpcMainInvokeEvent` the sender check reads. */
export interface IpcSenderLike {
  senderFrame?: { url: string; parent: unknown } | null;
}

/**
 * True when an IPC call came from the app's own page, in its top frame. A missing frame (it
 * navigated or was destroyed while the call was in flight) is not trusted.
 */
export function isTrustedSender(event: IpcSenderLike, appUrl: string): boolean {
  try {
    const frame = event.senderFrame;
    if (!frame) return false;
    if (frame.parent) return false;
    return isAppUrl(frame.url, appUrl);
  } catch {
    // Electron throws from a WebFrameMain whose render frame was disposed mid-call.
    return false;
  }
}

/** For a log line: the scheme and host of a refused URL, never its path (it can name the user). */
export function describeUrl(url: string): string {
  const u = parse(url);
  if (!u) return 'unparseable';
  return u.host ? `${u.protocol}//${u.host}` : u.protocol;
}

export interface GuardLog {
  warn(name: string, fields: Record<string, unknown>): void;
}

/**
 * The per-window guards. `openExternal` is `shell.openExternal`, injected so the https-only
 * decision is the only way a URL reaches it from here.
 */
export function guardWindow(
  win: BrowserWindow,
  appUrl: string,
  deps: { openExternal(url: string): Promise<void>; log: GuardLog },
): void {
  const contents = win.webContents;
  const refuse = (kind: string) => (event: { preventDefault(): void }, url: string) => {
    if (isAppUrl(url, appUrl)) return;
    event.preventDefault();
    deps.log.warn('security.navigation_refused', { kind, to: describeUrl(url) });
  };
  contents.on('will-navigate', refuse('navigate'));
  contents.on('will-redirect', refuse('redirect'));
  contents.on('will-frame-navigate', (event) => {
    // Subframes have no business existing; the top frame is covered by will-navigate.
    if (event.isMainFrame) return;
    if (isAppUrl(event.url, appUrl)) return;
    event.preventDefault();
    deps.log.warn('security.navigation_refused', { kind: 'frame', to: describeUrl(event.url) });
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebUrl(url)) void deps.openExternal(url).catch(() => undefined);
    else deps.log.warn('security.window_open_refused', { to: describeUrl(url) });
    return { action: 'deny' };
  });
}

/**
 * The app-wide guards: every `webContents` ever created (there should only be the one) gets no
 * webviews and no windows, and the default session grants only what `permissionAllowed` says.
 */
export function installAppGuards(deps: {
  app: { on(event: 'web-contents-created', fn: (e: unknown, contents: WebContents) => void): unknown };
  session: Session;
  isAppContents(contents: WebContents | null): boolean;
  log: GuardLog;
}): void {
  deps.app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
      deps.log.warn('security.webview_refused', {});
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
  deps.session.setPermissionRequestHandler((contents, permission, callback) => {
    const ok = permissionAllowed(permission, deps.isAppContents(contents));
    if (!ok) deps.log.warn('security.permission_refused', { permission });
    callback(ok);
  });
  deps.session.setPermissionCheckHandler((contents, permission) =>
    permissionAllowed(permission, deps.isAppContents(contents)),
  );
}

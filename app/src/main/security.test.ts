/**
 * The window guards and the IPC sender check (release review P0-3): the pure decisions, plus the
 * wiring against a fake `webContents`.
 */
import { describe, expect, it } from 'vitest';
import {
  appEntryUrl,
  describeUrl,
  guardWindow,
  installAppGuards,
  isAppUrl,
  isExternalWebUrl,
  isTrustedSender,
  permissionAllowed,
} from './security.js';

const APP = 'file:///Applications/ChatterED.app/Contents/Resources/app.asar/dist/renderer/index.html';
const SPACED = 'file:///Users/x/My%20Apps/ChatterED.app/Contents/Resources/app.asar/dist/renderer/index.html';
const DEV = 'http://localhost:5273';

describe('isAppUrl', () => {
  it('accepts the app page itself, with or without a hash or query', () => {
    expect(isAppUrl(APP, APP)).toBe(true);
    expect(isAppUrl(`${APP}#settings`, APP)).toBe(true);
    expect(isAppUrl(`${APP}?x=1`, APP)).toBe(true);
    expect(isAppUrl(SPACED, SPACED)).toBe(true);
  });

  it('refuses any other local file — under file://, "same origin" would be all of them', () => {
    expect(isAppUrl('file:///Users/x/Downloads/lecture.pdf', APP)).toBe(false);
    expect(isAppUrl('file:///Users/x/Downloads/evil.html', APP)).toBe(false);
    expect(isAppUrl(APP.replace('index.html', 'other.html'), APP)).toBe(false);
  });

  it('refuses the web, other schemes and garbage', () => {
    expect(isAppUrl('https://example.com/', APP)).toBe(false);
    expect(isAppUrl('javascript:alert(1)', APP)).toBe(false);
    expect(isAppUrl('data:text/html,hi', APP)).toBe(false);
    expect(isAppUrl('not a url', APP)).toBe(false);
  });

  it('accepts the dev server by origin, and nothing else from localhost', () => {
    expect(isAppUrl('http://localhost:5273/', DEV)).toBe(true);
    expect(isAppUrl('http://localhost:5273/src/main.ts', DEV)).toBe(true);
    expect(isAppUrl('http://localhost:8080/', DEV)).toBe(false);
    expect(isAppUrl(APP, DEV)).toBe(false);
  });

  it('builds the entry from the dev server when there is one, else the file', () => {
    expect(appEntryUrl(null, APP)).toBe(APP);
    expect(appEntryUrl(DEV, APP)).toBe(DEV);
  });
});

describe('what may be handed to the default browser', () => {
  it('is https only', () => {
    expect(isExternalWebUrl('https://github.com/lucasisnotcool/ChatterED-releases#readme')).toBe(true);
    for (const url of [
      'http://example.com',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'mailto:someone@example.com',
      'smb://server/share',
      'x-apple.systempreferences:',
      'https://',
      '',
    ]) {
      expect(isExternalWebUrl(url), url).toBe(false);
    }
  });
});

describe('permissions', () => {
  it('grants only a clipboard write, and only to the app page', () => {
    expect(permissionAllowed('clipboard-sanitized-write', true)).toBe(true);
    expect(permissionAllowed('clipboard-sanitized-write', false)).toBe(false);
    for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal', 'hid']) {
      expect(permissionAllowed(p, true), p).toBe(false);
    }
  });
});

describe('isTrustedSender', () => {
  it('trusts the app page in its top frame', () => {
    expect(isTrustedSender({ senderFrame: { url: APP, parent: null } }, APP)).toBe(true);
  });

  it('refuses a foreign page, a subframe, and a missing or disposed frame', () => {
    expect(isTrustedSender({ senderFrame: { url: 'file:///tmp/evil.html', parent: null } }, APP)).toBe(false);
    expect(isTrustedSender({ senderFrame: { url: APP, parent: {} } }, APP)).toBe(false);
    expect(isTrustedSender({ senderFrame: null }, APP)).toBe(false);
    expect(isTrustedSender({}, APP)).toBe(false);
    const disposed = {
      get senderFrame(): never {
        throw new Error('Render frame was disposed before WebFrameMain could be accessed');
      },
    };
    expect(isTrustedSender(disposed, APP)).toBe(false);
  });

  it('logs only the scheme and host of a refused URL', () => {
    expect(describeUrl('file:///Users/someone/Downloads/x.html')).toBe('file:');
    expect(describeUrl('https://evil.example/path?q=1')).toBe('https://evil.example');
    expect(describeUrl('nope')).toBe('unparseable');
  });
});

/** A `webContents` that records its listeners, so the guards can be driven. */
function fakeContents() {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  let openHandler: ((d: { url: string }) => { action: string }) | null = null;
  return {
    on(event: string, fn: (...args: unknown[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
      return this;
    },
    setWindowOpenHandler(fn: (d: { url: string }) => { action: string }) {
      openHandler = fn;
    },
    emit(event: string, ...args: unknown[]) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
    open(url: string) {
      return openHandler!({ url });
    },
  };
}

function preventable(extra: Record<string, unknown> = {}) {
  return { prevented: false, preventDefault() { this.prevented = true; }, ...extra };
}

describe('guardWindow', () => {
  function setup() {
    const contents = fakeContents();
    const opened: string[] = [];
    const warned: string[] = [];
    guardWindow({ webContents: contents } as never, APP, {
      openExternal: async (url) => void opened.push(url),
      log: { warn: (name) => void warned.push(name) },
    });
    return { contents, opened, warned };
  }

  it('keeps the window on the app page when a file is dropped or a link followed', () => {
    const { contents, warned } = setup();
    for (const [event, url] of [
      ['will-navigate', 'file:///Users/x/Downloads/lecture.pdf'],
      ['will-navigate', 'file:///Users/x/Downloads/evil.html'],
      ['will-redirect', 'https://example.com/'],
    ] as const) {
      const e = preventable();
      contents.emit(event, e, url);
      expect(e.prevented, `${event} ${url}`).toBe(true);
    }
    expect(warned).toEqual(Array(3).fill('security.navigation_refused'));
  });

  it('lets the app page reload itself', () => {
    const { contents } = setup();
    const e = preventable();
    contents.emit('will-navigate', e, `${APP}#x`);
    expect(e.prevented).toBe(false);
  });

  it('refuses a subframe navigation away from the app', () => {
    const { contents } = setup();
    const sub = preventable({ isMainFrame: false, url: 'https://example.com/' });
    contents.emit('will-frame-navigate', sub);
    expect(sub.prevented).toBe(true);
    const main = preventable({ isMainFrame: true, url: 'https://example.com/' });
    contents.emit('will-frame-navigate', main);
    expect(main.prevented).toBe(false); // will-navigate is the top frame's guard
  });

  it('never opens a window; sends https to the browser and drops everything else', () => {
    const { contents, opened, warned } = setup();
    expect(contents.open('https://example.com/a')).toEqual({ action: 'deny' });
    expect(contents.open('file:///etc/hosts')).toEqual({ action: 'deny' });
    expect(contents.open('javascript:alert(1)')).toEqual({ action: 'deny' });
    expect(opened).toEqual(['https://example.com/a']);
    expect(warned).toEqual(['security.window_open_refused', 'security.window_open_refused']);
  });
});

describe('installAppGuards', () => {
  it('refuses webviews and windows from any webContents, and grants only the clipboard to the app', () => {
    let created: ((e: unknown, c: unknown) => void) | null = null;
    let request: ((c: unknown, p: string, cb: (ok: boolean) => void) => void) | null = null;
    let check: ((c: unknown, p: string) => boolean) | null = null;
    const appContents = {};
    installAppGuards({
      app: { on: (_event: string, fn: (e: unknown, c: unknown) => void) => (created = fn) } as never,
      session: {
        setPermissionRequestHandler: (fn: typeof request) => (request = fn),
        setPermissionCheckHandler: (fn: typeof check) => (check = fn),
      } as never,
      isAppContents: (c) => c === appContents,
      log: { warn: () => undefined },
    });

    const other = fakeContents();
    created!({}, other);
    const attach = preventable();
    other.emit('will-attach-webview', attach);
    expect(attach.prevented).toBe(true);
    expect(other.open('https://example.com')).toEqual({ action: 'deny' });

    const answers: boolean[] = [];
    request!(appContents, 'clipboard-sanitized-write', (ok) => answers.push(ok));
    request!(appContents, 'media', (ok) => answers.push(ok));
    request!(other, 'clipboard-sanitized-write', (ok) => answers.push(ok));
    expect(answers).toEqual([true, false, false]);
    expect(check!(appContents, 'clipboard-sanitized-write')).toBe(true);
    expect(check!(appContents, 'geolocation')).toBe(false);
  });
});

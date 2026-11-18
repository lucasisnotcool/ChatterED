/**
 * The debug report's Electron half (`index.ts`): the shortcut it catches before the page, and the
 * hook the startup-failure dialog loads (`update/failure.ts` requires `debug/index.js`).
 */
import { describe, expect, it } from 'vitest';
import { buildDebugReport, matchesShortcut, registerDebugSection, safeReport } from './index.js';
import { DEBUG_ACCELERATOR } from '../../shared/debug.js';
import { parseReport } from './wire.js';

const key = (over: Partial<Parameters<typeof matchesShortcut>[0]>) => ({
  type: 'keyDown',
  key: 'D',
  code: 'KeyD',
  meta: true,
  control: false,
  shift: true,
  alt: false,
  ...over,
});

describe('the shortcut', () => {
  it('is ⇧⌘D on a Mac, and nothing near it', () => {
    expect(DEBUG_ACCELERATOR).toBe('CommandOrControl+Shift+D');
    expect(matchesShortcut(key({}), 'darwin')).toBe(true);
    expect(matchesShortcut(key({ key: 'd' }), 'darwin')).toBe(true);
    // ⌥⌘D (the Dock, and the app's own turn log), ⌃⌘D (Look Up), ⌘D, a repeat, a key-up.
    expect(matchesShortcut(key({ shift: false, alt: true }), 'darwin')).toBe(false);
    expect(matchesShortcut(key({ shift: false, control: true }), 'darwin')).toBe(false);
    expect(matchesShortcut(key({ shift: false }), 'darwin')).toBe(false);
    expect(matchesShortcut(key({ alt: true }), 'darwin')).toBe(false);
    expect(matchesShortcut(key({ control: true }), 'darwin')).toBe(false);
    expect(matchesShortcut(key({ isAutoRepeat: true }), 'darwin')).toBe(false);
    expect(matchesShortcut(key({ type: 'keyUp' }), 'darwin')).toBe(false);
    expect(matchesShortcut(key({ key: 'Î', code: 'KeyD' }), 'darwin')).toBe(true);
    expect(matchesShortcut(key({ key: 'e', code: 'KeyE' }), 'darwin')).toBe(false);
  });

  it('is ⇧Ctrl+D elsewhere', () => {
    expect(matchesShortcut(key({ meta: false, control: true }), 'linux')).toBe(true);
    expect(matchesShortcut(key({}), 'linux')).toBe(false);
  });
});

describe('the hook for the startup-failure dialog', () => {
  it('buildDebugReport() takes no arguments, needs no Electron app, and always returns a checked report', () => {
    // Under plain Node there is no app: no userData, no log folder. It still says so, and checks out.
    const text = buildDebugReport();
    const r = parseReport(text);
    expect(r.integrity).toBe('complete');
    expect(r.sections.install!.id).toBe('none (no userData)');
    expect(safeReport().startsWith('CHATTERED-DEBUG v1\n')).toBe(true);
  });

  it('carries what the updater registers', () => {
    const off = registerDebugSection('update', () => ({ lastCheck: 'ok', badBuilds: [58] }));
    try {
      expect(parseReport(buildDebugReport()).sections.update).toEqual({ 'last-check': 'ok', 'bad-builds': '58' });
    } finally {
      off();
    }
  });
});

/**
 * The application menu (ui-review-code.md §4, §5.9).
 *
 * Two things this file exists to stop coming back: ⌘+ / ⌘− / ⌘0 belonging to Chromium's page
 * zoom — which scales the nav rail and the composer rather than the PDF — and Reload / Force
 * Reload / Toggle Developer Tools shipping to a learner in a live study session.
 *
 * `electron` is mocked because the template is built under plain Node; `buildMenuTemplate` takes
 * `isPackaged` as an argument for exactly this reason.
 */
import { describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';

vi.mock('electron', () => ({
  app: { isPackaged: false },
  Menu: { setApplicationMenu: () => undefined, buildFromTemplate: (t: unknown) => t },
  shell: { openExternal: () => Promise.resolve() },
}));

const { buildMenuTemplate, DEFAULT_TEXT_SCALE, TEXT_STEPS, largerText, readTextScale, smallerText } =
  await import('./menu.js');

interface Sent {
  command: string;
}

function harness(isPackaged: boolean) {
  const sent: string[] = [];
  const zoom: { modes: string[]; factors: number[] } = { modes: [], factors: [] };
  let stored = DEFAULT_TEXT_SCALE;
  const win = {
    webContents: {
      send: (_channel: string, command: string) => {
        sent.push(command);
      },
      setZoomMode: (mode: string) => zoom.modes.push(mode),
      setZoomFactor: (factor: number) => zoom.factors.push(factor),
    },
  };
  const template = buildMenuTemplate({
    getWindow: () => win as never,
    isPackaged,
    getTextScale: () => stored,
    setTextScale: (value: number) => {
      stored = value;
    },
  });
  return { sent, template, zoom, scale: () => stored };
}

function submenu(template: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
  const menu = template.find((m) => m.label === label || m.role === label.toLowerCase());
  return (menu?.submenu as MenuItemConstructorOptions[] | undefined) ?? [];
}

function items(template: MenuItemConstructorOptions[], label: string): string[] {
  return submenu(template, label)
    .map((i) => i.label ?? i.role ?? '')
    .filter(Boolean);
}

function click(template: MenuItemConstructorOptions[], menu: string, label: string): void {
  const item = submenu(template, menu).find((i) => i.label === label);
  if (!item?.click) throw new Error(`No clickable "${label}" in ${menu}`);
  (item.click as (...args: never[]) => void)();
}

describe('the application menu', () => {
  it('has the five menus a Mac app has', () => {
    const { template } = harness(false);
    const labels = template.map((m) => m.label ?? m.role);
    expect(labels).toEqual(['appMenu', 'File', 'editMenu', 'View', 'windowMenu', 'help']);
  });

  it('claims ⌘+, ⌘− and ⌘0 and routes them to the viewer, not to Chromium', () => {
    const { template, sent } = harness(false);
    const view = submenu(template, 'View');
    const accelerators = view.map((i) => i.accelerator).filter(Boolean);
    expect(accelerators).toContain('CommandOrControl+Plus');
    expect(accelerators).toContain('CommandOrControl+-');
    expect(accelerators).toContain('CommandOrControl+0');
    // None of them may be an Electron zoom role — those are the page-zoom ones.
    expect(view.map((i) => i.role)).not.toContain('zoomIn');
    expect(view.map((i) => i.role)).not.toContain('zoomOut');
    expect(view.map((i) => i.role)).not.toContain('resetZoom');

    click(template, 'View', 'Zoom Out');
    click(template, 'View', 'Actual Size');
    expect(sent).toEqual(['zoom.out', 'zoom.reset']);
  });

  it('carries a hidden ⌘= duplicate, because ⌘+ arrives as = on a US layout', () => {
    const { template } = harness(false);
    const zoomIns = submenu(template, 'View').filter((i) => i.label === 'Zoom In');
    expect(zoomIns).toHaveLength(2);
    expect(zoomIns.map((i) => i.accelerator)).toEqual(['CommandOrControl+Plus', 'CommandOrControl+=']);
    expect(zoomIns[1]!.visible).toBe(false);
  });

  it('offers both fits and both page turns', () => {
    const { template, sent } = harness(false);
    const labels = items(template, 'View');
    expect(labels).toContain('Fit Width');
    expect(labels).toContain('Fit Page');
    expect(labels).toContain('Next Page');
    expect(labels).toContain('Previous Page');
    click(template, 'View', 'Fit Page');
    click(template, 'View', 'Next Page');
    click(template, 'View', 'Previous Page');
    expect(sent).toEqual(['fit.page', 'page.next', 'page.prev']);
  });

  it('ships Reload and DevTools in a dev build', () => {
    const labels = items(harness(false).template, 'View');
    expect(labels).toContain('reload');
    expect(labels).toContain('forceReload');
    expect(labels).toContain('toggleDevTools');
  });

  it('ships none of them in the installed app', () => {
    const labels = items(harness(true).template, 'View');
    expect(labels).not.toContain('reload');
    expect(labels).not.toContain('forceReload');
    expect(labels).not.toContain('toggleDevTools');
    // …and the zoom items are still all there.
    expect(labels).toContain('Actual Size');
    expect(labels).toContain('Fit Width');
  });

  it('puts the vault on the File menu, where a Mac user looks for it', () => {
    const { template, sent } = harness(true);
    expect(items(template, 'File')).toEqual([
      'Open Vault…',
      'Re-scan Vault',
      'Edit Topics…',
      'Find a File…',
      'close',
    ]);
    click(template, 'File', 'Open Vault…');
    expect(sent).toEqual(['vault.open']);
  });

  it('sends nothing at all when there is no window', () => {
    const template = buildMenuTemplate({ getWindow: () => null, isPackaged: true });
    const item = (template.find((m) => m.label === 'View')!.submenu as MenuItemConstructorOptions[]).find(
      (i) => i.label === 'Actual Size',
    )!;
    expect(() => (item.click as (...a: never[]) => void)()).not.toThrow();
  });
});

/**
 * **UI text size** — the accessibility control the app did not have.
 *
 * ⌘+ was taken away from Chromium on purpose (it belongs to the document), which left no way at
 * all to make the *interface* larger. These items are the other zoom, and the two must stay
 * distinguishable in the menu and unconfusable in the code: nothing here may send an
 * `AppCommand`, and nothing above may touch `setZoomFactor`.
 */
describe('the interface text size', () => {
  it('offers Larger, Smaller and Default under their own heading', () => {
    const labels = items(harness(false).template, 'View');
    expect(labels).toContain('Interface');
    expect(labels).toContain('Larger Text');
    expect(labels).toContain('Smaller Text');
    expect(labels).toContain('Default Text');
    // The heading is a label, never something you can click into.
    const heading = submenu(harness(false).template, 'View').find((i) => i.label === 'Interface');
    expect(heading?.enabled).toBe(false);
    expect(heading?.click).toBeUndefined();
  });

  it('binds ⌥⌘+ / ⌥⌘− / ⌥⌘0, which are not the document zoom', () => {
    const view = submenu(harness(false).template, 'View');
    const accel = (label: string) => view.filter((i) => i.label === label).map((i) => i.accelerator);
    expect(accel('Larger Text')).toEqual(['Alt+CommandOrControl+Plus', 'Alt+CommandOrControl+=']);
    expect(accel('Smaller Text')).toEqual(['Alt+CommandOrControl+-']);
    expect(accel('Default Text')).toEqual(['Alt+CommandOrControl+0']);
    // The hidden ⌥⌘= twin, same reason as Zoom In's.
    expect(view.filter((i) => i.label === 'Larger Text')[1]!.visible).toBe(false);
  });

  it('re-asserts the isolated zoom mode, because under "disabled" setZoomFactor does nothing', () => {
    const { template, zoom } = harness(false);
    click(template, 'View', 'Larger Text');
    // Measured live (main/index.ts): 'disabled' accepts setZoomFactor, reports it back, and
    // moves nothing; 'manual' waits for the next navigation; 'isolated' applies at once.
    expect(zoom.modes).toEqual(['isolated']);
    expect(zoom.factors).toEqual([1.1]);
  });

  it('walks the ladder from wherever it is and persists each step', () => {
    const { template, zoom, scale } = harness(false);
    click(template, 'View', 'Larger Text');
    click(template, 'View', 'Larger Text');
    expect(scale()).toBe(1.25);
    click(template, 'View', 'Smaller Text');
    expect(scale()).toBe(1.1);
    click(template, 'View', 'Default Text');
    expect(scale()).toBe(1);
    expect(zoom.factors).toEqual([1.1, 1.25, 1.1, 1]);
  });

  it('sends no AppCommand at all — the text size never reaches the renderer', () => {
    const { template, sent } = harness(false);
    click(template, 'View', 'Larger Text');
    click(template, 'View', 'Smaller Text');
    click(template, 'View', 'Default Text');
    expect(sent).toEqual([]);
  });

  it('stops at both ends of the ladder', () => {
    expect(largerText(2)).toBe(2);
    expect(smallerText(0.8)).toBe(0.8);
    expect(largerText(1)).toBe(1.1);
    expect(smallerText(1)).toBe(0.9);
    expect(TEXT_STEPS).toContain(DEFAULT_TEXT_SCALE);
  });

  it('survives a missing or corrupt stored factor', () => {
    expect(readTextScale(1.25)).toBe(1.25);
    expect(readTextScale(null)).toBe(DEFAULT_TEXT_SCALE);
    expect(readTextScale('nonsense')).toBe(DEFAULT_TEXT_SCALE);
    expect(readTextScale(9)).toBe(2);
    expect(readTextScale(0.01)).toBe(0.8);
  });

  it('does nothing, and throws nothing, when there is no window', () => {
    const template = buildMenuTemplate({ getWindow: () => null, isPackaged: true });
    const item = (template.find((m) => m.label === 'View')!.submenu as MenuItemConstructorOptions[]).find(
      (i) => i.label === 'Larger Text',
    )!;
    expect(() => (item.click as (...a: never[]) => void)()).not.toThrow();
  });
});

describe('what the menu is allowed to say', () => {
  it('only ever sends closed-union command strings', () => {
    const { template, sent } = harness(false);
    const allowed = new Set<Sent['command']>([
      'zoom.in',
      'zoom.out',
      'zoom.reset',
      'fit.width',
      'fit.page',
      'page.next',
      'page.prev',
      'vault.open',
      'vault.rescan',
      'topics.edit',
      'search.files',
      'settings.open',
    ]);
    for (const menu of ['File', 'View', 'help']) {
      for (const item of submenu(template, menu)) {
        if (item.click) (item.click as (...a: never[]) => void)();
      }
    }
    expect(sent.length).toBeGreaterThan(0);
    for (const command of sent) expect(allowed.has(command)).toBe(true);
  });
});

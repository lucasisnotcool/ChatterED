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

const shellCalls = vi.hoisted(() => ({ external: [] as string[], paths: [] as string[] }));

vi.mock('electron', () => ({
  app: { isPackaged: false },
  Menu: { setApplicationMenu: () => undefined, buildFromTemplate: (t: unknown) => t },
  shell: {
    openExternal: (url: string) => {
      shellCalls.external.push(url);
      return Promise.resolve();
    },
    openPath: (path: string) => {
      shellCalls.paths.push(path);
      return Promise.resolve('');
    },
  },
}));

const {
  buildMenuTemplate,
  DEFAULT_TEXT_SCALE,
  HELP_URL,
  REPORT_PROBLEM_MAILTO,
  TEXT_STEPS,
  largerText,
  readTextScale,
  smallerText,
} = await import('./menu.js');

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

  it('puts notebooks on the File menu, where a Mac user looks for New and Open', () => {
    const { template, sent } = harness(true);
    expect(items(template, 'File')).toEqual([
      'New Notebook',
      'Add Sources…',
      'Find a File…',
      'Regenerate Notes…',
      'New Conversation…',
      'Export Research Data…',
      'close',
    ]);
    const file = submenu(template, 'File');
    expect(file.find((i) => i.label === 'New Notebook')?.accelerator).toBe('CommandOrControl+N');
    expect(file.find((i) => i.label === 'Add Sources…')?.accelerator).toBe('CommandOrControl+Shift+O');
    click(template, 'File', 'New Notebook');
    click(template, 'File', 'Add Sources…');
    expect(sent).toEqual(['notebook.new', 'notebook.addSources']);
  });

  /** The folder vault is gone (`notebooks.md` §1), and so is its menu. */
  it('has no vault items any more', () => {
    const labels = [...items(harness(true).template, 'File'), ...items(harness(true).template, 'View')];
    for (const gone of ['Open Vault…', 'Re-scan Vault', 'Edit Topics…']) expect(labels).not.toContain(gone);
  });

  it('goes home to the Notebooks grid from the View menu', () => {
    const { template, sent } = harness(true);
    expect(items(template, 'View')[0]).toBe('Notebooks');
    click(template, 'View', 'Notebooks');
    expect(sent).toEqual(['notebook.home']);
  });

  /** No two items may claim the same chord: ⌘N and ⇧⌘O must not shadow anything. */
  it('claims every accelerator once', () => {
    const seen = new Map<string, string>();
    const { template } = harness(false);
    for (const menu of ['File', 'View', 'help']) {
      for (const item of submenu(template, menu)) {
        if (!item.accelerator || item.visible === false) continue;
        const key = String(item.accelerator);
        expect(seen.get(key), `${key} on ${item.label} and ${seen.get(key)}`).toBeUndefined();
        seen.set(key, String(item.label));
      }
    }
  });

  /** The experimental trial: the export is a File-menu item, and it only asks the renderer. */
  it('offers Export Research Data on the File menu', () => {
    const { template, sent } = harness(true);
    click(template, 'File', 'Export Research Data…');
    expect(sent).toEqual(['research.export']);
  });

  /** 2026-09-23: both destructive, so both confirm in main, and neither has a key chord. */
  it('offers Regenerate Notes and New Conversation on the File menu, with no accelerator', () => {
    const { template, sent } = harness(true);
    const file = template.find((m) => m.label === 'File')!.submenu as MenuItemConstructorOptions[];
    for (const label of ['Regenerate Notes…', 'New Conversation…']) {
      expect(file.find((i) => i.label === label)?.accelerator).toBeUndefined();
    }
    click(template, 'File', 'Regenerate Notes…');
    click(template, 'File', 'New Conversation…');
    expect(sent).toEqual(['notes.regenerate', 'chat.reset']);
  });

  it('shows and hides the sources panel on the Mac sidebar chord, ⌃⌘S', () => {
    const { template, sent } = harness(true);
    const item = submenu(template, 'View').find((i) => i.label === 'Show or Hide Sources');
    expect(item?.accelerator).toBe('Control+Command+S');
    click(template, 'View', 'Show or Hide Sources');
    expect(sent).toEqual(['files.toggle']);
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

describe('the Help menu', () => {
  const NOTICES = '/Applications/ChatterED.app/Contents/Resources/THIRD_PARTY_NOTICES.txt';

  function helpFor(noticesPath: string | null) {
    const template = buildMenuTemplate({ getWindow: () => null, isPackaged: true, noticesPath });
    return { template, labels: items(template, 'help') };
  }

  it('opens the user guide in the public releases repo', () => {
    shellCalls.external.length = 0;
    const { template } = helpFor(null);
    click(template, 'help', 'How ChatterED Works');
    expect(shellCalls.external).toEqual(['https://github.com/lucasisnotcool/ChatterED-releases#readme']);
    expect(HELP_URL).toBe('https://github.com/lucasisnotcool/ChatterED-releases#readme');
  });

  it('starts a problem report to the research team, with the subject filled in', () => {
    shellCalls.external.length = 0;
    const { template } = helpFor(null);
    click(template, 'help', 'Report a Problem…');
    expect(shellCalls.external).toEqual(['mailto:lucasloh@u.nus.edu?subject=ChatterED%20problem%20report']);
    expect(REPORT_PROBLEM_MAILTO).toBe(shellCalls.external[0]);
  });

  it('opens the licence notices from the app bundle when they are there', () => {
    shellCalls.paths.length = 0;
    const { template, labels } = helpFor(NOTICES);
    expect(labels).toEqual(['Settings…', 'How ChatterED Works', 'Report a Problem…', 'Acknowledgements']);
    click(template, 'help', 'Acknowledgements');
    expect(shellCalls.paths).toEqual([NOTICES]);
  });

  it('has no Acknowledgements when there is no notices file (a dev build)', () => {
    expect(helpFor(null).labels).toEqual(['Settings…', 'How ChatterED Works', 'Report a Problem…']);
  });

  it('hands the shell only https and the one mailto, never anything else', () => {
    shellCalls.external.length = 0;
    const { template } = helpFor(NOTICES);
    for (const menu of ['appMenu', 'File', 'View', 'help']) {
      for (const item of submenu(template, menu)) {
        if (item.click) (item.click as (...a: never[]) => void)();
      }
    }
    expect(shellCalls.external.length).toBe(2);
    for (const url of shellCalls.external) expect(/^(https:\/\/|mailto:)/.test(url)).toBe(true);
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
      'notebook.new',
      'notebook.addSources',
      'notebook.home',
      'search.files',
      'settings.open',
      'notes.regenerate',
      'chat.reset',
      'files.toggle',
      'research.export',
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

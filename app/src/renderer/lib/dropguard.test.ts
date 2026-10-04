/**
 * The window-level drop guard (release review P0-3). Files drop only on a drop zone; text drops only
 * into editable fields, which is where the notes editor (ProseMirror) and the composer live.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  blockDrop,
  carriesFiles,
  carriesImage,
  createFileDrop,
  createImageDrop,
  dropAnchor,
  filesToPaths,
  imageFiles,
  installDropGuard,
  noPathNotice,
  NOT_AN_IMAGE_NOTICE,
} from './dropguard.js';

describe('blockDrop', () => {
  it('refuses anything carrying files, even over the editor', () => {
    expect(blockDrop(['Files'], { editable: false })).toBe(true);
    expect(blockDrop(['Files', 'text/uri-list'], { editable: true })).toBe(true);
  });

  it('lets text and HTML reach an editable target — ProseMirror drops, the composer', () => {
    expect(blockDrop(['text/plain'], { editable: true })).toBe(false);
    expect(blockDrop(['text/html', 'text/plain'], { editable: true })).toBe(false);
  });

  it('refuses a link or text dropped on the chrome, where the default would navigate', () => {
    expect(blockDrop(['text/uri-list', 'text/plain'], { editable: false })).toBe(true);
    expect(blockDrop([], { editable: false })).toBe(true);
    expect(blockDrop(null, { editable: false })).toBe(true);
  });
});

type Listener = (e: unknown) => void;

function fakeWindow() {
  const listeners = new Map<string, Listener[]>();
  return {
    addEventListener(type: string, fn: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    fire(type: string, event: unknown) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
}

function dragEvent(type: string, types: string[], target: Record<string, unknown>) {
  const dataTransfer = { types, dropEffect: 'copy' };
  return {
    type,
    target,
    dataTransfer,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

describe('installDropGuard', () => {
  const chrome = { tagName: 'DIV', isContentEditable: false };
  const editor = { tagName: 'P', isContentEditable: true };
  const composer = { tagName: 'TEXTAREA', isContentEditable: false };
  const checkbox = { tagName: 'INPUT', type: 'checkbox', isContentEditable: false };

  it('prevents a Finder PDF dropped on the chrome, and shows "not allowed" while dragging', () => {
    const win = fakeWindow();
    installDropGuard(win as never);
    const over = dragEvent('dragover', ['Files'], chrome);
    win.fire('dragover', over);
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe('none');
    const drop = dragEvent('drop', ['Files'], chrome);
    win.fire('drop', drop);
    expect(drop.defaultPrevented).toBe(true);
  });

  it('prevents a file dropped on the editor too — the notes have no file or image node', () => {
    const win = fakeWindow();
    installDropGuard(win as never);
    const drop = dragEvent('drop', ['Files'], editor);
    win.fire('drop', drop);
    expect(drop.defaultPrevented).toBe(true);
  });

  it('leaves a text drop on the editor or the composer alone', () => {
    const win = fakeWindow();
    installDropGuard(win as never);
    for (const target of [editor, composer]) {
      const over = dragEvent('dragover', ['text/html', 'text/plain'], target);
      win.fire('dragover', over);
      expect(over.defaultPrevented).toBe(false);
      expect(over.dataTransfer.dropEffect).toBe('copy');
      const drop = dragEvent('drop', ['text/plain'], target);
      win.fire('drop', drop);
      expect(drop.defaultPrevented).toBe(false);
    }
  });

  it('does not treat a checkbox as a text field', () => {
    const win = fakeWindow();
    installDropGuard(win as never);
    const drop = dragEvent('drop', ['text/plain'], checkbox);
    win.fire('drop', drop);
    expect(drop.defaultPrevented).toBe(true);
  });
});

describe('drop zones (notebooks.md §1)', () => {
  /** A target inside an element marked `data-dropzone`, as the DOM's `closest` would find it. */
  const inZone = (base: Record<string, unknown>) => ({
    ...base,
    closest: (selector: string) => (selector === '[data-dropzone]' ? {} : null),
  });
  const outside = (base: Record<string, unknown>) => ({ ...base, closest: () => null });

  it('lets files through over a zone, and only over a zone', () => {
    expect(blockDrop(['Files'], { editable: false, dropzone: true })).toBe(false);
    expect(blockDrop(['Files'], { editable: true, dropzone: true })).toBe(false);
    expect(blockDrop(['Files'], { editable: false, dropzone: false })).toBe(true);
  });

  it('still refuses a text or link drag on a zone’s chrome — a zone takes files, not words', () => {
    expect(blockDrop(['text/uri-list'], { editable: false, dropzone: true })).toBe(true);
    expect(blockDrop(['text/plain'], { editable: true, dropzone: true })).toBe(false);
  });

  it('stands aside entirely over a zone, so the zone’s “copy” cursor is not overwritten', () => {
    const win = fakeWindow();
    installDropGuard(win as never);
    const over = dragEvent('dragover', ['Files'], inZone({ tagName: 'DIV', isContentEditable: false }));
    win.fire('dragover', over);
    expect(over.defaultPrevented).toBe(false);
    expect(over.dataTransfer.dropEffect).toBe('copy');
    const drop = dragEvent('drop', ['Files'], inZone({ tagName: 'P', isContentEditable: true }));
    win.fire('drop', drop);
    expect(drop.defaultPrevented).toBe(false);
  });

  it('refuses files outside every zone, as before', () => {
    const win = fakeWindow();
    installDropGuard(win as never);
    const drop = dragEvent('drop', ['Files'], outside({ tagName: 'NAV', isContentEditable: false }));
    win.fire('drop', drop);
    expect(drop.defaultPrevented).toBe(true);
  });
});

describe('carriesFiles', () => {
  it('is true only for a drag that carries files', () => {
    expect(carriesFiles(['Files', 'text/plain'])).toBe(true);
    expect(carriesFiles(['text/plain'])).toBe(false);
    expect(carriesFiles(null)).toBe(false);
  });
});

describe('filesToPaths', () => {
  const file = (name: string, path: string) => ({ name, path });
  const pathFor = (f: { path: string }) => f.path;

  it('turns a drop into absolute paths, once each', () => {
    const out = filesToPaths([file('a.pdf', '/x/a.pdf'), file('b.md', '/x/b.md'), file('a.pdf', '/x/a.pdf')], pathFor);
    expect(out).toEqual({ paths: ['/x/a.pdf', '/x/b.md'], refused: [] });
  });

  it('refuses, by name, a file with no path on disk — an empty string from the preload', () => {
    const out = filesToPaths([file('a.pdf', '/x/a.pdf'), file('clip.png', '')], pathFor);
    expect(out).toEqual({ paths: ['/x/a.pdf'], refused: ['clip.png'] });
  });

  it('treats a preload that throws like one with no path', () => {
    const out = filesToPaths([file('a.pdf', '')], () => {
      throw new Error('no webUtils');
    });
    expect(out).toEqual({ paths: [], refused: ['a.pdf'] });
  });

  it('says which file did not go in, and what to do', () => {
    expect(noPathNotice([])).toBeNull();
    expect(noPathNotice(['clip.png'])).toBe('“clip.png” could not be added: save it to your Mac first, then drop it again.');
    expect(noPathNotice(['a', 'b'])).toContain('2 files could not be added');
  });
});

describe('createFileDrop', () => {
  const ev = (types: string[], files: { name: string }[] = []) => {
    const e = {
      dataTransfer: { types, dropEffect: 'none', files },
      prevented: false,
      stopped: false,
      preventDefault() {
        this.prevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
    };
    return e;
  };

  it('is over while any child holds the drag, and drops the files once', () => {
    const over: boolean[] = [];
    const dropped: string[][] = [];
    const zone = createFileDrop<{ name: string }>({ onover: (o) => over.push(o), ondrop: (f) => dropped.push(f.map((x) => x.name)) });
    zone.dragenter(ev(['Files']));
    zone.dragenter(ev(['Files'])); // a child
    zone.dragleave(ev(['Files'])); // left the parent for the child
    expect(over).toEqual([true]);
    const o = ev(['Files']);
    zone.dragover(o);
    expect(o.prevented).toBe(true);
    expect(o.dataTransfer.dropEffect).toBe('copy');
    const d = ev(['Files'], [{ name: 'a.pdf' }]);
    zone.drop(d);
    expect(d.prevented && d.stopped).toBe(true);
    expect(over).toEqual([true, false]);
    expect(dropped).toEqual([['a.pdf']]);
  });

  it('ignores a drag with no files, leaving it to the editor and the guard', () => {
    const zone = createFileDrop({ onover: () => undefined, ondrop: () => undefined });
    const e = ev(['text/plain']);
    zone.dragover(e);
    zone.drop(e);
    expect(e.prevented).toBe(false);
  });
});

describe('images dropped on a sheet (2026-10-04)', () => {
  type F = { name: string; type?: string };
  const ev = (items: { kind: string; type: string }[] | null, files: F[] = [], types = ['Files']) => ({
    dataTransfer: { types, dropEffect: 'none', files, items },
    clientX: 10,
    clientY: 20,
    target: null,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  });
  const png = { kind: 'file', type: 'image/png' };
  const pdf = { kind: 'file', type: 'application/pdf' };

  it('reads an image from the items while the drag is in the air, and says when it cannot tell', () => {
    expect(carriesImage([pdf, png])).toBe(true);
    expect(carriesImage([pdf])).toBe(false);
    expect(carriesImage([{ kind: 'string', type: 'image/png' }])).toBe(false);
    expect(carriesImage(null)).toBe(null);
  });

  it('keeps the images a notebook takes, by type or by extension', () => {
    const files: F[] = [
      { name: 'a.png', type: 'image/png' },
      { name: 'b.pdf', type: 'application/pdf' },
      { name: 'c.JPG', type: '' },
      { name: 'd.svg', type: 'image/svg+xml' },
      { name: 'e.webp' },
    ];
    expect(imageFiles(files).map((f) => f.name)).toEqual(['a.png', 'c.JPG', 'e.webp']);
  });

  it('copies an image into the sheet, at the drop point', () => {
    const over: (string | null)[] = [];
    const dropped: { names: string[]; x: number; y: number }[] = [];
    const zone = createImageDrop<F>({
      accept: () => true,
      onover: (o) => over.push(o),
      ondrop: (images, at) => dropped.push({ names: images.map((f) => f.name), x: at.x, y: at.y }),
      onrefuse: () => undefined,
    });
    zone.dragenter(ev([png]));
    const o = ev([png]);
    zone.dragover(o);
    expect(o.prevented).toBe(true);
    expect(o.dataTransfer.dropEffect).toBe('copy');
    const d = ev([png], [{ name: 'fig.png', type: 'image/png' }, { name: 'x.pdf', type: 'application/pdf' }]);
    zone.drop(d);
    expect(d.prevented && d.stopped).toBe(true);
    expect(over).toEqual(['image', null]);
    expect(dropped).toEqual([{ names: ['fig.png'], x: 10, y: 20 }]);
  });

  it('refuses a PDF on the sheet, but still stops Chromium opening it', () => {
    const refused: string[] = [];
    const over: (string | null)[] = [];
    const zone = createImageDrop<F>({
      accept: () => true,
      onover: (o) => over.push(o),
      ondrop: () => {
        throw new Error('not an image');
      },
      onrefuse: (n) => refused.push(n),
    });
    zone.dragenter(ev([pdf]));
    const o = ev([pdf]);
    zone.dragover(o);
    expect(o.prevented).toBe(true);
    expect(o.dataTransfer.dropEffect).toBe('none');
    const d = ev([pdf], [{ name: 'deck.pdf', type: 'application/pdf' }]);
    zone.drop(d);
    expect(d.prevented).toBe(true);
    // Said while it is over the sheet: with a "not allowed" cursor a real drop never fires.
    expect(over).toEqual(['refused', null]);
    expect(refused).toEqual([NOT_AN_IMAGE_NOTICE]);
  });

  it('clears the outline when the dragovers stop without a dragleave (Esc, a fast exit)', () => {
    vi.useFakeTimers();
    try {
      const over: (string | null)[] = [];
      const zone = createImageDrop<F>({ accept: () => true, onover: (o) => over.push(o), ondrop: () => undefined, onrefuse: () => undefined });
      zone.dragenter(ev([png]));
      zone.dragover(ev([png]));
      vi.advanceTimersByTime(300);
      zone.dragover(ev([png]));
      vi.advanceTimersByTime(300);
      expect(over).toEqual(['image']);
      vi.advanceTimersByTime(200);
      expect(over).toEqual(['image', null]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes nothing while the sheet is not on screen, and leaves text drags to the editor', () => {
    const zone = createImageDrop<F>({ accept: () => false, onover: () => undefined, ondrop: () => undefined, onrefuse: () => undefined });
    const o = ev([png]);
    zone.dragover(o);
    expect(o.dataTransfer.dropEffect).toBe('none');
    const text = ev(null, [], ['text/plain']);
    zone.dragover(text);
    zone.drop(text);
    expect(text.prevented).toBe(false);
  });

  it('puts the image after the block it was dropped on, or after the last one above the point', () => {
    const blocks = [
      { id: 'b1', top: 0 },
      { id: null, top: 40 },
      { id: 'b3', top: 80 },
    ];
    expect(dropAnchor(blocks, -5)).toBe(null);
    expect(dropAnchor(blocks, 10)).toBe('b1');
    expect(dropAnchor(blocks, 50)).toBe('b1');
    expect(dropAnchor(blocks, 500)).toBe('b3');
    expect(dropAnchor([], 10)).toBe(null);
  });
});

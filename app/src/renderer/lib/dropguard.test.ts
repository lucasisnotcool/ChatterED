/**
 * The window-level drop guard (release review P0-3). Files drop only on a drop zone; text drops only
 * into editable fields, which is where the notes editor (ProseMirror) and the composer live.
 */
import { describe, expect, it } from 'vitest';
import { blockDrop, carriesFiles, filesToPaths, installDropGuard, noPathNotice } from './dropguard.js';

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

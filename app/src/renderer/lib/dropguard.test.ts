/**
 * The window-level drop guard (release review P0-3). Files never drop anywhere; text drops only
 * into editable fields, which is where the notes editor (ProseMirror) and the composer live.
 */
import { describe, expect, it } from 'vitest';
import { blockDrop, installDropGuard } from './dropguard.js';

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

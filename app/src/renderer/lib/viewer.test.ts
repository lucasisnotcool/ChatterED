import { describe, expect, it } from 'vitest';
import { isViewerCommand, registerViewer, runViewerCommand } from './viewer.js';

describe('the viewer command registry', () => {
  it('separates the commands a viewer owns from the ones the app owns', () => {
    expect(isViewerCommand('zoom.in')).toBe(true);
    expect(isViewerCommand('fit.page')).toBe(true);
    expect(isViewerCommand('page.prev')).toBe(true);
    expect(isViewerCommand('notebook.new')).toBe(false);
    expect(isViewerCommand('settings.open')).toBe(false);
  });

  it('says so when no document is open, instead of silently swallowing ⌘0', () => {
    expect(runViewerCommand('zoom.reset')).toBe(false);
  });

  it('delivers to the registered viewer', () => {
    const seen: string[] = [];
    const off = registerViewer((c) => seen.push(c));
    expect(runViewerCommand('fit.width')).toBe(true);
    expect(seen).toEqual(['fit.width']);
    off();
    expect(runViewerCommand('fit.width')).toBe(false);
  });

  it('keeps only the newest viewer, and an old teardown cannot unregister it', () => {
    const first: string[] = [];
    const second: string[] = [];
    const offFirst = registerViewer((c) => first.push(c));
    const offSecond = registerViewer((c) => second.push(c));
    runViewerCommand('page.next');
    expect(first).toEqual([]);
    expect(second).toEqual(['page.next']);
    // The first pane unmounting after the second has mounted must not take the second's
    // registration with it — Svelte tears down in that order when a viewer is replaced.
    offFirst();
    expect(runViewerCommand('page.next')).toBe(true);
    offSecond();
    expect(runViewerCommand('page.next')).toBe(false);
  });

  it('hands the keys back to the notes when the slide modal over them closes', () => {
    const notes: string[] = [];
    const modal: string[] = [];
    const offNotes = registerViewer((c) => notes.push(c));
    const offModal = registerViewer((c) => modal.push(c));
    runViewerCommand('zoom.in');
    offModal();
    runViewerCommand('zoom.in');
    expect(modal).toEqual(['zoom.in']);
    expect(notes).toEqual(['zoom.in']);
    offNotes();
    expect(runViewerCommand('zoom.in')).toBe(false);
  });

  it('lets a middle registration go without disturbing the one above it', () => {
    const top: string[] = [];
    const offBottom = registerViewer(() => undefined);
    const offTop = registerViewer((c) => top.push(c));
    offBottom();
    runViewerCommand('zoom.out');
    expect(top).toEqual(['zoom.out']);
    offTop();
    expect(runViewerCommand('zoom.out')).toBe(false);
  });
});

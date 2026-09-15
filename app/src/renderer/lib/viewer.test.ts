import { describe, expect, it } from 'vitest';
import { isViewerCommand, registerViewer, runViewerCommand } from './viewer.js';

describe('the viewer command registry', () => {
  it('separates the commands a viewer owns from the ones the app owns', () => {
    expect(isViewerCommand('zoom.in')).toBe(true);
    expect(isViewerCommand('fit.page')).toBe(true);
    expect(isViewerCommand('page.prev')).toBe(true);
    expect(isViewerCommand('vault.open')).toBe(false);
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
});

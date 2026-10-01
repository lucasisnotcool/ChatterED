import { describe, expect, it } from 'vitest';
import type { NotebookChange, NotebookSourceView } from '../../shared/notebook.js';
import { MockNotebooks, baseName, refusalFor } from './mockNotebooks.js';

/**
 * The dev mock's notebooks. Not product behaviour: the rules a renderer could otherwise be built
 * against wrongly — bases never reused, reading pushed to ready, refusals, the confirm.
 */
function setup(confirmAnswer = true) {
  const pushed: NotebookChange[] = [];
  const timers: (() => void)[] = [];
  const model = new MockNotebooks({
    push: (c) => pushed.push(c),
    later: (_ms, fn) => timers.push(fn),
    confirm: () => confirmAnswer,
  });
  const flush = () => timers.splice(0).forEach((fn) => fn());
  return { model, pushed, flush };
}

describe('MockNotebooks', () => {
  it('names a new notebook after its first file and reads each source to ready, pushed', () => {
    const { model, pushed, flush } = setup();
    const out = model.create({ paths: ['/Users/me/Lecture 5.pdf', '/Users/me/notes.md'] });
    expect(out.notebook.name).toBe('Lecture 5');
    expect(out.added.map((s) => s.status)).toEqual(['reading', 'reading']);
    // Reading: no pages and no base yet (main fixes the base at ready).
    expect(out.added.map((s) => s.pageCount)).toEqual([0, 0]);
    flush();
    const view = model.view(out.notebook.id)!;
    expect(view.sources.every((s) => s.status === 'ready')).toBe(true);
    expect(view.sources[1]!.pageBase).toBe(view.sources[0]!.pageCount);
    expect(pushed.at(-1)!.view!.sources.every((s) => s.status === 'ready')).toBe(true);
    expect(view.contextFingerprint).not.toBe('');
  });

  it('never reuses a removed source’s pages', () => {
    const { model, flush } = setup();
    const { notebook } = model.create({ paths: ['a.pdf', 'b.pdf'] });
    flush();
    const b = model.view(notebook.id)!.sources[1]!;
    model.removeSource({ notebookId: notebook.id, fileId: b.fileId });
    model.addSources({ notebookId: notebook.id, paths: ['c.pdf'] });
    flush();
    const c = model.view(notebook.id)!.sources.find((s) => s.name === 'c.pdf')!;
    expect(c.pageBase).toBe(b.pageBase + b.pageCount);
  });

  it('refuses Keynote, unknown types and duplicates, and adds the rest', () => {
    const { model } = setup();
    const { notebook } = model.create({ paths: ['a.pdf'] });
    const out = model.addSources({ notebookId: notebook.id, paths: ['talk.key', 'data.xyz', 'a.pdf', 'b.png'] });
    expect(out.refused.map((r) => r.reason)).toEqual(['unsupported', 'unsupported', 'duplicate']);
    expect(out.refused[0]!.message).toContain('Export it as a PDF first');
    expect(out.added.map((s) => s.name)).toEqual(['b.png']);
  });

  it('ticks and unticks, never a failed source, and All is one call', () => {
    const { model, flush } = setup();
    const { notebook, added } = model.create({ paths: ['a.pdf', 'broken.pdf'] });
    flush();
    expect(model.view(notebook.id)!.sources[1]).toMatchObject({ status: 'failed', enabled: false });
    const off = model.setEnabled({ notebookId: notebook.id, fileIds: added.map((s) => s.fileId), enabled: true });
    expect(off.sources.map((s) => s.enabled)).toEqual([true, false]);
  });

  it('asks before removing a source or deleting a notebook, and a no keeps both', () => {
    const { model } = setup(false);
    const { notebook, added } = model.create({ paths: ['a.pdf'] });
    expect(model.removeSource({ notebookId: notebook.id, fileId: added[0]!.fileId }).removed).toBe(false);
    expect(model.delete(notebook.id)).toBe(false);
    expect(model.has(notebook.id)).toBe(true);
  });

  it('pushes a null view for a deleted notebook, and sorts the list by last opened', () => {
    const { model, pushed } = setup();
    const source: NotebookSourceView = {
      fileId: 'f1', name: 'x.pdf', kind: 'pdf', pageBase: 0, pageCount: 3, enabled: true, status: 'ready', error: null, addedAt: '2026-09-01T00:00:00.000Z',
    };
    model.seed({ id: 'nb_old000000000', name: 'Old', sources: [source], subtitle: null, fill: null, updatedAt: '2026-09-01T00:00:00.000Z' });
    model.seed({ id: 'nb_new000000000', name: 'New', sources: [], subtitle: null, fill: 0.5, updatedAt: '2026-09-20T00:00:00.000Z' });
    expect(model.list().map((n) => n.name)).toEqual(['New', 'Old']);
    model.open('nb_old000000000');
    expect(model.list()[0]!.name).toBe('Old');
    expect(model.delete('nb_old000000000')).toBe(true);
    expect(pushed.at(-1)).toEqual({ notebookId: 'nb_old000000000', view: null });
  });
});

describe('helpers', () => {
  it('takes the last path component', () => {
    expect(baseName('/a/b/Lecture 5.pdf')).toBe('Lecture 5.pdf');
    expect(baseName('plain.md')).toBe('plain.md');
  });

  it('accepts what a notebook reads', () => {
    expect(refusalFor('a.docx', [])).toBeNull();
    expect(refusalFor('slides.pptx', [])?.reason).toBe('unsupported');
  });
});

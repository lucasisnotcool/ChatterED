import { describe, expect, it } from 'vitest';
import type { NotebookSourceView, NotebookSummary, NotebookView } from '../../shared/notebook.js';
import {
  FALLBACK_GREETING,
  allState,
  badgeTone,
  cardLine,
  contextLine,
  editedAgo,
  fillWidth,
  greetingOf,
  inUseLine,
  patchList,
  refusalNotice,
  sourceMeta,
  typeBadge, folderNotebookCount, moveTargets, notebooksIn } from './notebookview.js';
import type { FolderView } from '../../shared/folders.js';

function source(over: Partial<NotebookSourceView> = {}): NotebookSourceView {
  return {
    fileId: 'f1',
    name: 'Lecture-complex v4.0.pdf',
    kind: 'pdf',
    pageBase: 0,
    pageCount: 59,
    enabled: true,
    status: 'ready',
    error: null,
    addedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

describe('the context line (notebooks.md §2)', () => {
  it('counts ticked and ready over every source', () => {
    const sources = [source(), source({ fileId: 'f2' }), source({ fileId: 'f3', enabled: false })];
    expect(contextLine(sources)).toBe('Using 2 of 3 sources');
    expect(inUseLine(sources)).toBe('2 of 3 in use');
  });

  it('does not count a source that is still being read, though it is ticked', () => {
    expect(contextLine([source(), source({ fileId: 'f2', status: 'reading' })])).toBe('Using 1 of 2 sources');
    expect(contextLine([source({ status: 'failed' })])).toBe('Using 0 of 1 source');
  });

  it('says so when there is nothing yet', () => {
    expect(contextLine([])).toBe('No sources yet');
    expect(inUseLine([])).toBe('');
  });
});

describe('All', () => {
  it('is checked when every source is ticked, and a click unticks them all', () => {
    expect(allState([source(), source()])).toEqual({ checked: true, indeterminate: false, next: false });
  });

  it('is indeterminate when some are, and a click ticks them all', () => {
    expect(allState([source(), source({ enabled: false })])).toEqual({ checked: false, indeterminate: true, next: true });
  });

  it('is clear when none are, or there are none', () => {
    expect(allState([source({ enabled: false })])).toEqual({ checked: false, indeterminate: false, next: true });
    expect(allState([]).checked).toBe(false);
  });
});

describe('a source row', () => {
  it('badges the extension, four letters at most', () => {
    expect(typeBadge('Lecture.pdf')).toBe('PDF');
    expect(typeBadge('notes.markdown')).toBe('MARK');
    expect(typeBadge('README')).toBe('FILE');
    expect(badgeTone('a.PDF')).toBe('pdf');
    expect(badgeTone('a.docx')).toBe('doc');
    expect(badgeTone('a.png')).toBe('plain');
  });

  it('says pages for a PDF, parts for text, and image for an image', () => {
    expect(sourceMeta(source())).toBe('59 pages · ready');
    expect(sourceMeta(source({ pageCount: 1 }))).toBe('1 page · ready');
    expect(sourceMeta(source({ kind: 'text', pageCount: 3 }))).toBe('3 parts · ready');
    expect(sourceMeta(source({ kind: 'image', pageCount: 1 }))).toBe('image · ready');
  });

  it('says reading, failed, or not in use', () => {
    expect(sourceMeta(source({ status: 'reading' }))).toBe('Reading…');
    expect(sourceMeta(source({ status: 'failed' }))).toBe('Couldn’t read it');
    expect(sourceMeta(source({ enabled: false }))).toBe('59 pages · not in use');
  });
});

describe('a home card', () => {
  const now = Date.parse('2026-10-01T15:00:00');

  it('says how many sources and when it was edited', () => {
    expect(cardLine({ sourceCount: 3, updatedAt: '2026-10-01T09:00:00' }, now)).toBe('3 sources · edited today');
    expect(cardLine({ sourceCount: 1, updatedAt: '2026-09-30T09:00:00' }, now)).toBe('1 source · yesterday');
    expect(cardLine({ sourceCount: 0, updatedAt: '2026-09-28T09:00:00' }, now)).toBe('No sources · 3 days ago');
    expect(editedAgo('2026-09-22T09:00:00', now)).toBe('last week');
    expect(editedAgo('not a date', now)).toBe('');
  });

  it('draws the own-words fill as a width, empty before there is a tree', () => {
    expect(fillWidth(null)).toBe('0%');
    expect(fillWidth(0.404)).toBe('40%');
    expect(fillWidth(3)).toBe('100%');
  });
});

describe('patchList', () => {
  const summary = (id: string): NotebookSummary => ({
    id,
    name: id,
    sourceCount: 1,
    enabledCount: 1,
    subtitle: 'Real World Planning and Acting',
    fill: 0.2,
    updatedAt: '2026-09-01T00:00:00.000Z',
    openedAt: null,
    folderId: null,
  });
  const view = (id: string): NotebookView => ({
    id,
    name: 'Renamed',
    sources: [source(), source({ fileId: 'f2', enabled: false })],
    pageCount: 118,
    contextFingerprint: 'f1@0',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  });

  it('updates the card behind a pushed notebook, keeping what only main computes', () => {
    const out = patchList([summary('a'), summary('b')], 'b', view('b'));
    expect(out.known).toBe(true);
    expect(out.list[1]).toMatchObject({ name: 'Renamed', sourceCount: 2, enabledCount: 1, subtitle: 'Real World Planning and Acting', fill: 0.2 });
    expect(out.list[0]).toEqual(summary('a'));
  });

  it('drops a deleted notebook', () => {
    expect(patchList([summary('a'), summary('b')], 'a', null).list.map((n) => n.id)).toEqual(['b']);
  });

  it('asks for a reload when the notebook is new to the grid', () => {
    expect(patchList([summary('a')], 'c', view('c')).known).toBe(false);
  });
});

describe('greetingOf (contract C10)', () => {
  it('reads the overview’s greeting and its three starters', () => {
    const out = greetingOf({ greeting: ' Hi. ', starterQuestions: ['One?', '', 'Two?', 'Three?', 'Four?'] });
    expect(out).toEqual({ greeting: 'Hi.', starters: ['One?', 'Two?', 'Three?'] });
  });

  it('falls back to a static greeting with no overview, or a malformed one', () => {
    expect(greetingOf(null)).toEqual({ greeting: FALLBACK_GREETING, starters: [] });
    expect(greetingOf({ greeting: 7, starterQuestions: 'no' })).toEqual({ greeting: FALLBACK_GREETING, starters: [] });
  });
});

describe('refusalNotice', () => {
  const r = (name: string, message: string) => ({ name, reason: 'unsupported' as const, message });
  it('is main’s own sentence for one refusal, and the first plus a count for several', () => {
    expect(refusalNotice([])).toBeNull();
    expect(refusalNotice([r('a.key', 'Export it as a PDF first.')])).toBe('Export it as a PDF first.');
    expect(refusalNotice([r('a.key', 'Export it as a PDF first.'), r('b.key', 'x'), r('c', 'y')])).toBe(
      'Export it as a PDF first. (2 more not added.)',
    );
    expect(refusalNotice([r('a.key', '')])).toBe('“a.key” was not added.');
  });
});

describe('folders on the home', () => {
  const fv = (id: string, parentId: string | null, name = id): FolderView => ({
    id,
    parentId,
    name,
    ord: 0,
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z',
  });
  const folders = [fv('fd_cs', null, 'CS4246'), fv('fd_plan', 'fd_cs', 'Planning'), fv('fd_dec', 'fd_cs', 'Decision making'), fv('fd_other', null, 'CS3249')];
  const nb = (id: string, folderId: string | null): NotebookSummary => ({
    id,
    name: id,
    sourceCount: 1,
    enabledCount: 1,
    subtitle: null,
    fill: null,
    updatedAt: '2026-10-03T00:00:00.000Z',
    openedAt: null,
    folderId,
  });
  const list = [nb('nb_a', null), nb('nb_b', 'fd_cs'), nb('nb_c', 'fd_plan'), nb('nb_d', 'fd_plan')];

  it('shows a folder’s own notebooks, and counts its subfolders’ on its tile', () => {
    expect(notebooksIn(list, null).map((n) => n.id)).toEqual(['nb_a']);
    expect(notebooksIn(list, 'fd_plan').map((n) => n.id)).toEqual(['nb_c', 'nb_d']);
    expect(folderNotebookCount(folders, list, 'fd_cs')).toBe(3);
    expect(folderNotebookCount(folders, list, 'fd_other')).toBe(0);
  });

  it('offers a notebook every folder but the one it is in, indented as a tree', () => {
    expect(moveTargets(folders, { currentParent: 'fd_plan' })).toEqual([
      { folderId: null, label: 'Notebooks (top level)', depth: 0 },
      { folderId: 'fd_other', label: 'CS3249', depth: 0 },
      { folderId: 'fd_cs', label: 'CS4246', depth: 0 },
      { folderId: 'fd_dec', label: 'Decision making', depth: 1 },
    ]);
  });

  it('never offers a folder itself or anything inside it', () => {
    const targets = moveTargets(folders, { folderId: 'fd_cs', currentParent: null }).map((t) => t.folderId);
    expect(targets).toEqual(['fd_other']);
  });
});

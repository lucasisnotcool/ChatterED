import { describe, expect, it } from 'vitest';
import {
  citationLabel,
  contextFingerprint,
  isNotebookId,
  locatePage,
  nextPageBase,
  notebookContentKey,
  pageRanges,
  shortSourceName,
  sourceKindFor,
  virtualPageCount,
  type NotebookSourceView,
} from './notebook.js';

function source(over: Partial<NotebookSourceView>): NotebookSourceView {
  return {
    fileId: 'f_a',
    name: 'Lecture-complex v4.0.pdf',
    kind: 'pdf',
    pageBase: 0,
    pageCount: 59,
    enabled: true,
    status: 'ready',
    error: null,
    addedAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}

const lecture = source({});
const notes = source({ fileId: 'f_b', name: 'Lecture-complex Notes.pdf', pageBase: 59, pageCount: 10 });
const readme = source({ fileId: 'f_c', name: 'Tutorial 1 W3.md', kind: 'text', pageBase: 69, pageCount: 3 });

describe('notebook ids and keys', () => {
  it('recognises a notebook id and keys it', () => {
    expect(isNotebookId('nb_0123456789ab')).toBe(true);
    expect(isNotebookId('f_0123456789ab')).toBe(false);
    expect(isNotebookId(null)).toBe(false);
    expect(notebookContentKey('nb_x')).toBe('nb:nb_x');
  });

  it('knows which files it takes', () => {
    expect(sourceKindFor('a.PDF')).toBe('pdf');
    expect(sourceKindFor('notes.docx')).toBe('text');
    expect(sourceKindFor('fig.jpeg')).toBe('image');
    expect(sourceKindFor('deck.pptx')).toBeNull();
    expect(sourceKindFor('noext')).toBeNull();
  });
});

describe('the virtual deck', () => {
  it('counts to the end of the highest source, gaps included', () => {
    expect(virtualPageCount([])).toBe(0);
    expect(virtualPageCount([lecture, notes])).toBe(69);
    // The lecture was removed: its pages stay a gap, the count does not shrink.
    expect(virtualPageCount([notes])).toBe(69);
  });

  it('never reuses a base', () => {
    expect(nextPageBase([lecture, notes])).toBe(69);
    expect(nextPageBase([], 69)).toBe(69);
  });

  it('locates a notebook page in its source', () => {
    expect(locatePage([lecture, notes], 17)).toEqual({ source: lecture, localPage: 17 });
    expect(locatePage([lecture, notes], 62)).toEqual({ source: notes, localPage: 3 });
    expect(locatePage([notes], 17)).toBeNull();
    expect(locatePage([lecture], 0)).toBeNull();
    expect(locatePage([lecture], 60)).toBeNull();
  });

  it('fingerprints the ticked, ready sources whatever their order', () => {
    const a = contextFingerprint([lecture, notes]);
    expect(contextFingerprint([notes, lecture])).toBe(a);
    expect(contextFingerprint([lecture, { ...notes, enabled: false }])).not.toBe(a);
    expect(contextFingerprint([lecture, { ...notes, status: 'reading' }])).toBe(contextFingerprint([lecture]));
  });
});

describe('citation labels', () => {
  it('reads as it always has with one source', () => {
    expect(citationLabel([lecture], [17])).toBe('p. 17');
    expect(citationLabel([lecture], [23, 24, 9])).toBe('p. 9, 23–24');
  });

  it('names the source when there are several', () => {
    expect(citationLabel([lecture, notes], [17, 62])).toBe('Lecture-complex v4.0 p. 17 · Lecture-complex Notes p. 3');
    expect(citationLabel([lecture, notes, readme], [71])).toBe('Tutorial 1 W3 §2');
  });

  it('says when the source is gone', () => {
    expect(citationLabel([notes, readme], [17])).toBe('removed source');
    expect(citationLabel([lecture], [])).toBe('');
  });

  it('formats ranges and names', () => {
    expect(pageRanges([3, 7, 8, 9, 9])).toBe('3, 7–9');
    expect(shortSourceName('Lecture-complex v4.0.pdf')).toBe('Lecture-complex v4.0');
    expect(shortSourceName('A very long lecture file name indeed.pdf', 12)).toBe('A very long…');
  });
});

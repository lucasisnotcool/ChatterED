import { describe, expect, it } from 'vitest';
import { DEFAULT_COLUMNS, readColumns, SEARCH_HITS, SEARCH_NOTES_MIN, SEARCH_SLIDES, searchWidths, STRIP } from './searchlayout.js';

const W = 1600;

describe('the search page columns', () => {
  it('gives the slides their width, the notes the rest, and the hit list its own', () => {
    const w = searchWidths(W, DEFAULT_COLUMNS);
    expect(w.hits).toBe(SEARCH_HITS.initial);
    expect(w.slides).toBe(SEARCH_SLIDES.initial);
    expect(w.notes).toBe(W - SEARCH_HITS.initial - SEARCH_SLIDES.initial);
    expect(w.slides + w.notes + w.hits).toBe(W);
  });

  it('never changes the hit list when the slides or the notes are hidden', () => {
    const noSlides = searchWidths(W, { ...DEFAULT_COLUMNS, slides: false });
    const noNotes = searchWidths(W, { ...DEFAULT_COLUMNS, notes: false });
    const neither = searchWidths(W, { ...DEFAULT_COLUMNS, slides: false, notes: false });
    for (const w of [noSlides, noNotes, neither]) expect(w.hits).toBe(SEARCH_HITS.initial);
    expect(noSlides.slides).toBe(STRIP);
    expect(noSlides.notes).toBe(W - SEARCH_HITS.initial - STRIP);
    expect(noNotes.notes).toBe(STRIP);
    expect(noNotes.slides).toBe(W - SEARCH_HITS.initial - STRIP);
  });

  it('shares the hit list’s width between slides and notes when it is hidden', () => {
    const w = searchWidths(W, { ...DEFAULT_COLUMNS, hits: false });
    expect(w.hits).toBe(STRIP);
    expect(w.slides).toBe(SEARCH_SLIDES.initial);
    expect(w.notes).toBe(W - STRIP - SEARCH_SLIDES.initial);
  });

  it('keeps the notes usable however wide the slides were left', () => {
    const w = searchWidths(1100, { ...DEFAULT_COLUMNS, slidesWidth: 1500 });
    expect(w.notes).toBe(SEARCH_NOTES_MIN);
    expect(w.slidesBounds.max).toBe(1100 - SEARCH_HITS.initial - SEARCH_NOTES_MIN);
  });

  it('shows the notes alone in a window too narrow for both, without forgetting the slides', () => {
    const w = searchWidths(SEARCH_HITS.initial + SEARCH_SLIDES.min + SEARCH_NOTES_MIN - 1, DEFAULT_COLUMNS);
    expect(w.slidesSqueezed).toBe(true);
    expect(w.slides).toBe(STRIP);
    const roomy = searchWidths(W, DEFAULT_COLUMNS);
    expect(roomy.slidesSqueezed).toBe(false);
  });

  it('lets the hit list grow only while the columns beside it stay usable', () => {
    const w = searchWidths(1000, DEFAULT_COLUMNS);
    expect(w.hitsBounds.max).toBe(1000 - SEARCH_SLIDES.min - SEARCH_NOTES_MIN);
    const alone = searchWidths(1000, { ...DEFAULT_COLUMNS, slides: false, notes: false });
    expect(alone.hitsBounds.max).toBe(SEARCH_HITS.max);
  });

  it('reads a stored layout defensively', () => {
    expect(readColumns(null)).toEqual(DEFAULT_COLUMNS);
    expect(readColumns({ slides: false, slidesWidth: 99999, hitsWidth: 'x' })).toEqual({
      ...DEFAULT_COLUMNS,
      slides: false,
      slidesWidth: SEARCH_SLIDES.max,
    });
  });
});

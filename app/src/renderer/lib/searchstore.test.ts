import { describe, expect, it } from 'vitest';
import type { SearchHit } from '../../shared/search/types.js';
import { shownHits } from './searchstore.svelte.js';

const hit = (key: string, kind: 'note' | 'page', page: number | null, blockId: string | null): SearchHit => ({
  key,
  kind,
  notebookId: 'nb_a',
  notebookName: 'Lecture-complex v4.0',
  title: 'Real World Planning and Acting',
  section: [],
  heading: '',
  snippet: '',
  score: 0,
  page,
  blockId,
  blockIds: blockId ? [blockId] : [],
  pages: page === null ? [] : [page],
  alsoIn: [],
  via: 'text',
  explain: null,
});

describe('what each column shows', () => {
  const hits = [hit('n1', 'note', 13, 'b1'), hit('n2', 'note', 31, 'b2'), hit('p18', 'page', 18, 'b9'), hit('p13', 'page', 13, 'b1')];

  it('before a pick: the best-matching slide, and the best notes hit', () => {
    const s = shownHits(hits, null);
    expect(s.slide?.key).toBe('p18');
    expect(s.note?.key).toBe('n1');
  });

  it('a picked note shows the slide it came from; a picked slide shows the notes citing it', () => {
    expect(shownHits(hits, 'n2')).toEqual({ slide: hits[1], note: hits[1] });
    expect(shownHits(hits, 'p13')).toEqual({ slide: hits[3], note: hits[3] });
  });

  it('a pick with no slide or no citing note leaves that column empty', () => {
    const lone = [hit('n1', 'note', null, 'b1'), hit('p5', 'page', 5, null)];
    expect(shownHits(lone, 'n1').slide).toBeNull();
    expect(shownHits(lone, 'p5').note).toBeNull();
  });

  it('a pick that is no longer among the hits falls back to the best of each', () => {
    expect(shownHits(hits, 'gone').slide?.key).toBe('p18');
  });
});

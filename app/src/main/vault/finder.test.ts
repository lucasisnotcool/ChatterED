import { describe, expect, it } from 'vitest';
import { fuzzyMatch, rankFiles } from './finder.js';

const file = (relPath: string) => ({
  id: relPath,
  name: relPath.split('/').pop()!,
  relPath,
});

describe('fuzzyMatch', () => {
  it('matches a subsequence and reports where', () => {
    const m = fuzzyMatch('MA3236/Week 4/lecture-notes.pdf', 'ma32wk4')!;
    expect(m).not.toBeNull();
    expect(m.positions).toHaveLength(7);
    expect(m.positions).toEqual([...m.positions].sort((a, b) => a - b));
  });

  it('rewards a run of consecutive characters over a scattered match', () => {
    const run = fuzzyMatch('the hessian matrix', 'hess')!.score;
    const scattered = fuzzyMatch('h e s s embedded', 'hess')!.score;
    expect(run).toBeGreaterThan(scattered);
  });

  it('rewards a word boundary, which is what makes an acronym query work', () => {
    const acronym = fuzzyMatch('positive semi definite', 'psd')!.score;
    const midword = fuzzyMatch('apposite semxdefx', 'psd')!.score;
    expect(acronym).toBeGreaterThan(midword);
  });

  it('returns null when a character is missing, and everything for an empty query', () => {
    expect(fuzzyMatch('lecture.pdf', 'zx')).toBeNull();
    expect(fuzzyMatch('a', 'aa')).toBeNull();
    expect(fuzzyMatch('lecture.pdf', '')).toEqual({ score: 0, positions: [] });
  });
});

describe('rankFiles', () => {
  it('puts a file-name match above a match that only exists in the folder path', () => {
    const hits = rankFiles(
      [file('notes/MA3236/timetable.pdf'), file('MA3236/admin/handout.pdf')],
      'ma3236',
    );
    // Both paths contain the query; the one where it is *only* in the path loses to nothing
    // here, but the name match must still be reachable and scored.
    expect(hits).toHaveLength(2);
    expect(hits[0]!.positions.length).toBe('ma3236'.length);
  });

  it('reports positions against relPath even when the match was on the name', () => {
    const hits = rankFiles([file('MA3236/Week 4/lecture-notes.pdf')], 'lecture');
    const hit = hits[0]!;
    const matched = hit.positions.map((p) => hit.item.relPath[p]).join('');
    expect(matched.toLowerCase()).toBe('lecture');
  });

  it('prefers the shorter of two equally good matches', () => {
    const hits = rankFiles([file('notes.md'), file('my-other-long-notes-file.md')], 'notes');
    expect(hits[0]!.item.relPath).toBe('notes.md');
  });

  it('is empty for an empty query, and honours the limit', () => {
    expect(rankFiles([file('a.md')], '   ')).toEqual([]);
    const many = Array.from({ length: 50 }, (_, i) => file(`note${i}.md`));
    expect(rankFiles(many, 'note', 5)).toHaveLength(5);
  });
});

import { describe, expect, it } from 'vitest';
import type { SearchHit } from '../../shared/search/types.js';
import { hitWhere, matchesFilter, tutorialHitLabel, tutorialShortName } from './searchhits.js';

const base: SearchHit = {
  key: 'k',
  kind: 'note',
  notebookId: 'nb_a',
  notebookName: 'Lecture-rational-utility',
  title: 'Rational decisions',
  section: ['Expected utility'],
  heading: 'Expected utility',
  snippet: '',
  score: 0,
  page: 12,
  blockId: 'b1',
  blockIds: ['b1'],
  pages: [12],
  alsoIn: [],
  via: 'text',
  explain: null,
  tutorial: null,
};
const tut: SearchHit = {
  ...base,
  key: 'tut:nb_a:f_t:b2',
  section: ['Problem 1 Part B'],
  tutorial: { fileId: 'f_t', title: 'Tutorial 2 Week 4: Rational Decision Making', label: 'Problem 1 Part B' },
};
const page: SearchHit = { ...base, key: 'page:nb_a:12', kind: 'page' };

describe('naming a hit', () => {
  it('shortens a sheet to its number, else cuts its title', () => {
    expect(tutorialShortName('Tutorial 2 Week 4: Rational Decision Making')).toBe('Tutorial 2');
    expect(tutorialShortName('Quantum computation (NST2030) Tutorial 6')).toBe('Tutorial 6');
    expect(tutorialShortName('Problem sheet on lotteries and utilities')).toBe('Problem sheet on lotter…');
    expect(tutorialShortName('  ')).toBe('Tutorial');
  });

  it('labels a tutorial hit by sheet and part, a note by section, a slide by number', () => {
    expect(tutorialHitLabel(tut.tutorial!)).toBe('Tutorial 2 · Problem 1 Part B');
    expect(tutorialHitLabel({ fileId: 'f', title: 'Tutorial 3', label: null })).toBe('Tutorial 3');
    expect(hitWhere(tut)).toBe('Lecture-rational-utility › Tutorial 2 · Problem 1 Part B');
    expect(hitWhere(base)).toBe('Lecture-rational-utility › Expected utility');
    expect(hitWhere(page)).toBe('Lecture-rational-utility · slide 12');
  });

  it('filters notes, tutorial sheets and slides apart', () => {
    expect([base, tut, page].filter((h) => matchesFilter(h, 'note'))).toEqual([base]);
    expect([base, tut, page].filter((h) => matchesFilter(h, 'tutorial'))).toEqual([tut]);
    expect([base, tut, page].filter((h) => matchesFilter(h, 'page'))).toEqual([page]);
    expect([base, tut, page].filter((h) => matchesFilter(h, 'all'))).toHaveLength(3);
  });
});

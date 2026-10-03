import { describe, expect, it } from 'vitest';
import { editDistance, expandQuery, keywordScores, stem, tokens } from './keyword.js';

describe('keyword fallback', () => {
  it('tokenises after NFKC, lower-cased, without stop words', () => {
    expect(tokens('How to refine 𝐻𝐿𝐴?')).toEqual(['refine', 'hla']);
  });

  it('measures edits with transpositions as one', () => {
    expect(editDistance('hueristic', 'heuristic')).toBe(1);
    expect(editDistance('admisible', 'admissible')).toBe(1);
    expect(editDistance('cat', 'heuristic')).toBe(3);
  });

  it('stems lightly', () => {
    expect(stem('heuristics')).toBe(stem('heuristic'));
    expect(stem('refining')).toBe('refin');
    expect(stem('hla')).toBe('hla');
  });

  it('adds a frequent near-spelling even when the typo itself is in the notes', () => {
    const vocab = new Map([
      ['hueristics', 1],
      ['heuristic', 12],
      ['heuristics', 9],
      ['properties', 2],
    ]);
    expect(expandQuery('properties of hueristic', vocab)).toEqual(['properties', 'hueristic', 'heuristic', 'heuristics']);
  });

  it('ranks the passage that has the words above the one that does not', () => {
    const texts = [
      'A* with an admissible heuristic is optimal; a heuristic never overestimates.',
      'The French Revolution began in 1789.',
      'Heuristics for planning: ignore delete effects.',
      'Heuristics compared: h_max is admissible.',
    ];
    const s = keywordScores('properties of hueristic', texts);
    expect(s[1]).toBe(0);
    expect(s[0]).toBeGreaterThan(0);
    expect(s[2]).toBeGreaterThan(0);
  });
});

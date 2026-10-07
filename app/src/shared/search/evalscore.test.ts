import { describe, expect, it } from 'vitest';
import type { SearchHit } from './types.js';
import { formatSummary, isCorrect, parseMapArg, resolveQueries, scoreQuery, summarise } from './evalscore.js';

const hit = (notebookId: string, pages: number[], kind: 'note' | 'page' = 'note', via: 'text' | 'explain' = 'text'): SearchHit => ({
  key: `${notebookId}:${pages.join(',')}:${kind}`,
  kind,
  notebookId,
  notebookName: '',
  title: '',
  section: [],
  heading: '',
  snippet: '',
  score: 0,
  page: pages[0] ?? null,
  blockId: null,
  blockIds: [],
  pages,
  alsoIn: [],
  via,
  explain: null,
  tutorial: null,
});

const NBS = [
  { id: 'nb_1', name: 'Lecture-mdp' },
  { id: 'nb_2', name: 'Lecture-sdm' },
];

describe('the eval queries file', () => {
  it('resolves a notebook by --map, by id, then by name, and reports what it cannot', () => {
    const { queries, errors } = resolveQueries(
      [
        { id: 'q1', slug: 'mdp', query: 'bellman', gold_pages: [3], kind: 'definition' },
        { id: 'q2', notebook: 'nb_2', query: 'policy', gold_pages: [4] },
        { id: 'q3', notebook: 'Lecture-mdp', query: 'value', gold_pages: [5], kind: 'x' },
        { id: 'q4', slug: 'nope', query: 'x', gold_pages: [1] },
        { id: 'q5', slug: 'mdp', query: '', gold_pages: [1] },
      ],
      parseMapArg('mdp=nb_1, junk ,sdm=nb_2'),
      NBS,
    );
    expect(queries.map((q) => [q.id, q.notebook, q.kind])).toEqual([
      ['q1', 'nb_1', 'definition'],
      ['q2', 'nb_2', 'unspecified'],
      ['q3', 'nb_1', 'x'],
    ]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('nope');
    expect(resolveQueries({}, {}, NBS).errors).toHaveLength(1);
  });
});

describe('scoring', () => {
  const q = { id: 'q', notebook: 'nb_1', query: 'x', gold_pages: [7, 8], kind: 'k' };

  it('counts a hit correct in the right notebook with an overlapping page', () => {
    expect(isCorrect(hit('nb_1', [8, 9]), q)).toBe(true);
    expect(isCorrect(hit('nb_2', [8]), q)).toBe(false);
    expect(isCorrect(hit('nb_1', []), q)).toBe(false);
  });

  it('ranks, and ranks notes on their own, and computes S@1, S@5, MRR and N@1 by kind', () => {
    const a = scoreQuery(q, [hit('nb_1', [7], 'page'), hit('nb_1', [8], 'note', 'explain')]);
    expect(a).toMatchObject({ rank: 1, noteRank: 1, viaExplain: true });
    const b = scoreQuery({ ...q, kind: 'j' }, [hit('nb_1', [1]), hit('nb_1', [2]), hit('nb_1', [7])]);
    expect(b).toMatchObject({ rank: 3, noteRank: 3, viaExplain: false });
    const c = scoreQuery(q, [hit('nb_2', [7])]);
    expect(c.rank).toBeNull();
    const s = summarise([a, b, c]);
    expect(s.all).toEqual({ n: 3, s1: 1 / 3, s5: 2 / 3, mrr: (1 + 1 / 3) / 3, n1: 1 / 3 });
    expect(Object.keys(s.byKind)).toEqual(['j', 'k']);
    expect(s.byKind.k).toMatchObject({ n: 2, s1: 0.5 });
    expect(formatSummary(s, 'mode separate').split('\n')).toHaveLength(5);
  });
});

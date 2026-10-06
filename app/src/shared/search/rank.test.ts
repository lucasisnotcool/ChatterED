/** `rankQuery`'s dedupe of a block's explain against the note chunk that holds it (mode `separate`), and the shipped mode. */
import { describe, expect, it } from 'vitest';
import { matchText, rankQuery, type RankNotebook, type RankRow } from './rank.js';
import { DEFAULT_EXPLAIN_MODE, parseExplainMode } from './types.js';

const NB = 'nb_1';

function row(over: Partial<RankRow> & Pick<RankRow, 'key' | 'kind' | 'blockIds' | 'text'>, embed = over.text): RankRow {
  const section = ['Heuristics'];
  return {
    notebookId: NB,
    page: null,
    pages: [14],
    section,
    title: 'Lecture',
    match: matchText(over.kind, section, over.text, `Lecture › Heuristics\n${embed}`),
    vec: null,
    ...over,
  };
}

/** A list `l` (two items) as one note chunk, and a stored explain on its second item `l_li1`. */
function notebook(): RankNotebook {
  const listText = 'Consistent heuristics\nInformative heuristics';
  const note = row({ key: `note:${NB}:l`, kind: 'note', blockIds: ['l'], text: listText });
  const explain = row(
    { key: `explain:${NB}:l_li1`, kind: 'explain', blockIds: ['l_li1', 'l'], text: 'Informative heuristics' },
    'More informative heuristics expand fewer nodes before the goal.',
  );
  const unit = row({ key: `unit:${NB}:l`, kind: 'unit', blockIds: ['l'], text: listText });
  return {
    name: 'Lecture',
    rows: [note, explain],
    units: new Map([['l', unit]]),
    explains: new Map([['l_li1', 'More informative heuristics expand fewer nodes before the goal.']]),
  };
}

const rank = (query: string) =>
  rankQuery({ query, qv: null, notebooks: new Map([[NB, notebook()]]), limit: 10, explainMode: 'separate' }).hits;

describe('rankQuery: an explain on a list item and its list are one hit', () => {
  it('the explain ranks first: the list chunk does not come back as a second hit', () => {
    const hits = rank('informative nodes expand goal');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ via: 'explain', blockId: 'l_li1', blockIds: ['l'] });
  });

  it('the list ranks first: the explain on its item does not come back as a second hit', () => {
    const hits = rank('consistent informative heuristics');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ via: 'text', blockId: 'l', blockIds: ['l'] });
  });
});

describe('the shipped explain mode', () => {
  it('is `append`, one constant, until the final eval says otherwise (search.md §10)', () => {
    expect(DEFAULT_EXPLAIN_MODE).toBe('append');
    expect(parseExplainMode(undefined)).toBe('append');
    expect(parseExplainMode(' Separate ')).toBe('separate');
  });
});

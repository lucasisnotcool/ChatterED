import { describe, expect, it } from 'vitest';
import type { Node } from 'prosemirror-model';
import { blockAttrs, docFromJson, notesSchema } from '../../../shared/doc/schema.js';
import { contextFingerprint } from '../../../shared/notebook.js';
import {
  blockQuote,
  chipLabel,
  citationParts,
  fillMark,
  fillsForItems,
  hasToolbar,
  isEmptyNoteSlot,
  isNoteSlot,
  isObjectivesList,
  notebookEmpty,
  objectiveFills,
  overviewBanner,
  overviewMeta,
  placeRecommendations,
  sectionSpans,
  showsChip,
  unseenSources,
} from './overview.js';
import {
  FIXTURE_OBJECTIVES,
  fixtureNewSource,
  fixtureNotebook,
  fixtureOverviewDoc,
  fixtureOverviewMeta,
  fixtureProgress,
} from './overviewfixture.js';

const doc = docFromJson(fixtureOverviewDoc());

function block(id: string): Node {
  let found: Node | null = null;
  doc.forEach((node) => {
    if (blockAttrs(node).blockId === id) found = node;
  });
  if (!found) throw new Error(`no block ${id}`);
  return found;
}

describe('the fixture', () => {
  it('is a valid notes doc in the C6 shape', () => {
    expect(doc.childCount).toBeGreaterThan(10);
    expect(isObjectivesList(block('b_obj'))).toBe(true);
  });
});

describe('hasToolbar: which blocks get Explain · Example · Quiz me · Ask…', () => {
  it('a key idea, a takeaway and the lede do', () => {
    expect(hasToolbar(block('b_s1_i1'))).toBe(true);
    expect(hasToolbar(block('b_s1_take'))).toBe(true);
    expect(hasToolbar(block('b_lede'))).toBe(true);
  });

  it('the title, the objectives, headings and the note slot do not', () => {
    expect(hasToolbar(block('b_title'))).toBe(false);
    expect(hasToolbar(block('b_obj_h'))).toBe(false);
    expect(hasToolbar(block('b_obj'))).toBe(false);
    expect(hasToolbar(block('b_s1'))).toBe(false);
    expect(hasToolbar(block('b_s1_note'))).toBe(false);
  });

  it('a Q block, a table and an empty paragraph do not', () => {
    const q = notesSchema.node('q_block', { blockId: 'b_q', pages: [3], questionId: 'q1' }, [
      notesSchema.node('paragraph', { blockId: 'b_qp' }, [notesSchema.text('Why?')]),
    ]);
    expect(hasToolbar(q)).toBe(false);
    const cell = notesSchema.nodes.table_cell!.createAndFill()!;
    const table = notesSchema.node('table', { blockId: 'b_t', pages: [3] }, [notesSchema.node('table_row', null, [cell])]);
    expect(hasToolbar(table)).toBe(false);
    expect(hasToolbar(notesSchema.node('paragraph', { blockId: 'b_e', pages: [3] }))).toBe(false);
  });

  it('a block with no id yet does not: an action could not name it', () => {
    expect(hasToolbar(notesSchema.node('paragraph', { pages: [3] }, [notesSchema.text('Words.')]))).toBe(false);
  });
});

describe('the note slot', () => {
  it('is found by its reason, and is empty until the learner writes', () => {
    expect(isNoteSlot(block('b_s1_note'))).toBe(true);
    expect(isEmptyNoteSlot(block('b_s1_note'))).toBe(true);
    const written = block('b_s1_note').type.create(block('b_s1_note').attrs, [notesSchema.text('mine')]);
    expect(isNoteSlot(written)).toBe(true);
    expect(isEmptyNoteSlot(written)).toBe(false);
    expect(isNoteSlot(block('b_s1_take'))).toBe(false);
  });

  it('has no chip, and nor do the title and the objectives; every other block does', () => {
    expect(showsChip(block('b_s1_note'))).toBe(false);
    expect(showsChip(block('b_title'))).toBe(false);
    expect(showsChip(block('b_obj'))).toBe(false);
    expect(showsChip(block('b_s1_i1'))).toBe(true);
    expect(showsChip(block('b_s1'))).toBe(true);
  });
});

describe('chipLabel: citations through the notebook (C1)', () => {
  const fallback = (): string => 'FALLBACK';
  const sources = fixtureNotebook().sources;

  it('names the source in a notebook of several', () => {
    expect(chipLabel([4, 5], sources, fallback)).toBe('Lecture-complex v4.0 p. 4–5');
    expect(chipLabel([7, 53], sources, fallback)).toBe('Lecture-complex v4.0 p. 7 · Week 2 notes §1');
  });

  it('reads as it always did in a notebook of one PDF', () => {
    expect(chipLabel([4, 5], sources.slice(0, 1), fallback)).toBe('p. 4–5');
  });

  it('says a removed source is gone rather than pointing at another file', () => {
    expect(chipLabel([60], sources, fallback)).toBe('removed source');
  });

  it('falls back with no pages, and with no notebook', () => {
    expect(chipLabel([], sources, fallback)).toBe('FALLBACK');
    expect(chipLabel([4], null, fallback)).toBe('FALLBACK');
    expect(chipLabel([4], [], fallback)).toBe('FALLBACK');
  });
});

describe('citationParts: the chip in parts, so a long name shortens and the page stays', () => {
  const sources = fixtureNotebook().sources;
  const join = (parts: { source: string | null; where: string }[]): string =>
    parts.map((p) => [p.source, p.where].filter(Boolean).join(' ')).join(' · ');

  it('splits the source from the page', () => {
    expect(citationParts(sources, [7, 53])).toEqual([
      { source: 'Lecture-complex v4.0', where: 'p. 7' },
      { source: 'Week 2 notes', where: '§1' },
    ]);
  });

  it('joins back to exactly citationLabel', () => {
    for (const pages of [[4, 5], [7, 53], [53, 54, 55], [60], [3, 60]]) {
      expect(join(citationParts(sources, pages))).toBe(chipLabel(pages, sources, () => ''));
    }
    expect(join(citationParts(sources.slice(0, 1), [4, 5]))).toBe('p. 4–5');
  });

  it('keeps an image (a name and no page) and a removed source whole', () => {
    const withImage = [...sources, { name: 'Board.jpg', kind: 'image' as const, pageBase: 55, pageCount: 1 }];
    expect(citationParts(withImage, [56])).toEqual([{ source: 'Board', where: '' }]);
    expect(citationParts(sources, [60])).toEqual([{ source: null, where: 'removed source' }]);
  });
});

describe('the objectives list fills (C5)', () => {
  const objectives = objectiveFills(fixtureProgress());

  it('are the taught objectives, in tree order', () => {
    expect(objectives.map((o) => o.fill)).toEqual([1, 0.5, 0, 0]);
    const assumed = fixtureProgress();
    assumed.objectives[0]!.assumedByDeck = true;
    expect(objectiveFills(assumed).map((o) => o.objectiveId)).toEqual(['o_2', 'o_3', 'o_4']);
    expect(objectiveFills(null)).toEqual([]);
  });

  it('match each item in order', () => {
    expect(fillsForItems(FIXTURE_OBJECTIVES, objectives).map((o) => o?.objectiveId)).toEqual(['o_1', 'o_2', 'o_3', 'o_4']);
  });

  it('match by title first when the learner reordered the list', () => {
    const items = [FIXTURE_OBJECTIVES[1]!, FIXTURE_OBJECTIVES[0]!, 'A line of my own', FIXTURE_OBJECTIVES[3]!];
    expect(fillsForItems(items, objectives).map((o) => o?.objectiveId)).toEqual(['o_2', 'o_1', 'o_3', 'o_4']);
  });

  it('leave an extra item with nothing to fill', () => {
    expect(fillsForItems([...FIXTURE_OBJECTIVES, 'more'], objectives)[4]).toBeNull();
  });

  it('say the fill in words beside the bar', () => {
    expect(fillMark(1)).toBe('done');
    expect(fillMark(0.5)).toBe('half');
    expect(fillMark(0)).toBe('');
  });
});

describe('sections and recommendations (§5.3)', () => {
  it('a section runs from its H2 to the next, ending at its last block', () => {
    const spans = sectionSpans(doc);
    expect(spans.map((s) => [s.headingBlockId, s.lastBlockId])).toEqual([
      ['b_s1', 'b_s1_note'],
      ['b_s2', 'b_s2_note'],
      ['b_s3', 'b_s3_note'],
    ]);
    const last = spans[2]!;
    expect(last.end).toBe(doc.content.size);
  });

  it('only offered recommendations with a section still there are placed', () => {
    const meta = fixtureOverviewMeta();
    const placed = placeRecommendations(doc, meta);
    expect(placed.map((p) => [p.recommendation.id, p.section.lastBlockId])).toEqual([['rec_s2', 'b_s2_note']]);
    meta.recommendations[0]!.headingBlockId = 'b_gone';
    expect(placeRecommendations(doc, meta)).toEqual([]);
    expect(placeRecommendations(doc, null)).toEqual([]);
  });
});

describe('overviewBanner (§2): never update silently', () => {
  const overview = fixtureOverviewMeta();
  const base = { ready: true, hasDoc: true, overview, dismissed: null };

  it('is quiet while the sources are the ones the overview was written from', () => {
    expect(overviewBanner({ ...base, notebook: fixtureNotebook() })).toBeNull();
  });

  it('counts a new source', () => {
    const banner = overviewBanner({ ...base, notebook: fixtureNotebook([fixtureNewSource()]) });
    expect(banner?.kind).toBe('stale');
    expect(banner?.text).toBe("1 new source added. The overview doesn't cover it yet.");
  });

  it('counts two', () => {
    const two = fixtureNotebook([fixtureNewSource(), { ...fixtureNewSource(), fileId: 'file_more', pageBase: 85 }]);
    expect(overviewBanner({ ...base, notebook: two })?.text).toBe("2 new sources added. The overview doesn't cover them yet.");
  });

  it('says sources changed when one was unticked', () => {
    const nb = fixtureNotebook();
    nb.sources[1]!.enabled = false;
    nb.contextFingerprint = contextFingerprint(nb.sources);
    expect(overviewBanner({ ...base, notebook: nb })?.text).toBe('Sources changed since the overview was written.');
  });

  it('a source still being read changes nothing yet', () => {
    const nb = fixtureNotebook([{ ...fixtureNewSource(), status: 'reading' }]);
    expect(overviewBanner({ ...base, notebook: nb })).toBeNull();
  });

  it('Not now hides it until the fingerprint changes again', () => {
    const nb = fixtureNotebook([fixtureNewSource()]);
    const shown = overviewBanner({ ...base, notebook: nb })!;
    expect(overviewBanner({ ...base, notebook: nb, dismissed: shown.fingerprint })).toBeNull();
    const more = fixtureNotebook([fixtureNewSource(), { ...fixtureNewSource(), fileId: 'file_more', pageBase: 85 }]);
    expect(overviewBanner({ ...base, notebook: more, dismissed: shown.fingerprint })).not.toBeNull();
  });

  it('offers an overview of a legacy doc, once it is ready', () => {
    const banner = overviewBanner({ ...base, overview: null, notebook: fixtureNotebook() });
    expect(banner?.kind).toBe('legacy');
    expect(banner?.text).toBe('These are your earlier notes. Make a short overview from them?');
    expect(overviewBanner({ ...base, overview: null, notebook: fixtureNotebook(), dismissed: banner!.fingerprint })).toBeNull();
  });

  it('is quiet while the doc is being written, with nothing ticked, or with no notebook', () => {
    const nb = fixtureNotebook([fixtureNewSource()]);
    expect(overviewBanner({ ...base, ready: false, notebook: nb })).toBeNull();
    expect(overviewBanner({ ...base, hasDoc: false, notebook: nb })).toBeNull();
    expect(overviewBanner({ ...base, notebook: { contextFingerprint: '' } })).toBeNull();
    expect(overviewBanner({ ...base, notebook: null })).toBeNull();
  });
});

describe('unseenSources: the page images an Update sends first', () => {
  it('are the sources the overview was not written from', () => {
    const nb = fixtureNotebook([fixtureNewSource()]);
    expect([...unseenSources(fixtureOverviewMeta().fingerprint, nb.sources)]).toEqual(['file_reading']);
    expect(unseenSources(null, nb.sources).size).toBe(3);
  });
});

describe('notebookEmpty: before there is an overview', () => {
  it('asks for a source when there is none', () => {
    expect(notebookEmpty({ sources: [] })?.title).toBe('Add a source to start');
  });

  it('says it is reading while nothing ticked is ready yet', () => {
    const nb = fixtureNotebook();
    nb.sources.forEach((s) => (s.status = 'reading'));
    expect(notebookEmpty(nb)?.title).toBe('Reading your sources…');
  });

  it('asks for a tick when everything is ready and nothing is ticked', () => {
    const nb = fixtureNotebook();
    nb.sources.forEach((s) => (s.enabled = false));
    expect(notebookEmpty(nb)?.kind).toBe('none_ticked');
  });

  it('says when every source failed', () => {
    const nb = fixtureNotebook();
    nb.sources.forEach((s) => (s.status = 'failed'));
    expect(notebookEmpty(nb)?.kind).toBe('failed');
  });

  it('is nothing once a ticked source is ready, or without a notebook', () => {
    expect(notebookEmpty(fixtureNotebook())).toBeNull();
    expect(notebookEmpty(null)).toBeNull();
  });
});

describe('the small words', () => {
  it('quotes a block as it reads', () => {
    expect(blockQuote(block('b_s1_take'))).toBe('A plan is a path of actions from the initial state to a goal state.');
  });

  it('the header meta counts sources and minutes', () => {
    expect(overviewMeta(fixtureOverviewMeta())).toBe('from 2 sources · about 1 min to read');
    expect(overviewMeta({ ...fixtureOverviewMeta(), words: 820, fingerprint: 'a@0' })).toBe('from 1 source · about 4 min to read');
    expect(overviewMeta(null)).toBe('');
  });
});

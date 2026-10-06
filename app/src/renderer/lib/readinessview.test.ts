/**
 * D2 (2026-10-06): the renderer's half of "Ready to check this?". Which section an objective is,
 * what counts as the learner's own words there, and that everything counts only since the last
 * question on it closed.
 */

import { describe, expect, it } from 'vitest';
import type { Node } from 'prosemirror-model';
import { authorMark, notesSchema } from '../../shared/doc/schema.js';
import type { DocAuthor, ProgressObjectiveView } from '../../shared/doc/types.js';
import { READY_DWELL_MS } from '../../core/readiness.js';
import {
  ReadinessCounters,
  learnerWords,
  objectiveSections,
  objectivesAt,
  objectivesHolding,
  offersKey,
  openQuestionObjectives,
  readyOffers,
  sectionOwnWords,
} from './readinessview.js';

type Span = { text: string; by: DocAuthor };

function para(blockId: string, spans: Span[] | string, reason: string | null = null): Node {
  const list = typeof spans === 'string' ? [{ text: spans, by: 'ingest' as DocAuthor }] : spans;
  return notesSchema.node(
    'paragraph',
    { blockId, pages: [3], reason, objectiveIds: [] },
    list.filter((s) => s.text.length > 0).map((s) => notesSchema.text(s.text, [authorMark(s.by, null, 1)])),
  );
}

function heading(blockId: string, level: number, text: string, reason: string | null = null): Node {
  return notesSchema.node('heading', { blockId, level, pages: [3], reason, objectiveIds: [] }, [notesSchema.text(text)]);
}

function question(blockId: string, attrs: Record<string, unknown> = {}, children: Node[] = []): Node {
  return notesSchema.node(
    'q_block',
    { blockId, questionId: `q_${blockId}`, pages: [3], reason: null, objectiveIds: [], askedBy: 'max', status: 'open', ...attrs },
    children.length > 0 ? children : [para(`${blockId}_q`, [{ text: 'Why?', by: 'max' }])],
  );
}

function docOf(...blocks: Node[]): Node {
  return notesSchema.node('doc', null, blocks);
}

function objective(objectiveId: string, blockIds: string[], extra: Partial<ProgressObjectiveView> = {}): ProgressObjectiveView {
  return {
    objectiveId,
    title: objectiveId,
    statement: '',
    criteria: [],
    pages: [],
    blockIds,
    fill: 0,
    level: 0,
    assumedByDeck: false,
    evidence: null,
    lastMovedAt: null,
    ...extra,
  };
}

const NOTES = docOf(
  heading('h_title', 1, 'Lecture 4', 'title'),
  heading('h_a', 2, 'Abstraction'),
  para('p_a1', 'Abstraction hides detail.'),
  heading('h_a_sub', 3, 'Layers'),
  para('p_a2', 'Each layer uses the one below.'),
  heading('h_b', 2, 'Cost'),
  para('p_b1', 'Cost is counted in steps.'),
);

describe('objectiveSections', () => {
  it('runs from the first heading among the blockIds to the next heading of the same or a higher level', () => {
    const [a] = objectiveSections(NOTES, [objective('o_a', ['p_a1', 'h_a'])]);
    expect(a?.headingBlockId).toBe('h_a');
    // The H3 is inside the H2's section, and the next H2 closes it.
    expect(objectivesAt([a!], a!.from)).toEqual(['o_a']);
    const sub = objectiveSections(NOTES, [objective('o_sub', ['h_a_sub'])])[0]!;
    expect(sub.from).toBeGreaterThan(a!.from);
    expect(sub.to).toBe(a!.to);
  });

  it("takes the heading its first block sits under when its blocks hold none, and Quiz me's line is the section's first", () => {
    const [b] = objectiveSections(NOTES, [objective('o_b', ['p_b1'])]);
    expect(b?.headingBlockId).toBe('h_b');
    expect(b?.target).toBe('p_b1');
  });

  it('never makes the title or the objectives list a section, and skips an objective with no heading at all', () => {
    const flat = docOf(heading('h_title', 1, 'Lecture 4', 'title'), para('p_1', 'Prose.'));
    expect(objectiveSections(flat, [objective('o_1', ['p_1'])])).toEqual([]);
    expect(objectiveSections(docOf(para('p_1', 'Prose.')), [objective('o_1', ['p_1'])])).toEqual([]);
    expect(objectiveSections(NOTES, [objective('o_gone', ['nope'])])).toEqual([]);
  });

  it("looks past a question for the line to press Quiz me on", () => {
    const doc = docOf(heading('h_a', 2, 'A'), question('q1'), para('p_a', 'Prose.'));
    expect(objectiveSections(doc, [objective('o_a', ['h_a'])])[0]?.target).toBe('p_a');
  });

  /** W2's concept cards: Quiz me is pressed on a card's core line, never on the frame or its depth. */
  it("presses Quiz me on a concept card's core line", () => {
    const card = notesSchema.node('concept', { blockId: 'c1', term: 'Gradient', pages: [3], reason: null, objectiveIds: [] }, [
      para('c1p', 'Gradient: the direction of steepest ascent.'),
      notesSchema.node('concept_item', { blockId: 'i1', role: 'example', pages: [3], reason: null, objectiveIds: [] }, [
        para('i1a', 'For x squared it is 2x.'),
      ]),
    ]);
    const doc = docOf(heading('h_a', 2, 'A'), card);
    expect(objectiveSections(doc, [objective('o_a', ['i1a'])])[0]).toMatchObject({ headingBlockId: 'h_a', target: 'c1p' });
  });

  /**
   * Decision 9 (6 Oct afternoon, #67): a partly done topic is offered again, and the check asks
   * about the card still to do, not again about the one already earned.
   */
  it('presses Quiz me on the first card without a Well done', () => {
    const conceptCard = (id: string, line: string) =>
      notesSchema.node('concept', { blockId: id, term: id, pages: [3], reason: null, objectiveIds: [] }, [para(`${id}p`, line)]);
    const doc = docOf(heading('h_a', 2, 'Iteration'), conceptCard('c_value', 'Value iteration: repeat.'), question('q1', { status: 'resolved' }), conceptCard('c_policy', 'Policy iteration: evaluate.'));
    const cards = [
      { cardId: 'c_value', term: 'Value iteration', done: true },
      { cardId: 'c_policy', term: 'Policy iteration', done: false },
    ];
    expect(objectiveSections(doc, [objective('o_a', ['h_a'], { fill: 0.5, cards })])[0]?.target).toBe('c_policyp');
    // With no card view (an older main), the first line, as before.
    expect(objectiveSections(doc, [objective('o_a', ['h_a'])])[0]?.target).toBe('c_valuep');
  });
});

describe('own words', () => {
  it("counts only the learner's own spans, without gluing them to an agent's words", () => {
    const mixed = para('p', [
      { text: 'I think it ', by: 'user' },
      { text: 'hides', by: 'ellie' },
      { text: ' detail well', by: 'user' },
    ]);
    expect(learnerWords(mixed)).toBe(5);
    expect(learnerWords(para('p', 'Not theirs at all.'))).toBe(0);
  });

  it('leaves out everything inside a question block', () => {
    const doc = docOf(
      heading('h_a', 2, 'A'),
      para('p_a', [{ text: 'my own note here', by: 'user' }]),
      question('q1', {}, [para('q1_q', [{ text: 'Why?', by: 'max' }]), para('q1_a', [{ text: 'because of many reasons', by: 'user' }])]),
    );
    const [section] = objectiveSections(doc, [objective('o_a', ['h_a'])]);
    expect(sectionOwnWords(doc, section!)).toBe(4);
  });
});

describe('openQuestionObjectives', () => {
  it("finds Max's open question by its objective or by where it stands, and ignores closed and the learner's own", () => {
    const doc = docOf(
      heading('h_a', 2, 'A'),
      para('p_a', 'Prose.'),
      question('q1'),
      heading('h_b', 2, 'B'),
      question('q2', { status: 'resolved' }),
      question('q3', { askedBy: 'user' }),
      question('q4', { objectiveId: 'o_c' }),
    );
    const sections = objectiveSections(doc, [objective('o_a', ['h_a']), objective('o_b', ['h_b'])]);
    expect([...openQuestionObjectives(doc, sections)].sort()).toEqual(['o_a', 'o_b', 'o_c']);
  });
});

describe('ReadinessCounters', () => {
  it('starts time and folds again, and rebases the words, when a question on the objective closes', () => {
    const counters = new ReadinessCounters();
    counters.sync('o', null, 0);
    counters.addDwell(['o', 'o'], 5000);
    counters.addDepth(['o']);
    expect(counters.sync('o', null, 20)).toMatchObject({ dwellMs: 5000, depthOpened: 1, wordsBase: 0 });
    expect(counters.sync('o', '2026-10-06T10:00:00Z', 20)).toMatchObject({ dwellMs: 0, depthOpened: 0, wordsBase: 20 });
  });

  it('only records `since` on the first look, so a fresh load keeps what was measured', () => {
    const counters = new ReadinessCounters();
    counters.addDwell(['o'], 5000);
    expect(counters.sync('o', '2026-10-06T10:00:00Z', 30)).toMatchObject({ dwellMs: 5000, wordsBase: 0 });
  });
});

describe('readyOffers', () => {
  const doc = docOf(
    heading('h_a', 2, 'Abstraction'),
    para('p_a', 'Abstraction hides detail.'),
    heading('h_b', 2, 'Cost'),
    para('p_b', 'Cost is counted in steps.'),
  );
  const helped = { activity: { explains: 1, examples: 0, since: null } };

  function warm(counters: ReadinessCounters, ids: string[]): void {
    counters.addDwell(ids, READY_DWELL_MS);
  }

  it('offers on the heading, pointing Quiz me at its first line, once time and an act are both there', () => {
    const counters = new ReadinessCounters();
    const objectives = [objective('o_a', ['h_a'], helped), objective('o_b', ['h_b'], helped)];
    expect(readyOffers({ doc, objectives, counters, threadQuizOpen: false })).toEqual([]);
    warm(counters, ['o_a']);
    expect(readyOffers({ doc, objectives, counters, threadQuizOpen: false })).toEqual([
      { headingBlockId: 'h_a', target: 'p_a', objectiveIds: ['o_a'] },
    ]);
  });

  // Decision 8 (6 Oct afternoon, #67): a question to Ellie on the section is the act.
  it('offers after questions to Ellie on the section, as after an Explain', () => {
    const counters = new ReadinessCounters();
    warm(counters, ['o_a']);
    const asked = [objective('o_a', ['h_a'], { activity: { explains: 0, examples: 0, questions: 2, since: null } })];
    expect(readyOffers({ doc, objectives: asked, counters, threadQuizOpen: false })).toEqual([
      { headingBlockId: 'h_a', target: 'p_a', objectiveIds: ['o_a'] },
    ]);
  });

  it('never offers on time alone, on a done objective, or while any question is open', () => {
    const counters = new ReadinessCounters();
    warm(counters, ['o_a']);
    expect(readyOffers({ doc, objectives: [objective('o_a', ['h_a'])], counters, threadQuizOpen: false })).toEqual([]);
    expect(readyOffers({ doc, objectives: [objective('o_a', ['h_a'], { ...helped, fill: 1 })], counters, threadQuizOpen: false })).toEqual([]);
    expect(readyOffers({ doc, objectives: [objective('o_a', ['h_a'], helped)], counters, threadQuizOpen: true })).toEqual([]);
    const asking = docOf(heading('h_a', 2, 'A'), para('p_a', 'Prose.'), question('q1'));
    expect(readyOffers({ doc: asking, objectives: [objective('o_a', ['h_a'], helped)], counters, threadQuizOpen: false })).toEqual([]);
  });

  it("counts the learner's own words as the act, but only those written since the last question closed", () => {
    const words = docOf(
      heading('h_a', 2, 'A'),
      para('p_a', 'Prose.'),
      para('p_mine', [{ text: 'a layer only talks to the layer directly below it, never further', by: 'user' }]),
    );
    const counters = new ReadinessCounters();
    warm(counters, ['o_a']);
    expect(readyOffers({ doc: words, objectives: [objective('o_a', ['h_a'])], counters, threadQuizOpen: false })).toHaveLength(1);
    // A question on it closes: the same words no longer count, and the clock starts again.
    const closed = [objective('o_a', ['h_a'], { activity: { explains: 0, examples: 0, since: '2026-10-06T10:00:00Z' } })];
    expect(readyOffers({ doc: words, objectives: closed, counters, threadQuizOpen: false })).toEqual([]);
    warm(counters, ['o_a']);
    expect(readyOffers({ doc: words, objectives: closed, counters, threadQuizOpen: false })).toEqual([]);
  });

  it('draws one offer for a section two objectives share', () => {
    const counters = new ReadinessCounters();
    warm(counters, ['o_a', 'o_a2']);
    const objectives = [objective('o_a', ['h_a'], helped), objective('o_a2', ['p_a'], helped)];
    const offers = readyOffers({ doc, objectives, counters, threadQuizOpen: false });
    expect(offers).toEqual([{ headingBlockId: 'h_a', target: 'p_a', objectiveIds: ['o_a', 'o_a2'] }]);
    expect(offersKey(offers)).toBe('h_a>p_a');
  });

  it('maps a fold opened from a line to the objectives whose sections hold it', () => {
    const sections = objectiveSections(doc, [objective('o_a', ['h_a']), objective('o_b', ['h_b'])]);
    expect(objectivesHolding(doc, sections, 'p_b')).toEqual(['o_b']);
    expect(objectivesHolding(doc, sections, 'gone')).toEqual([]);
  });
});

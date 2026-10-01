import { describe, expect, it } from 'vitest';
import { docOf, flashcards, infographic, quiz } from '../../../shared/doc/fixture.test-support.js';
import { authorMark, notesSchema } from '../../../shared/doc/schema.js';
import {
  DOC_TEXT_MIN_WORDS,
  DOC_TEXT_PAUSE_MS,
  DocTextWatch,
  learnerTextByBlock,
  wordCount,
} from './doctext.js';

const SENTENCE = 'Value iteration sweeps every state on every pass until it converges.';

describe('wordCount', () => {
  it('counts runs of non-space and ignores the edges', () => {
    expect(wordCount('  one   two\nthree ')).toBe(3);
    expect(wordCount('')).toBe(0);
  });

  it('agrees that the fixture sentence clears the minimum', () => {
    expect(wordCount(SENTENCE)).toBeGreaterThanOrEqual(DOC_TEXT_MIN_WORDS);
  });
});

describe('learnerTextByBlock', () => {
  function docWith(...spans: { text: string; by: 'ellie' | 'user' }[]) {
    return notesSchema.node('doc', null, [
      notesSchema.node(
        'paragraph',
        { blockId: 'b_one', pages: [3], reason: null, objectiveIds: [] },
        spans.map((s) => notesSchema.text(s.text, [authorMark(s.by, null, 1)])),
      ),
    ]);
  }

  it('returns only the spans the learner wrote', () => {
    const doc = docWith({ text: 'Ellie wrote this. ', by: 'ellie' }, { text: 'I wrote this.', by: 'user' });
    expect(learnerTextByBlock(doc)).toEqual([{ blockId: 'b_one', text: 'I wrote this.' }]);
  });

  it('joins two learner spans split by an agent phrase with a single space', () => {
    const doc = docWith(
      { text: 'A policy is', by: 'user' },
      { text: ' (as Ellie put it) ', by: 'ellie' },
      { text: 'a map from states to actions.', by: 'user' },
    );
    expect(learnerTextByBlock(doc)[0]?.text).toBe('A policy is a map from states to actions.');
  });

  it('is empty when the learner has written nothing', () => {
    expect(learnerTextByBlock(docWith({ text: 'All Ellie.', by: 'ellie' }))).toEqual([]);
  });

  /**
   * #49: a *you got this* files the learner's chat answer under the question, in their author
   * mark. Reported as doc text it would be marked a second time, against whatever question was
   * open next. Since 2026-10-01 an open question's block is skipped as well: an answer written
   * under the question is marked on Submit, not on a pause.
   */
  it('skips learner text inside any Q block, resolved or open', () => {
    const q = (status: 'open' | 'resolved', blockId: string) =>
      notesSchema.node(
        'q_block',
        { blockId: `q_${blockId}`, pages: [3], reason: null, objectiveIds: [], questionId: `q_${blockId}`, status },
        [
          notesSchema.node('paragraph', { blockId: `b_q_${blockId}`, pages: [3], reason: null, objectiveIds: [] }, [
            notesSchema.text('Why does it converge?', [authorMark('max', null, 1)]),
          ]),
          notesSchema.node('paragraph', { blockId, pages: [3], reason: null, objectiveIds: [] }, [
            notesSchema.text(SENTENCE, [authorMark('user', null, 1)]),
          ]),
        ],
      );
    const outside = notesSchema.node('paragraph', { blockId: 'b_out', pages: [3], reason: null, objectiveIds: [] }, [
      notesSchema.text(SENTENCE, [authorMark('user', null, 1)]),
    ]);
    const doc = notesSchema.node('doc', null, [q('resolved', 'b_closed'), q('open', 'b_live'), outside]);
    expect(learnerTextByBlock(doc)).toEqual([{ blockId: 'b_out', text: SENTENCE }]);
  });

  /** The text of a question the learner wrote is not an attempt, and neither is its answer yet. */
  it("skips a learner's own question and the answer under it", () => {
    const own = notesSchema.node(
      'q_block',
      { blockId: 'b_own', pages: [3], reason: 'your own question', objectiveIds: [], questionId: 'q_own', askedBy: 'user' },
      [
        notesSchema.node('paragraph', { blockId: 'b_own_q', pages: [3], reason: null, objectiveIds: [] }, [
          notesSchema.text('Why does value iteration sweep every state on every single pass?', [authorMark('user', null, 1)]),
        ]),
        notesSchema.node('paragraph', { blockId: 'b_own_a', pages: [3], reason: null, objectiveIds: [] }, [
          notesSchema.text(SENTENCE, [authorMark('user', null, 1)]),
        ]),
      ],
    );
    expect(learnerTextByBlock(notesSchema.node('doc', null, [own]))).toEqual([]);
  });
});

describe('DocTextWatch', () => {
  const t0 = 1_000_000;

  it('reports nothing before the pause has elapsed', () => {
    const watch = new DocTextWatch();
    watch.observe([{ blockId: 'b', text: SENTENCE }], t0);
    expect(watch.due(t0 + DOC_TEXT_PAUSE_MS - 1)).toEqual([]);
    expect(watch.due(t0 + DOC_TEXT_PAUSE_MS)).toEqual([{ blockId: 'b', text: SENTENCE }]);
  });

  it('reports nothing for less than a sentence, however long the pause', () => {
    const watch = new DocTextWatch();
    watch.observe([{ blockId: 'b', text: 'the answer is' }], t0);
    expect(watch.due(t0 + 60_000)).toEqual([]);
  });

  it('does not restart the clock when some OTHER block changes', () => {
    const watch = new DocTextWatch();
    watch.observe([{ blockId: 'b', text: SENTENCE }], t0);
    watch.observe([{ blockId: 'b', text: SENTENCE }, { blockId: 'c', text: 'later' }], t0 + 3_000);
    expect(watch.due(t0 + DOC_TEXT_PAUSE_MS)).toEqual([{ blockId: 'b', text: SENTENCE }]);
  });

  it('restarts the clock when the block itself is edited again', () => {
    const watch = new DocTextWatch();
    watch.observe([{ blockId: 'b', text: SENTENCE }], t0);
    watch.observe([{ blockId: 'b', text: `${SENTENCE} And more.` }], t0 + 3_000);
    expect(watch.due(t0 + DOC_TEXT_PAUSE_MS)).toEqual([]);
    expect(watch.due(t0 + 3_000 + DOC_TEXT_PAUSE_MS)).toHaveLength(1);
  });

  it('reports the same text only once, and reports again after a further edit', () => {
    const watch = new DocTextWatch();
    watch.observe([{ blockId: 'b', text: SENTENCE }], t0);
    const due = watch.due(t0 + DOC_TEXT_PAUSE_MS);
    expect(due).toHaveLength(1);
    watch.markReported('b', SENTENCE);
    expect(watch.due(t0 + 60_000)).toEqual([]);

    const longer = `${SENTENCE} It is a fixed point.`;
    watch.observe([{ blockId: 'b', text: longer }], t0 + 61_000);
    expect(watch.due(t0 + 61_000 + DOC_TEXT_PAUSE_MS)).toEqual([{ blockId: 'b', text: longer }]);
  });

  it('forgets a block whose learner text was deleted, so retyping it reports again', () => {
    const watch = new DocTextWatch();
    watch.observe([{ blockId: 'b', text: SENTENCE }], t0);
    watch.markReported('b', SENTENCE);
    watch.observe([], t0 + 1_000);
    watch.observe([{ blockId: 'b', text: SENTENCE }], t0 + 2_000);
    expect(watch.due(t0 + 2_000 + DOC_TEXT_PAUSE_MS)).toEqual([{ blockId: 'b', text: SENTENCE }]);
  });

  it('says when it next has something to say, so the caller can arm one timer', () => {
    const watch = new DocTextWatch();
    expect(watch.nextDueAt(t0)).toBeNull();
    watch.observe([{ blockId: 'b', text: SENTENCE }], t0);
    expect(watch.nextDueAt(t0)).toBe(t0 + DOC_TEXT_PAUSE_MS);
    watch.markReported('b', SENTENCE);
    expect(watch.nextDueAt(t0)).toBeNull();
  });
});

describe('learnerTextByBlock — flashcards, a quiz, an infographic', () => {
  const mine = (text: string) => [{ text, by: 'user' as const }];

  it('reports the learner’s words inside each, against the block, and not the agent’s', () => {
    const doc = docOf(
      flashcards('b_f', [['Term', mine('my own gloss on the term')], ['Other', 'agent text']]),
      quiz('b_q', [{ prompt: 'Which?', options: [{ text: mine('my option') }, { text: 'c' }], explain: 'Because.' }]),
      infographic('b_i', [{ value: '1', heading: 'H', body: mine('what I noticed here') }]),
    );
    expect(learnerTextByBlock(doc)).toEqual([
      { blockId: 'b_f', text: 'my own gloss on the term' },
      { blockId: 'b_q', text: 'my option' },
      { blockId: 'b_i', text: 'what I noticed here' },
    ]);
  });

  it('reports nothing for blocks only the agents wrote', () => {
    expect(learnerTextByBlock(docOf(flashcards('b_f', [['a', 'b']]), quiz('b_q', [{ prompt: 'p', explain: 'e' }])))).toEqual([]);
  });
});

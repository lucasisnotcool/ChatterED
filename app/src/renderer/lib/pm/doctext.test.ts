import { describe, expect, it } from 'vitest';
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

/**
 * **The doc-edit call, as pure functions** (#48, `docs/research/collab-doc.md` §5).
 *
 * `actor.collabdoc.test.ts` proves the wiring — that a turn produces an edit, that a frozen doc
 * drops it, that a failure never reaches the conversation. This proves the *ops*: what is
 * addressed, what provenance it carries, and the three places where the code refuses to build one
 * because building it would be a lie.
 *
 * All pure, all without a ProseMirror view: §8's own requirement for this half of the build.
 */
import { describe, expect, it } from 'vitest';
import type { OutlineEntry } from '../shared/doc/types.js';
import {
  blocksFromTurn,
  buildQuestionEdit,
  buildResolveEdit,
  buildSuggestionEdit,
  buildWhisperInsert,
  outlineText,
  pagesCited,
  planAnswerEdit,
  provenanceFor,
  type DocEditDeps,
} from './docedit.js';
import { NO_DOC, type DocPort } from './docport.js';
import { EMPTY_USAGE, type LLMClient, type LlmRequest } from './llm/types.js';

const OUTLINE: OutlineEntry[] = [
  { blockId: 'b_1', kind: 'heading', path: [], text: 'Heuristics', pages: [4], learnerText: false, questionId: null },
  { blockId: 'b_2', kind: 'paragraph', path: ['Heuristics'], text: 'An admissible heuristic never overestimates.', pages: [4], learnerText: false, questionId: null },
  { blockId: 'b_mine', kind: 'paragraph', path: ['Heuristics'], text: 'my note: Manhattan is admissible on the 8-puzzle', pages: [4], learnerText: true, questionId: null },
];

function deps(over: Partial<DocPort> = {}, reply: Record<string, unknown> = {}): DocEditDeps & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  let n = 0;
  const llm: LLMClient = {
    kind: 'scripted',
    async complete(request) {
      requests.push(request);
      return { text: JSON.stringify(reply), model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'scripted' as const };
    },
  };
  return {
    llm,
    docPort: { ...NO_DOC, docId: () => 'doc_1', frozen: () => false, blocksForPages: () => ['b_2'], ...over },
    model: 'claude-sonnet-5',
    newId: (prefix) => `${prefix}_${(n += 1)}`,
    roomId: 'room_1',
    fileId: 'f_1',
    anchorId: 'doc',
    turnId: 'turn_1',
    requests,
  };
}

describe('pagesCited', () => {
  it('reads the `p. N` grounds every verdict and answer is asked for', () => {
    expect(pagesCited('On p. 3 the slide says…, and p. 12 repeats it.')).toEqual([3, 12]);
    expect(pagesCited('pp. 4–6 cover it')).toEqual([4, 5, 6]);
    expect(pagesCited('nothing here')).toEqual([]);
  });

  it('drops a citation outside the deck rather than trusting it', () => {
    expect(pagesCited('p. 900 says so', 60)).toEqual([]);
  });
});

describe('provenanceFor', () => {
  /** §2: every block carries pages, or a reason, or both. Neither is rejected by validation. */
  it('uses the cited pages, and falls back to a reason when the turn cited nothing', () => {
    expect(provenanceFor('see p. 4', 'because')).toEqual({ pages: [4], reason: null });
    expect(provenanceFor('no citation here', 'because')).toEqual({ pages: [], reason: 'because' });
  });
});

describe('blocksFromTurn', () => {
  const prov = { pages: [4], reason: null };

  it('splits a turn into paragraphs and folds a run of bullets into one list', () => {
    const blocks = blocksFromTurn('First para.\n\n- one\n- two\n\nLast para.', prov);
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'bullets', 'paragraph']);
    expect(blocks[1]).toMatchObject({ items: ['one', 'two'] });
  });

  it('keeps the inline subset verbatim, because both ends were built against it', () => {
    const [block] = blocksFromTurn('The **Hessian** is $H$ and `f` is convex.', prov);
    expect(block).toMatchObject({ kind: 'paragraph', text: 'The **Hessian** is $H$ and `f` is convex.' });
  });

  it('produces nothing from nothing', () => {
    expect(blocksFromTurn('   \n\n  ', prov)).toEqual([]);
  });
});

describe('outlineText', () => {
  it('is the whole view the planner gets, and it marks the learner’s own blocks', () => {
    const text = outlineText(OUTLINE);
    expect(text).toContain('b_2 — paragraph: Heuristics › An admissible heuristic never overestimates. [p. 4]');
    expect(text).toContain('(the learner wrote in this block)');
    expect(outlineText([])).toBe('(the notes are empty here)');
  });
});

describe('planAnswerEdit (§5.1)', () => {
  it('adds nothing and points at the block when the notes already say it', async () => {
    const d = deps({}, { edit: 'none', points_to: 'b_2' });
    const out = await planAnswerEdit(d, { answer: 'An admissible heuristic never overestimates.', blockId: 'b_2', outline: OUTLINE });
    expect(out.batch).toBeNull();
    expect(out.pointsTo).toBe('b_2');
  });

  it('inserts what is missing, authored by Ellie, with the cause the log reads', async () => {
    const d = deps({}, {
      edit: 'insert_after',
      anchor_block_id: 'b_2',
      why: 'the notes never define consistency',
      blocks: [{ kind: 'paragraph', text: 'A consistent heuristic also satisfies the triangle inequality.', prov: { pages: [4], reason: null } }],
    });
    const out = await planAnswerEdit(d, { answer: 'On p. 4 …', blockId: 'b_2', outline: OUTLINE });
    expect(out.batch).toMatchObject({
      author: 'ellie',
      cause: 'answer_missing',
      focusBlockId: 'b_2',
      why: 'the notes never define consistency',
    });
    expect(out.batch!.ops[0]).toMatchObject({ op: 'insert_after', anchorBlockId: 'b_2' });
  });

  it('shows the planner the outline and the answer, and nothing else', async () => {
    const d = deps({}, { edit: 'none', points_to: 'b_2' });
    await planAnswerEdit(d, { answer: 'THE-ANSWER-TEXT', blockId: 'b_2', outline: OUTLINE });
    const system = d.requests[0]!.system.map((b) => b.text).join('\n');
    expect(system).toContain('THE-ANSWER-TEXT');
    expect(system).toContain('b_2');
    // It is a structured call, billed as the document's own cost (architect §2).
    expect(d.requests[0]!.jsonSchema).toBeTypeOf('object');
    expect(d.requests[0]!.meta.costScope).toBe('docedit');
  });

  /**
   * **§5.4: learner text is worked around, not through.** The renderer's guard would catch this
   * anyway — a `replace_block` over learner text becomes a suggestion — so what the downgrade
   * saves is the surprise: an answer that was merely missing should not arrive as an Accept ·
   * Reject on something the learner wrote.
   */
  it('downgrades a replace or an append over the learner’s own block to an insert beside it', async () => {
    for (const edit of ['replace_block', 'append_to_block'] as const) {
      const d = deps({}, {
        edit,
        block_id: 'b_mine',
        text: 'and it is consistent too',
        blocks: [{ kind: 'paragraph', text: 'and it is consistent too', prov: { pages: [4], reason: null } }],
      });
      const out = await planAnswerEdit(d, { answer: 'p. 4', blockId: 'b_mine', outline: OUTLINE });
      expect(out.batch!.ops[0]!.op, edit).toBe('insert_after');
    }
  });

  /**
   * Interview finding (`docs/research/interviews/findings.md` §6): the learner highlighted this
   * span and asked about *it*. One interviewee complained specifically of additions landing in the
   * wrong place, so the anchor is pinned and only the content is planned.
   */
  it('pins a span thread’s anchor, whatever the planner preferred', async () => {
    const d = deps({}, {
      edit: 'insert_after',
      anchor_block_id: 'b_1',
      blocks: [{ kind: 'paragraph', text: 'An addition.', prov: { pages: [4], reason: null } }],
    });
    const out = await planAnswerEdit(d, { answer: 'p. 4', blockId: 'b_2', outline: OUTLINE, pinAnchor: true });
    expect(out.batch!.ops[0]).toMatchObject({ op: 'insert_after', anchorBlockId: 'b_2' });
  });

  it('builds nothing when the model asked for an edit with no content', async () => {
    const d = deps({}, { edit: 'insert_after', anchor_block_id: 'b_2', blocks: [] });
    expect((await planAnswerEdit(d, { answer: 'x', blockId: 'b_2', outline: OUTLINE })).batch).toBeNull();
  });
});

describe('buildQuestionEdit (§5.2)', () => {
  it('writes the question in as a Q block, with no model call at all', () => {
    const d = deps();
    const batch = buildQuestionEdit(d, {
      questionId: 'q_9',
      objectiveId: 'obj_1',
      text: 'On p. 4, why does admissibility matter for A*?',
      blockId: null,
    })!;
    expect(batch.author).toBe('max');
    expect(batch.cause).toBe('q_block');
    expect(batch.ops[0]).toMatchObject({ op: 'insert_q', questionId: 'q_9', objectiveId: 'obj_1', anchorBlockId: 'b_2' });
    expect(batch.ops[0]).toMatchObject({ prov: { pages: [4], reason: null } });
    expect(d.requests).toEqual([]);
  });

  it('prefers the thread’s own block over the page intersection', () => {
    const batch = buildQuestionEdit(deps(), { questionId: 'q_9', objectiveId: null, text: 'why?', blockId: 'b_mine' })!;
    expect(batch.ops[0]).toMatchObject({ anchorBlockId: 'b_mine' });
  });

  /** The one check code can make honestly about "a question the doc does not already answer". */
  it('writes nothing when the Q block is already in the document', () => {
    const d = deps({ hasQuestion: () => true });
    expect(buildQuestionEdit(d, { questionId: 'q_9', objectiveId: null, text: 'why?', blockId: 'b_2' })).toBeNull();
  });

  it('writes nothing when there is nowhere to put it', () => {
    const d = deps({ blocksForPages: () => [], outlineNear: () => [] });
    expect(buildQuestionEdit(d, { questionId: 'q_9', objectiveId: null, text: 'why?', blockId: null })).toBeNull();
  });
});

describe('buildResolveEdit (§5.3)', () => {
  it('writes Max’s own words under the Q block, tagged with how it ended', () => {
    for (const resolution of ['you_got_this', 'partly_yours', 'released'] as const) {
      const batch = buildResolveEdit(deps(), {
        questionId: 'q_9',
        resolution,
        text: 'It matters because A* would expand the wrong node first. p. 4: "never overestimates".',
      })!;
      expect(batch.cause).toBe('q_resolved');
      expect(batch.ops[0]).toMatchObject({ op: 'resolve_q', questionId: 'q_9', resolution });
      expect(batch.why.length).toBeGreaterThan(0);
    }
  });

  it('writes nothing from an empty turn, which is what a failed generation leaves', () => {
    expect(buildResolveEdit(deps(), { questionId: 'q_9', resolution: 'released', text: '   ' })).toBeNull();
  });
});

describe('buildSuggestionEdit (§6)', () => {
  const base = {
    blockId: 'b_mine',
    text: 'Manhattan is admissible on the 8-puzzle because it never overestimates.',
    replacement: 'never overestimates the remaining cost',
    note: 'one word missing',
    threadId: 'span_aaaaaaaaaaaa',
  };

  it('carries the quote and the replacement the renderer draws Accept · Reject on', () => {
    const batch = buildSuggestionEdit(deps(), { ...base, quote: 'never overestimates' })!;
    expect(batch.cause).toBe('suggestion');
    expect(batch.ops).toEqual([]);
    expect(batch.suggestion).toMatchObject({
      blockId: 'b_mine',
      quote: 'never overestimates',
      replacement: 'never overestimates the remaining cost',
      note: 'one word missing',
      threadId: 'span_aaaaaaaaaaaa',
    });
  });

  /**
   * **The quote must be a verbatim substring**, checked here rather than hoped for — a suggestion
   * whose quote is a paraphrase cannot be located in the document, so it would silently become
   * nothing. The same discipline as ledger rule 1, and for the same reason.
   */
  it('refuses a quote the learner did not write, and an empty replacement', () => {
    expect(buildSuggestionEdit(deps(), { ...base, quote: 'never under-estimates' })).toBeNull();
    expect(buildSuggestionEdit(deps(), { ...base, quote: '' })).toBeNull();
    expect(buildSuggestionEdit(deps(), { ...base, quote: 'never overestimates', replacement: '  ' })).toBeNull();
  });

  /** The lead's note: `suggestion.note` is a required string, never null. */
  it('always carries a note, falling back to one rather than leaving it empty', () => {
    const batch = buildSuggestionEdit(deps(), { ...base, quote: 'never overestimates', note: '' })!;
    expect(batch.suggestion!.note).toBe('');
    expect(batch.why.length).toBeGreaterThan(0);
  });
});

describe('buildWhisperInsert (§4.1)', () => {
  it('is authored by the agent whose thread it came from, with the whisper_insert cause', () => {
    const batch = buildWhisperInsert(deps(), {
      author: 'max',
      text: 'Admissibility is about never overestimating, p. 4.',
      anchorBlockId: 'b_2',
    })!;
    expect(batch.author).toBe('max');
    expect(batch.cause).toBe('whisper_insert');
    expect(batch.ops[0]).toMatchObject({ op: 'insert_after', anchorBlockId: 'b_2' });
  });

  it('falls back to the end of the outline when the learner gave no anchor', () => {
    const d = deps({ outlineNear: () => OUTLINE });
    const batch = buildWhisperInsert(d, { author: 'ellie', text: 'A line.', anchorBlockId: null })!;
    expect(batch.ops[0]).toMatchObject({ anchorBlockId: 'b_mine' });
  });

  it('writes nothing when there is no document to write into', () => {
    const d = deps({ outlineNear: () => [] });
    expect(buildWhisperInsert(d, { author: 'ellie', text: 'A line.', anchorBlockId: null })).toBeNull();
  });
});

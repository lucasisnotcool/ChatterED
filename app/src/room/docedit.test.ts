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
import { ANSWER_EDIT_PASSAGE_CHARS, answerEditPrompt, blocksFromTurn, buildQuestionEdit, buildResolveEdit, buildSuggestionEdit, buildWhisperInsert, notesFromTurn, outlineText, pagesCited, planAnswerEdit, planResolveEdit, planSuggestionEdit, provenanceFor, resolveNotesPrompt, type DocEditDeps } from './docedit.js';
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

  /** 2026-09-23: the chat holds the short half, so this call writes the long half from the slide. */
  it('is given the question and one page of the slide, and asked for what the chat left out', () => {
    const passage = 'An admissible heuristic never overestimates. '.repeat(100);
    const prompt = answerEditPrompt({ answer: 'short reply', question: 'why admissible?', passage, page: 4, blockId: 'b_2', outline: OUTLINE });
    expect(prompt).toContain('THE SLIDE (p. 4)');
    expect(prompt).toContain('why admissible?');
    expect(prompt).toContain('Write what the chat left out');
    expect(prompt).not.toContain(passage.trim());
    expect(prompt).toContain(passage.slice(0, ANSWER_EDIT_PASSAGE_CHARS).trim());
  });

  it('still reads without a question or a slide (a lesson Start, a deck-wide ask)', () => {
    const prompt = answerEditPrompt({ answer: 'short reply', blockId: 'b_2', outline: OUTLINE });
    expect(prompt).not.toContain('THE SLIDE');
    expect(prompt).not.toContain('WHAT THEY ASKED');
    expect(prompt).toContain('short reply');
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

  /**
   * The live run of 20 Sep: Ellie answered citing p. 2 and p. 6, Max's follow-up cited nothing —
   * so the intersection was empty and the Q block landed under the last bullet of page 7.
   */
  it('falls back to the pages the answer it follows cited', () => {
    const seen: number[][] = [];
    const d = deps({
      blocksForPages: (pages) => {
        seen.push([...pages]);
        return pages.length > 0 ? ['b_p2'] : [];
      },
    });
    const batch = buildQuestionEdit(d, {
      questionId: 'q_9',
      objectiveId: null,
      text: 'And what happens to that exchange next?',
      blockId: null,
      fallbackPages: [2, 6],
    })!;
    expect(seen).toEqual([[2, 6]]);
    expect(batch.ops[0]).toMatchObject({ anchorBlockId: 'b_p2' });
    // The block's own provenance still speaks for Max's text, which cited no page at all.
    expect(batch.ops[0]).toMatchObject({ prov: { pages: [], reason: expect.stringContaining('Max') } });
  });

  it('prefers the pages the question itself cites over the answer’s', () => {
    const seen: number[][] = [];
    const d = deps({
      blocksForPages: (pages) => {
        seen.push([...pages]);
        return ['b_2'];
      },
    });
    buildQuestionEdit(d, {
      questionId: 'q_9',
      objectiveId: null,
      text: 'On p. 4, why does that hold?',
      blockId: null,
      fallbackPages: [2, 6],
    });
    expect(seen).toEqual([[4]]);
  });

  /**
   * #49, the 23 Sep run: the SAT follow-up was asked on p. 7 and borrowed *"the air-cargo domain
   * from p. 4–6"* — and was filed at pp. 4–6, away from where the learner was reading.
   */
  it('files a follow-up at the page the exchange was on, ahead of an example it borrowed', () => {
    const seen: number[][] = [];
    const d = deps({
      blocksForPages: (pages) => {
        seen.push([...pages]);
        return ['b_p7'];
      },
    });
    const batch = buildQuestionEdit(d, {
      questionId: 'q_9',
      objectiveId: null,
      text: 'Take the air-cargo domain from p. 4–6: what would the CNF variables need to capture?',
      blockId: null,
      exchangePages: [7],
    })!;
    expect(seen).toEqual([[7]]);
    expect(batch.ops[0]).toMatchObject({ anchorBlockId: 'b_p7' });
    // Provenance still says what the question cites.
    expect(batch.ops[0]).toMatchObject({ prov: { pages: [4, 5, 6] } });
  });
});

describe('buildResolveEdit (§5.3)', () => {
  it('writes the notes text under the Q block, tagged with how it ended', () => {
    for (const resolution of ['you_got_this', 'partly_yours', 'released'] as const) {
      const batch = buildResolveEdit(deps(), {
        questionId: 'q_9',
        resolution,
        text: 'It matters because A* would expand the wrong node first. p. 4: "never overestimates".',
      });
      expect(batch.cause).toBe('q_resolved');
      expect(batch.ops[0]).toMatchObject({ op: 'resolve_q', questionId: 'q_9', resolution });
      expect(batch.why.length).toBeGreaterThan(0);
    }
  });

  /** A question the app has closed is closed in the notes too, even with nothing to put under it. */
  it('still closes the question, tag only, when there is no text', () => {
    const batch = buildResolveEdit(deps(), { questionId: 'q_9', resolution: 'released', text: '   ' });
    expect(batch.ops[0]).toMatchObject({ op: 'resolve_q', resolution: 'released', blocks: [], learnerAnswer: null });
  });

  it('carries the learner’s own answer separately, and a formula as a math block', () => {
    const batch = buildResolveEdit(deps(), {
      questionId: 'q_9',
      resolution: 'you_got_this',
      text: '',
      math: 'h(n) \\le h^*(n)',
      learnerAnswer: '  it never overestimates the remaining cost.  ',
      pages: [4],
    });
    const op = batch.ops[0] as Extract<(typeof batch.ops)[number], { op: 'resolve_q' }>;
    expect(op.learnerAnswer).toBe('it never overestimates the remaining cost.');
    expect(op.blocks).toEqual([{ kind: 'math', tex: 'h(n) \\le h^*(n)', prov: { pages: [4], reason: null } }]);
  });
});

describe('notesFromTurn — the fallback when the notes call cannot be had', () => {
  /** The 23 Sep feedback turn that went into the notes verbatim (#49). */
  const feedback = [
    '**Partly there.**',
    'Naming `At(c,a)` as a candidate branching variable is reasonable — it is one of the fluent variables. But the question also asked *why*, and that part is missing: the branch is picked by the solver’s own rule, not by any estimate of distance-to-goal.',
    'Why would picking `At(c,a)` first *not* count as estimating distance to the goal?',
  ].join('\n');

  it('keeps none of a feedback turn: the verdict, the marking and the question all go', () => {
    expect(notesFromTurn(feedback)).toBe('');
  });

  it('keeps the answer out of a release, without the sentence about the attempt', () => {
    const release = [
      'For `Load(C1,P1,SFO)` at time 0 the precondition becomes an implication, and each conjunct becomes its own clause.',
      'The effects become similar implications, plus frame axioms for every fluent the action leaves alone.',
      'Your attempt already had the idea that variables are indexed by time.',
      'Asking for the CNF format itself was reasonable.',
    ].join(' ');
    const out = notesFromTurn(release);
    expect(out).toContain('frame axioms');
    expect(out).not.toMatch(/attempt|reasonable/);
  });

  it('gives up rather than keep a scrap', () => {
    expect(notesFromTurn('**Well done.** You got it.')).toBe('');
    expect(notesFromTurn('This is a fair question, not an answer to score — let me actually address it.')).toBe('');
    expect(notesFromTurn(null)).toBe('');
  });

  it('keeps nothing that talks about Ellie', () => {
    expect(notesFromTurn('Ellie said the cost moves to the sender, which is wrong on p. 3.')).toBe('');
  });
});

describe('planResolveEdit (§5.3, #49)', () => {
  const base = {
    questionId: 'q_9',
    question: 'Why does admissibility matter for A*?',
    turn: '**Not yet.** You said it makes A* faster. It is what guarantees the path A* returns is optimal. Why would a faster search not be enough?',
    learnerAnswer: null,
    pages: [4],
  };

  it('writes the model’s notes text, never the turn', async () => {
    const d = deps({}, { text: 'An admissible heuristic guarantees that the first goal A* expands is on an optimal path.', math: null });
    const { batch, via } = await planResolveEdit(d, { ...base, resolution: 'released' });
    expect(via).toBe('model');
    const op = batch.ops[0] as Extract<(typeof batch.ops)[number], { op: 'resolve_q' }>;
    expect(op.blocks).toHaveLength(1);
    expect(JSON.stringify(op.blocks)).not.toMatch(/Not yet|You said|\?/);
    expect(op.blocks[0]).toMatchObject({ prov: { pages: [4] } });
    expect(d.requests[0]!.meta).toMatchObject({ scope: 'docedit', costScope: 'docedit' });
  });

  it('files the learner’s answer as theirs on *you got this*, with Max’s line only if he has one', async () => {
    const d = deps({}, { text: null });
    const { batch } = await planResolveEdit(d, {
      ...base,
      resolution: 'you_got_this',
      learnerAnswer: 'it never overestimates so the first goal A* pops is optimal',
    });
    const op = batch.ops[0] as Extract<(typeof batch.ops)[number], { op: 'resolve_q' }>;
    expect(op.learnerAnswer).toBe('it never overestimates so the first goal A* pops is optimal');
    expect(op.blocks).toEqual([]);
    const prompt = (d.requests[0]!.system as { text: string }[])[0]!.text;
    expect(prompt).toContain('Their answer is the entry');
  });

  it('falls back to the cleaned turn when the reply cannot be read', async () => {
    const d = deps({}, {});
    const { batch, via } = await planResolveEdit(d, { ...base, resolution: 'released' });
    expect(via).toBe('fallback');
    const op = batch.ops[0] as Extract<(typeof batch.ops)[number], { op: 'resolve_q' }>;
    expect(JSON.stringify(op.blocks)).toContain('guarantees the path A* returns is optimal');
    expect(JSON.stringify(op.blocks)).not.toMatch(/Not yet|You said/);
  });

  it('does not put Max’s praise in place of a failed completion line', async () => {
    const { batch, via } = await planResolveEdit(deps({}, {}), {
      ...base,
      resolution: 'you_got_this',
      turn: '**Well done.** That is exactly the property the slide names on p. 4, and the reason A* can stop at the first goal.',
      learnerAnswer: 'it never overestimates',
    });
    expect(via).toBe('none');
    expect((batch.ops[0] as { blocks: unknown[] }).blocks).toEqual([]);
  });

  it('tells the model the notes are not the chat', () => {
    const prompt = resolveNotesPrompt({ ...base, resolution: 'released' });
    expect(prompt).toMatch(/No verdict/);
    expect(prompt).toMatch(/No second person/);
    expect(prompt).toMatch(/No question/);
    expect(prompt).toContain(base.question);
  });
});

describe('planSuggestionEdit — the three ways it can come back empty', () => {
  const input = {
    blockId: 'b_mine',
    text: 'Manhattan is admissible on the 8-puzzle because it never overestimates.',
    feedback: 'Not yet. It is admissible because it never overestimates the remaining cost.',
    threadId: 'span_aaaaaaaaaaaa',
  };

  it('says which one it was, so a missing suggestion is never silent again', async () => {
    const declined = await planSuggestionEdit(deps({}, { suggest: false }), input);
    expect(declined).toMatchObject({ batch: null, reason: 'declined', how: null });

    const unlocatable = await planSuggestionEdit(
      deps({}, { suggest: true, quote: 'the Hessian is positive semidefinite', replacement: 'x' }),
      input,
    );
    expect(unlocatable).toMatchObject({ batch: null, reason: 'not_located' });
    expect(unlocatable.quoteChars).toBeGreaterThan(0);

    const empty = await planSuggestionEdit(
      deps({}, { suggest: true, quote: 'never overestimates', replacement: '   ' }),
      input,
    );
    expect(empty).toMatchObject({ batch: null, reason: 'no_replacement', how: 'verbatim' });
  });

  it('reports how the quote was found when it does suggest', async () => {
    const plan = await planSuggestionEdit(
      deps({}, { suggest: true, quote: 'never overestimates', replacement: 'never overestimates the cost', note: 'n' }),
      input,
    );
    expect(plan.reason).toBe('suggested');
    expect(plan.how).toBe('verbatim');
    expect(plan.batch!.suggestion!.quote).toBe('never overestimates');
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

  /**
   * The live run of 20 Sep: Max named the correction in the chat ("replace … with …") and the
   * document got no suggestion at all, because the quote came back reworded. A quote that is
   * *nearly* theirs is repaired down to the part that really is theirs; one that is not theirs
   * at all is still refused, which is what the case above asserts.
   */
  it('trims a nearly-verbatim quote down to the run the learner actually wrote', () => {
    const batch = buildSuggestionEdit(deps(), {
      ...base,
      // The model extended past the end of their sentence and normalised the full stop away.
      quote: 'it never overestimates the true distance',
    })!;
    expect(batch.suggestion!.quote).toBe('it never overestimates');
    expect(base.text).toContain(batch.suggestion!.quote);
  });

  it('falls back to their whole sentence when the model rewrote one sentence of one', () => {
    const batch = buildSuggestionEdit(deps(), {
      ...base,
      quote: 'Manhattan distance is admissible for the eight puzzle since it never overestimates',
    })!;
    expect(batch.suggestion!.quote).toBe(base.text);
  });

  it('never suggests a quote that is not a substring of their text', () => {
    for (const quote of ['never under-estimates', 'the Hessian is positive semidefinite', 'x']) {
      const batch = buildSuggestionEdit(deps(), { ...base, quote });
      if (batch) expect(base.text).toContain(batch.suggestion!.quote);
    }
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

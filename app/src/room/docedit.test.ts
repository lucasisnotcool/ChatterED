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
import type { AgentDocOpBatch, OutlineEntry } from '../shared/doc/types.js';
import { ANSWER_EDIT_PASSAGE_CHARS, BACKGROUND_REASON, NOTE_MAX_WORDS, anchorOfNote, blockNotePrompt, blocksFromTurn, buildQuestionEdit, buildResolveEdit, buildSuggestionEdit, buildWhisperInsert, earlierNotes, noteAnchorOf, noteToUpdate, notesFromTurn, outlineText, pagesCited, planBlockNote, planSuggestionEdit, provenanceFor, trimToWords, type DocEditDeps } from './docedit.js';
import { generateBlockPrompt, planGeneratedBlock } from './generate.js';
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

/**
 * **The one line under the block** (`notebooks.md` §4.2, contract C7), which replaced §5.1's
 * 40–150-word planner. What is pinned: the limit is enforced in code (retry once, then cut at a
 * clause, never mid-word), the line always lands under the block a button named, the provenance
 * order, and that a doc-chat answer with no block may come back with nothing.
 */
describe('planBlockNote (notebooks §4.2)', () => {
  /** A client that answers each call with the next reply in the list. */
  function seq(replies: (Record<string, unknown> | Error)[]) {
    const d = deps();
    let i = 0;
    d.llm = {
      kind: 'scripted',
      async complete(request) {
        d.requests.push(request);
        const reply = replies[Math.min(i, replies.length - 1)]!;
        i += 1;
        if (reply instanceof Error) throw reply;
        return { text: JSON.stringify(reply), model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'scripted' as const };
      },
    };
    return d;
  }
  const LONG =
    'An admissible heuristic never overestimates the true cost to the goal, which is why A* with it returns an optimal path, ' +
    'and consistency adds the triangle inequality on top of that guarantee for graph search.';

  it('inserts one paragraph under the named block, by Ellie, with the block_action cause', async () => {
    const d = seq([{ line: 'Admissibility is what makes A* tree search optimal.', why: 'the point most worth keeping' }]);
    const out = await planBlockNote(d, { kind: 'explain', answer: 'Long answer on p. 4.', blockId: 'b_2', outline: OUTLINE });
    expect(out.outcome).toBe('written');
    expect(out.batch).toMatchObject({ author: 'ellie', cause: 'block_action', focusBlockId: 'b_2' });
    expect(out.batch!.ops).toEqual([
      {
        op: 'insert_after',
        anchorBlockId: 'b_2',
        blocks: [{ kind: 'paragraph', text: 'Admissibility is what makes A* tree search optimal.', prov: { pages: [4], reason: null } }],
      },
    ]);
    expect(d.requests[0]!.jsonSchema).toBeTypeOf('object');
    expect(d.requests[0]!.meta.costScope).toBe('docedit');
  });

  /** Over the 120-word ceiling of §11.2 (amended 2026-10-06): four times LONG is about 140 words. */
  const LONGER = `${LONG} ${LONG} ${LONG} ${LONG}`;

  /** Decision 6 (6 Oct afternoon): while Max's question is open, the note may not hold its answer. */
  it('tells the note about an open question, and writes nothing when the note states its key', async () => {
    const openQuestion = {
      text: 'Why does A* with an admissible heuristic return an optimal path?',
      keyPoints: ['An admissible heuristic never overestimates the remaining cost, so A* never skips the optimal path.'],
    };
    const leaky = seq([{ line: 'An admissible heuristic never overestimates the remaining cost, so A* never skips the optimal path.', why: 'x' }]);
    const held = await planBlockNote(leaky, { kind: 'explain', answer: 'a', blockId: 'b_2', outline: OUTLINE, openQuestion });
    expect(held).toMatchObject({ batch: null, outcome: 'held' });
    expect(leaky.requests[0]!.system[0]!.text).toContain('MAX HAS A QUESTION OPEN FOR THE LEARNER');
    expect(leaky.requests[0]!.system[0]!.text).toContain(openQuestion.text);

    const fine = seq([{ line: 'A heuristic is a cheap estimate of the cost still to go.', why: 'x' }]);
    const written = await planBlockNote(fine, { kind: 'explain', answer: 'a', blockId: 'b_2', outline: OUTLINE, openQuestion });
    expect(written.outcome).toBe('written');
    // No open question, no such block in the prompt.
    const plain = seq([{ line: 'A heuristic is a cheap estimate.', why: 'x' }]);
    await planBlockNote(plain, { kind: 'explain', answer: 'a', blockId: 'b_2', outline: OUTLINE });
    expect(plain.requests[0]!.system[0]!.text).not.toContain('MAX HAS A QUESTION OPEN');
  });

  it('asks once more on an overflow, and takes the second note when it fits', async () => {
    const d = seq([{ line: LONGER, why: 'x' }, { line: 'Admissible heuristics never overestimate, so A* is optimal.', why: 'x' }]);
    const out = await planBlockNote(d, { kind: 'explain', answer: 'a', blockId: 'b_2', outline: OUTLINE });
    expect(d.requests).toHaveLength(2);
    expect(d.requests[1]!.system[0]!.text).toContain('OVER ITS LIMIT OF 120');
    expect(out).toMatchObject({ outcome: 'written', retried: true });
    expect(out.words).toBeLessThanOrEqual(120);
  });

  it('cuts a second overflow at the last full clause within 120 words, never mid-word', async () => {
    const d = seq([{ line: LONGER, why: 'x' }, { line: LONGER, why: 'x' }]);
    const out = await planBlockNote(d, { kind: 'explain', answer: 'a', blockId: 'b_2', outline: OUTLINE });
    expect(out.outcome).toBe('trimmed');
    const text = (out.batch!.ops[0] as { blocks: { text: string }[] }).blocks[0]!.text;
    expect(LONGER.startsWith(text.slice(0, -1))).toBe(true);
    expect(text.endsWith('.')).toBe(true);
    expect(out.words).toBeLessThanOrEqual(120);
    expect(out.words).toBeGreaterThan(100);
  });

  it('cuts a note of several blocks from its end first', async () => {
    const para = (text: string) => ({ form: 'paragraph', text });
    const d = seq([
      { note_kind: 'detail', blocks: [para(LONG), para(LONG), para(LONG), para(LONG)], why: 'x' },
      { note_kind: 'detail', blocks: [para(LONG), para(LONG), para(LONG), para(LONG)], why: 'x' },
    ]);
    const out = await planBlockNote(d, { kind: 'explain', answer: 'a', blockId: 'b_2', outline: OUTLINE });
    expect(out.outcome).toBe('trimmed');
    expect((out.batch!.ops[0] as { blocks: unknown[] }).blocks).toHaveLength(3);
  });

  it('cuts at a word when no clause ends within the budget, and says so', () => {
    const run = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const cut = trimToWords(run, 25);
    expect(cut.endsWith('word24…')).toBe(true);
    expect(cut.split(' ')).toHaveLength(25);
    expect(trimToWords('Short enough.', 25)).toBe('Short enough.');
  });

  it('always writes a line on a block action: the chat answer’s first notes-worthy sentence when the call fails', async () => {
    const d = seq([new Error('cli exited 1')]);
    const out = await planBlockNote(d, {
      kind: 'example',
      answer: 'Take the 8-puzzle with Manhattan distance as the heuristic for every tile. Do you see why?',
      blockId: 'b_2',
      outline: OUTLINE,
    });
    expect(out.outcome).toBe('fallback');
    expect(out.batch!.ops[0]).toMatchObject({ op: 'insert_after', anchorBlockId: 'b_2' });
  });

  it('rejects a question for a line', async () => {
    const d = seq([{ line: 'Why does admissibility matter?', why: 'x' }]);
    const out = await planBlockNote(d, { kind: 'explain', answer: 'Admissibility guarantees that A* returns an optimal path on trees.', blockId: 'b_2', outline: OUTLINE });
    expect(out.outcome).toBe('fallback');
    expect(JSON.stringify(out.batch)).not.toContain('?');
  });

  it('takes provenance from the line, then the block, then the answer, then a reason', async () => {
    const noPages: OutlineEntry[] = [{ ...OUTLINE[1]!, pages: [] }];
    const cases: [OutlineEntry[], string, string, unknown][] = [
      [OUTLINE, 'A line (p. 7).', 'p. 9', { pages: [7], reason: null }],
      [OUTLINE, 'A line here.', 'p. 9', { pages: [4], reason: null }],
      [noPages, 'A line here.', 'see p. 9', { pages: [9], reason: null }],
      [noPages, 'A line here.', 'no page', { pages: [], reason: 'a point Ellie added from her answer' }],
    ];
    for (const [outline, line, answer, prov] of cases) {
      const out = await planBlockNote(seq([{ line, why: 'x' }]), { kind: 'explain', answer, blockId: 'b_2', outline });
      const block = (out.batch!.ops[0] as { blocks: { text: string; prov: unknown }[] }).blocks[0]!;
      expect(block.prov, line + answer).toEqual(prov);
      // The marker is the chip's job, not the sentence's.
      expect(block.text).not.toContain('p. 7');
    }
  });

  it('lets a doc-chat answer with no block pick one from the outline, or write nothing', async () => {
    const picked = await planBlockNote(seq([{ line: 'Consistency implies admissibility.', anchor_block_id: 'b_2', why: 'x' }]), {
      kind: 'answer',
      answer: 'a',
      blockId: null,
      outline: OUTLINE,
    });
    expect(picked.batch!.ops[0]).toMatchObject({ anchorBlockId: 'b_2' });
    const none = await planBlockNote(seq([{ line: null, anchor_block_id: null, why: 'nothing fits' }]), {
      kind: 'answer',
      answer: 'a',
      blockId: null,
      outline: OUTLINE,
    });
    expect(none).toMatchObject({ batch: null, outcome: 'declined' });
    // A pick that is not in the outline is not trusted.
    const stray = await planBlockNote(seq([{ line: 'A line.', anchor_block_id: 'b_nowhere', why: 'x' }]), {
      kind: 'answer',
      answer: 'a',
      blockId: null,
      outline: OUTLINE,
    });
    expect(stray.batch).toBeNull();
  });

  /** Live run, 1 Oct 2026: "Added one line under that heading.", above the section's takeaway. */
  it('files a doc-chat line picked onto a heading under the block the heading heads', async () => {
    const d = seq([{ line: 'Admissible means never overestimating.', anchor_block_id: 'b_1', why: 'x' }]);
    d.docPort = { ...d.docPort, outlineNear: () => OUTLINE };
    const out = await planBlockNote(d, { kind: 'answer', answer: 'a', blockId: null, outline: OUTLINE });
    expect(out.batch!.ops[0]).toMatchObject({ anchorBlockId: 'b_2' });
    // A heading with another heading (or nothing) next keeps the pick.
    const lone = seq([{ line: 'Admissible means never overestimating.', anchor_block_id: 'b_1', why: 'x' }]);
    lone.docPort = { ...lone.docPort, outlineNear: () => [OUTLINE[0]!] };
    const kept = await planBlockNote(lone, { kind: 'answer', answer: 'a', blockId: null, outline: OUTLINE });
    expect(kept.batch!.ops[0]).toMatchObject({ anchorBlockId: 'b_1' });
  });

  it('shows the block, the slide, the question and the chat answer, and says what the line is', () => {
    const passage = 'An admissible heuristic never overestimates. '.repeat(100);
    const prompt = blockNotePrompt({ kind: 'example', answer: 'THE-CHAT', question: 'why?', passage, page: 4, blockId: 'b_2', outline: OUTLINE });
    expect(prompt).toContain('THE BLOCK IT GOES DIRECTLY UNDER (b_2)');
    expect(prompt).toContain('THE SOURCE PAGE (p. 4)');
    expect(prompt).toContain('THE-CHAT');
    expect(prompt).toContain('the example in brief');
    expect(prompt).toContain('At most 120 words in all');
    expect(prompt).toContain(passage.slice(0, ANSWER_EDIT_PASSAGE_CHARS).trim());
    expect(prompt).not.toContain(passage.trim());
    expect(blockNotePrompt({ kind: 'answer', answer: 'a', blockId: null, outline: OUTLINE })).toContain('anchor_block_id');
  });

  /**
   * `notebooks.md` §4.2, amended 2026-10-02: the note follows what the exchange uncovered. A gap
   * the notes assumed becomes a background note of up to 90 words, labelled as background rather
   * than cited to the source; specifics become a detail of up to 50; otherwise the 25-word point.
   */
  const BACKGROUND =
    'Fine-tuning continues training a pretrained model on a small task-specific dataset, so it adapts to the task instead of learning from scratch. ' +
    'LoRA freezes the original weights and trains small low-rank matrices added to them, which makes fine-tuning an 8-billion-parameter model affordable.';

  it('says in the prompt what each kind is for, and one ceiling for all (§11.2)', () => {
    const prompt = blockNotePrompt({ kind: 'answer', answer: 'a', question: 'how is fine-tuning done in general?', blockId: 'b_2', outline: OUTLINE });
    expect(prompt).toContain('**background**: the question or the answer shows');
    expect(prompt).toContain('**detail**: the source gives specifics');
    expect(prompt).toContain('**point**: otherwise');
    expect(prompt).toContain('At most 120 words in all, formulas not counted');
    expect(prompt.replace(/\s+/g, ' ')).toContain('what the notes already say is not the note');
    expect(NOTE_MAX_WORDS).toEqual({ background: 120, detail: 120, point: 120 });
  });

  it('writes a background note of up to 90 words, labelled as background the source assumes', async () => {
    const d = seq([{ note_kind: 'background', line: BACKGROUND, why: 'the gap the question uncovered' }]);
    const out = await planBlockNote(d, { kind: 'answer', answer: 'Fine-tuning means… (p. 5)', blockId: 'b_2', outline: OUTLINE });
    expect(out).toMatchObject({ outcome: 'written', retried: false, noteKind: 'background' });
    expect(out.words).toBeGreaterThan(25);
    expect(out.batch!.ops[0]).toMatchObject({
      op: 'insert_after',
      anchorBlockId: 'b_2',
      blocks: [{ kind: 'paragraph', text: BACKGROUND, prov: { pages: [], reason: BACKGROUND_REASON } }],
    });
  });

  it('holds every kind to the 120-word ceiling, and keeps a 50-word point whole (§11.2)', async () => {
    const long = `${BACKGROUND} ${BACKGROUND} ${BACKGROUND}`;
    const detail = await planBlockNote(seq([{ note_kind: 'detail', line: long, why: 'x' }, { note_kind: 'detail', line: long, why: 'x' }]), {
      kind: 'explain',
      answer: 'a',
      blockId: 'b_2',
      outline: OUTLINE,
    });
    expect(detail).toMatchObject({ outcome: 'trimmed', noteKind: 'detail' });
    expect(detail.words).toBeLessThanOrEqual(NOTE_MAX_WORDS.detail);
    expect(detail.batch!.ops[0]).toMatchObject({ blocks: [{ prov: { pages: [4], reason: null } }] });

    const point = await planBlockNote(seq([{ line: BACKGROUND, why: 'x' }]), { kind: 'explain', answer: 'a', blockId: 'b_2', outline: OUTLINE });
    expect(point).toMatchObject({ noteKind: 'point', outcome: 'written', retried: false });
    expect(point.words).toBeGreaterThan(25);
  });

  // ── §11.2 (amended 2026-10-06): forms, and Ellie writing into a concept card ──

  it('writes a list, a formula and a table, not only a plain paragraph', async () => {
    const d = seq([
      {
        note_kind: 'detail',
        blocks: [
          { form: 'paragraph', text: 'The update spreads value one step per sweep.' },
          { form: 'math', tex: '$$U_{i+1}(s) = R(s) + \\gamma \\max_a \\sum_{s\'} P(s\'|s,a) U_i(s\')$$' },
          { form: 'bullets', items: ['$\\gamma$: the discount', '$U_i$: the utilities after sweep $i$'] },
          { form: 'table', text: 'VI vs PI', columns: ['Aspect', 'VI', 'PI'], rows: [['Sweep cost', '$O(|S|^2|A|)$', '$O(|S|^3)$']] },
          { form: 'paragraph', text: 'A fifth block is one too many.' },
        ],
        why: 'x',
      },
    ]);
    const out = await planBlockNote(d, { kind: 'explain', answer: 'a', blockId: 'b_2', outline: OUTLINE });
    const blocks = (out.batch!.ops[0] as { blocks: { kind: string; tex?: string }[] }).blocks;
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'math', 'bullets', 'table']);
    expect(blocks[1]!.tex!.startsWith('U_{i+1}')).toBe(true);
    // Formulas are not words.
    expect(out.words).toBeLessThan(30);
  });

  const CARD_OUTLINE: OutlineEntry[] = [
    { blockId: 'b_h', kind: 'heading', path: [], text: 'Policy iteration', pages: [39], learnerText: false, questionId: null },
    { blockId: 'b_card', kind: 'concept', path: ['Policy iteration'], text: 'Policy iteration: evaluate, improve, repeat.', pages: [39], learnerText: false, questionId: null, cardId: 'b_card' },
    { blockId: 'b_core', kind: 'paragraph', path: ['Policy iteration'], text: 'Policy iteration: evaluate, improve, repeat.', pages: [39], learnerText: false, questionId: null, cardId: 'b_card' },
    { blockId: 'b_eq', kind: 'concept_item', path: ['Policy iteration'], text: '[equation] $$U = …$$', pages: [39], learnerText: false, questionId: null, cardId: 'b_card', role: 'equation' },
    { blockId: 'b_eq_m', kind: 'math_block', path: ['Policy iteration'], text: 'U = …', pages: [39], learnerText: false, questionId: null, cardId: 'b_card', role: 'equation' },
    { blockId: 'b_ex', kind: 'concept_item', path: ['Policy iteration'], text: '[example] my own case', pages: [40], learnerText: true, questionId: null, cardId: 'b_card', role: 'example' },
  ];

  it('in a card, goes into the card’s depth: the item the model names, extending or replacing it', async () => {
    const d = seq([{ note_kind: 'background', line: 'Evaluation solves a linear system, because no max appears.', role: 'equation', mode: 'replace', why: 'x' }]);
    const out = await planBlockNote(d, { kind: 'explain', answer: 'a', blockId: 'b_core', outline: CARD_OUTLINE });
    expect(out.card).toBe(true);
    expect(out.batch!.focusBlockId).toBe('b_core');
    expect(out.batch!.ops).toEqual([
      {
        op: 'card_attach',
        cardBlockId: 'b_card',
        role: 'equation',
        mode: 'replace',
        blocks: [{ kind: 'paragraph', text: 'Evaluation solves a linear system, because no max appears.', prov: { pages: [], reason: BACKGROUND_REASON } }],
        prov: { pages: [], reason: BACKGROUND_REASON },
      },
    ]);
    const prompt = d.requests[0]!.system[0]!.text;
    expect(prompt).toContain('THE CONCEPT CARD IT GOES INTO (“Policy iteration”)');
    expect(prompt).toContain('- example (the learner wrote in this item): [example] my own case');
    expect(prompt).toContain('THE BLOCK IT WAS ASKED ON (b_core)');
  });

  it('in a card with no role named, extends the item it was asked on, else intuition for Explain and example for Example', async () => {
    const onEq = await planBlockNote(seq([{ line: 'Each symbol, in English.', why: 'x' }]), { kind: 'explain', answer: 'a', blockId: 'b_eq_m', outline: CARD_OUTLINE });
    expect(onEq.batch!.ops[0]).toMatchObject({ op: 'card_attach', role: 'equation', mode: 'extend' });
    const onCore = await planBlockNote(seq([{ line: 'A picture of it.', why: 'x' }]), { kind: 'explain', answer: 'a', blockId: 'b_core', outline: CARD_OUTLINE });
    expect(onCore.batch!.ops[0]).toMatchObject({ role: 'intuition' });
    const example = await planBlockNote(seq([{ line: 'A worked case: 0.8 × 1 = 0.8.', why: 'x' }]), { kind: 'example', answer: 'a', blockId: 'b_core', outline: CARD_OUTLINE });
    expect(example.batch!.ops[0]).toMatchObject({ role: 'example', mode: 'extend' });
    // Outside a card, under the block, as before.
    const outside = await planBlockNote(seq([{ line: 'A line.', why: 'x' }]), { kind: 'explain', answer: 'a', blockId: 'b_h', outline: CARD_OUTLINE });
    expect(outside).toMatchObject({ card: false });
    expect(outside.batch!.ops[0]).toMatchObject({ op: 'insert_after', anchorBlockId: 'b_h' });
  });
});

/**
 * **Decision 11 (6 Oct afternoon): update or add, Ellie's choice, checked in code.** The outline is
 * the Lecture-sdm run's "Reinforcement learning set-up" after #28 and #30: two notes of hers
 * stacked under one paragraph, the second partly repeating the first.
 */
describe('Ellie’s earlier notes (decision 11)', () => {
  const RL: OutlineEntry[] = [
    { blockId: 'b_h', kind: 'heading', path: [], text: 'Reinforcement learning set-up', pages: [18], learnerText: false, questionId: null },
    { blockId: 'b_e8', kind: 'paragraph', path: ['Reinforcement learning set-up'], text: 'The agent acts in an unknown MDP.', pages: [18], learnerText: false, questionId: null },
    { blockId: 'b_n1', kind: 'paragraph', path: ['Reinforcement learning set-up'], text: 'RL does not drop full observability; what is unknown is the model.', pages: [18], learnerText: false, questionId: null, by: 'ellie', editId: 'edit_1' },
    { blockId: 'b_n1m', kind: 'math_block', path: ['Reinforcement learning set-up'], text: "T(s,a,s') = P(s'|s,a)", pages: [18], learnerText: false, questionId: null },
    { blockId: 'b_n1b', kind: 'paragraph', path: ['Reinforcement learning set-up'], text: 'A known MDP is solved offline.', pages: [18], learnerText: false, questionId: null, by: 'ellie', editId: 'edit_1' },
    { blockId: 'b_n2', kind: 'paragraph', path: ['Reinforcement learning set-up'], text: 'RL applies when the agent does not know the model.', pages: [19], learnerText: false, questionId: null, by: 'ellie', editId: 'edit_2' },
    { blockId: 'b_next', kind: 'paragraph', path: ['Reinforcement learning set-up'], text: 'Passive and active agents differ.', pages: [22], learnerText: false, questionId: null },
  ];
  function seq(reply: Record<string, unknown>) {
    const d = deps();
    d.llm = {
      kind: 'scripted',
      async complete(request) {
        d.requests.push(request);
        return { text: JSON.stringify(reply), model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'scripted' as const };
      },
    };
    return d;
  }
  const NOTE = 'RL is for an unknown model: both $P(s\'|s,a)$ and $R$ are learned from acting.';

  it('finds her notes straight under the block, one per edit, never a formula and never past another block', () => {
    expect(earlierNotes(RL, 'b_e8')).toEqual([
      { id: 'b_n1', blockIds: ['b_n1', 'b_n1b'], text: 'RL does not drop full observability; what is unknown is the model. A known MDP is solved offline.' },
      { id: 'b_n2', blockIds: ['b_n2'], text: 'RL applies when the agent does not know the model.' },
    ]);
    expect(earlierNotes(RL, 'b_next')).toEqual([]);
    expect(earlierNotes(RL, null)).toEqual([]);
    // A learner's line between ends the run: what is after it is not "under this block".
    const mine = RL.map((e) => (e.blockId === 'b_n1' ? { ...e, by: undefined, learnerText: true } : e));
    expect(earlierNotes(mine, 'b_e8')).toEqual([]);
    expect(noteToUpdate(earlierNotes(RL, 'b_e8'), 'b_n1b')!.id).toBe('b_n1');
    expect(noteToUpdate(earlierNotes(RL, 'b_e8'), 'b_next')).toBeNull();
    expect(anchorOfNote(RL, 'b_n2')).toBe('b_e8');
    expect(anchorOfNote(RL, 'b_next')).toBeNull();
  });

  it('shows her the notes and lets her update one: the first block is replaced, the rest removed, the formula kept', async () => {
    const d = seq({ line: NOTE, update_note: 'b_n1', why: 'sharpens the first note' });
    const out = await planBlockNote(d, { kind: 'answer', answer: 'a', blockId: 'b_e8', outline: RL });
    const prompt = d.requests[0]!.system[0]!.text;
    expect(prompt).toContain('YOUR EARLIER NOTES UNDER THIS BLOCK');
    expect(prompt).toContain('- b_n1: RL does not drop full observability');
    expect(prompt).toContain('(Ellie’s note)');
    expect(out).toMatchObject({ placement: 'updated', updateRefused: false, outcome: 'written' });
    expect(out.batch!.ops).toEqual([
      { op: 'replace_block', blockId: 'b_n1', blocks: [{ kind: 'paragraph', text: NOTE, prov: { pages: [18], reason: null } }] },
      { op: 'remove_block', blockId: 'b_n1b' },
    ]);
    expect(out.batch!.focusBlockId).toBe('b_e8');
  });

  it('adds a new note when she says so, and refuses an update of anything that is not hers under the block', async () => {
    const added = await planBlockNote(seq({ line: NOTE, update_note: null, why: 'x' }), { kind: 'answer', answer: 'a', blockId: 'b_e8', outline: RL });
    expect(added).toMatchObject({ placement: 'added', updateRefused: false });
    expect(added.batch!.ops).toEqual([{ op: 'insert_after', anchorBlockId: 'b_e8', blocks: [expect.objectContaining({ text: NOTE })] }]);
    for (const named of ['b_next', 'b_e8', 'b_n1m', 'b_nowhere']) {
      const refused = await planBlockNote(seq({ line: NOTE, update_note: named, why: 'x' }), { kind: 'answer', answer: 'a', blockId: 'b_e8', outline: RL });
      expect(refused).toMatchObject({ placement: 'added', updateRefused: true });
      expect(refused.batch!.ops[0]).toMatchObject({ op: 'insert_after', anchorBlockId: 'b_e8' });
    }
  });

  it('on a doc-chat question with no block, finds the block the named note sits under', async () => {
    const out = await planBlockNote(seq({ line: NOTE, update_note: 'b_n2', anchor_block_id: null, why: 'x' }), {
      kind: 'answer',
      answer: 'a',
      blockId: null,
      outline: RL,
    });
    expect(out).toMatchObject({ placement: 'updated' });
    expect(out.batch!.ops[0]).toMatchObject({ op: 'replace_block', blockId: 'b_n2' });
    expect(out.batch!.focusBlockId).toBe('b_e8');
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

  /** Quiz me on a line cited to p. 38 (live run, 1 Oct 2026): the question did not repeat the page. */
  it('cites the pages of the block it was asked on when the question cites none', () => {
    const d = deps({ outlineNear: () => OUTLINE });
    const batch = buildQuestionEdit(d, { questionId: 'q_9', objectiveId: null, text: 'In your own words, why?', blockId: 'b_2' })!;
    expect(batch.ops[0]).toMatchObject({ anchorBlockId: 'b_2', prov: { pages: [4], reason: null } });
    // Its own citation still wins, and with no block there is only the reason.
    const cited = buildQuestionEdit(d, { questionId: 'q_8', objectiveId: null, text: 'Why does p. 7 say so?', blockId: 'b_2' })!;
    expect(cited.ops[0]).toMatchObject({ prov: { pages: [7], reason: null } });
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

  // Decisions 12 and 14 (6 Oct afternoon, #67).
  it('carries Max’s chip sentence on you got this only, and says what a recall keeps', () => {
    const note = 'An admissible heuristic never overestimates the remaining cost.';
    const earned = buildResolveEdit(deps(), { questionId: 'q_9', resolution: 'you_got_this', text: '', maxNote: ` ${note} ` });
    expect(earned.ops[0]).toMatchObject({ op: 'resolve_q', maxNote: note });
    const revisit = buildResolveEdit(deps(), { questionId: 'q_9', resolution: 'revisit', text: '', maxNote: note });
    expect(revisit.ops[0]).not.toHaveProperty('maxNote');
    const recall = buildResolveEdit(deps(), { questionId: 'q_9', resolution: 'recall', text: '', learnerAnswer: 'admissible' });
    expect(recall.ops[0]).toMatchObject({ resolution: 'recall', learnerAnswer: 'admissible' });
    expect(recall.why).toMatch(/recalled/);
    expect(recall.why).not.toMatch(/revisit/);
  });

  it('names the block a doc edit went to, for filing a doc-chat question (decision 8)', () => {
    const prov = { pages: [4], reason: null };
    const batch = (ops: AgentDocOpBatch['ops']): AgentDocOpBatch => ({ editId: 'e', author: 'ellie', cause: 'answer_missing', ops, focusBlockId: null, why: '' });
    expect(noteAnchorOf(batch([{ op: 'card_attach', cardBlockId: 'c_1', role: 'note', mode: 'extend', blocks: [], prov }]))).toBe('c_1');
    expect(noteAnchorOf(batch([{ op: 'insert_after', anchorBlockId: 'b_2', blocks: [] }]))).toBe('b_2');
    expect(noteAnchorOf(batch([{ op: 'replace_block', blockId: 'b_3', blocks: [] }]))).toBe('b_3');
    expect(noteAnchorOf(batch([{ op: 'resolve_q', questionId: 'q', resolution: 'revisit', blocks: [] }]))).toBeNull();
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

// ── §5.7: a table or a diagram, asked for at a place in the notes ──────────

describe('planGeneratedBlock', () => {
  const TABLE = {
    make: true,
    why: 'Compares the two heuristics the section names.',
    table: {
      caption: 'Two heuristics',
      columns: ['Heuristic', 'Admissible'],
      rows: [
        { cells: ['Manhattan', 'yes'], pages: [4] },
        { cells: ['Misplaced tiles', 'yes'], pages: [4, 99] },
      ],
    },
  };
  const DIAGRAM = {
    make: true,
    why: 'The three steps in order.',
    diagram: {
      layout: 'flow',
      title: 'A* in three steps',
      nodes: [
        { id: 'a', label: 'Pick the lowest f', pages: [4] },
        { id: 'b', label: 'Expand it' },
        { id: 'c', label: 'Stop at the goal' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'zzz' },
      ],
    },
  };
  const input = (kind: 'table' | 'diagram') => ({
    kind,
    instruction: 'compare the heuristics',
    anchorBlockId: 'b_2',
    section: OUTLINE,
    passage: 'Slide 4: admissible heuristics never overestimate.',
    pageCount: 10,
  });

  it('inserts a validated table after the block the learner was in, as Ellie’s edit', async () => {
    const d = deps({}, TABLE);
    const { batch, reason } = await planGeneratedBlock(d, input('table'));

    expect(reason).toBe('inserted');
    expect(batch).toMatchObject({ author: 'ellie', cause: 'answer_missing', focusBlockId: 'b_2', why: TABLE.why });
    const op = batch!.ops[0]!;
    expect(op).toMatchObject({ op: 'insert_after', anchorBlockId: 'b_2' });
    const draft = (op as { blocks: unknown[] }).blocks[0] as { kind: string; columns: string[]; rows: { cells: string[]; pages?: number[] }[]; prov: { pages: number[] } };
    expect(draft.kind).toBe('table');
    expect(draft.columns).toEqual(['Heuristic', 'Admissible']);
    // A page outside the deck is dropped, not trusted; the block's own provenance is the section's.
    expect(draft.rows[1]!.pages).toEqual([4]);
    expect(draft.prov.pages).toEqual([4]);
  });

  it('inserts a validated diagram, dropping an edge to a node that does not exist', async () => {
    const d = deps({}, DIAGRAM);
    const { batch, reason, problems } = await planGeneratedBlock(d, input('diagram'));

    expect(reason).toBe('inserted');
    const draft = (batch!.ops[0] as { blocks: unknown[] }).blocks[0] as { kind: string; layout: string; nodes: unknown[]; edges: unknown[] };
    expect(draft).toMatchObject({ kind: 'diagram', layout: 'flow' });
    expect(draft.nodes).toHaveLength(3);
    expect(draft.edges).toHaveLength(2);
    expect(problems.length).toBeGreaterThan(0);
  });

  it('inserts nothing when the model says the section has nothing to show', async () => {
    const d = deps({}, { make: false, why: 'One idea, nothing to compare.' });
    expect(await planGeneratedBlock(d, input('table'))).toEqual({ batch: null, reason: 'declined', problems: [] });
  });

  it('inserts nothing when the reply does not pass validation, and says why', async () => {
    const ragged = { make: true, why: 'x', table: { columns: ['A', 'B'], rows: [{ cells: ['only one'] }] } };
    const out = await planGeneratedBlock(deps({}, ragged), input('table'));
    expect(out.batch).toBeNull();
    expect(out.reason).toBe('invalid');
    expect(out.problems.length).toBeGreaterThan(0);
  });

  it('gives the block a reason when the section has no pages, so it never arrives without provenance', async () => {
    const d = deps({}, { ...TABLE, table: { ...TABLE.table, rows: [{ cells: ['Manhattan', 'yes'] }] } });
    const noPages = OUTLINE.map((e) => ({ ...e, pages: [] }));
    const { batch } = await planGeneratedBlock(d, { ...input('table'), section: noPages });
    const draft = (batch!.ops[0] as { blocks: { prov: { pages: number[]; reason: string | null } }[] }).blocks[0]!;
    expect(draft.prov.pages).toEqual([]);
    expect(draft.prov.reason).toContain('table');
  });

  it('is a schema-bound docedit call that shows the model the section, the slides and the ask, and nothing else', async () => {
    const d = deps({}, TABLE);
    await planGeneratedBlock(d, input('table'));
    const request = d.requests[0]!;
    expect(request.meta).toMatchObject({ scope: 'docedit', costScope: 'docedit', fileId: 'f_1' });
    const schema = request.jsonSchema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.required).toEqual(['make', 'why']);
    expect(Object.keys(schema.properties)).toEqual(['make', 'why', 'table']);
    const prompt = request.system[0]!.text;
    expect(prompt).toContain('An admissible heuristic never overestimates.');
    expect(prompt).toContain('Slide 4: admissible heuristics never overestimate.');
    expect(prompt).toContain('compare the heuristics');
    expect(prompt).toContain('"make": false');
  });

  it('describes the four layouts for a diagram, and never general knowledge for a table', () => {
    const diagram = generateBlockPrompt(input('diagram'));
    for (const layout of ['`flow`', '`hierarchy`', '`compare`', '`cycle`']) expect(diagram).toContain(layout);
    expect(generateBlockPrompt(input('table'))).toContain('never fill one from general knowledge');
  });
});


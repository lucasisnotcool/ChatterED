/**
 * **Flashcards, a quiz and an infographic** (2026-10-01; notebooks §5.3, answer E), end to end at
 * the document model: the schema (a block each, children without ids), the drafts → nodes, the
 * validators that gate a model's reply, the batch ops, and the guard over what the learner types
 * inside one. Tables and diagrams, the precedent, are in `ops.test.ts` and `guard.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { docOf, flashcards, infographic, para, quiz, stateOf } from './fixture.test-support.js';
import { learnerConflicts } from './guard.js';
import { applyBatch, draftToNodes, keepEdit, removeEdit } from './ops.js';
import {
  blockAttrs,
  blockPages,
  blockPos,
  blocksForPages,
  docFromJson,
  docOutline,
  eachBlock,
  flashcardsSpec,
  infographicSpec,
  isStructuredBlock,
  learnerSpans,
  notesSchema,
  quizSpec,
} from './schema.js';
import {
  validateFlashcardsDraft,
  validateInfographicDraft,
  validateQuizDraft,
  placeAnswer,
  FLASHCARDS_DRAFT_JSON_SCHEMA,
  INFOGRAPHIC_DRAFT_JSON_SCHEMA,
  QUIZ_DRAFT_JSON_SCHEMA,
} from './validate.js';
import type { AgentDocOpBatch, DocBlockDraft, FlashcardsDraft, InfographicDraft, QuizDraft } from './types.js';

const PROV = { pages: [4], reason: null };

const CARDS: FlashcardsDraft = {
  kind: 'flashcards',
  title: 'Search terms',
  cards: [
    { front: 'Admissible', back: 'Never **overestimates** the cost to the goal.', pages: [4] },
    { front: 'Consistent', back: 'h(n) <= c(n, n2) + h(n2)' },
    { front: 'f(n)', back: 'g(n) + h(n)' },
  ],
  prov: PROV,
};

const QUIZ: QuizDraft = {
  kind: 'quiz',
  title: null,
  questions: [
    {
      type: 'mc',
      prompt: 'Which heuristic is admissible?',
      options: [
        { text: 'Manhattan distance', correct: true },
        { text: 'Twice the true cost', correct: false },
        { text: 'A random number', correct: false },
      ],
      explain: 'Manhattan never overestimates on the 8-puzzle.',
      pages: [4],
    },
    { type: 'short', prompt: 'Why does A* need admissibility?', explain: 'So the first goal it pops is optimal.' },
    { type: 'short', prompt: 'What is f?', explain: 'g plus h.' },
  ],
  prov: PROV,
};

const INFO: InfographicDraft = {
  kind: 'infographic',
  layout: 'timeline',
  title: 'A short history',
  panels: [
    { value: '1968', heading: 'A* published', body: 'Hart, Nilsson and Raphael.', pages: [4] },
    { value: '1985', heading: 'IDA*', body: 'Iterative deepening, linear space.' },
    { value: '1990', heading: 'Pattern databases', body: 'Better heuristics.' },
  ],
  prov: PROV,
};

function build(draft: DocBlockDraft, blockId = 'b_new') {
  const node = draftToNodes(notesSchema, [draft], 'ellie', 'e_1', 1_758_000_000_000)[0]!;
  return notesSchema.nodes[node.type.name]!.create({ ...node.attrs, blockId }, node.content);
}

describe('the three schemas', () => {
  it('build valid nodes from their drafts, every word in the author mark', () => {
    for (const draft of [CARDS, QUIZ, INFO]) {
      const node = build(draft);
      node.check();
      expect(isStructuredBlock(node)).toBe(true);
      node.descendants((child) => {
        if (child.isText) expect(child.marks.some((m) => m.type.name === 'author' && m.attrs.by === 'ellie')).toBe(true);
      });
    }
  });

  it('read a deck, a quiz and an infographic back as plain text', () => {
    expect(flashcardsSpec(build(CARDS))).toEqual({
      title: 'Search terms',
      cards: [
        { front: 'Admissible', back: 'Never overestimates the cost to the goal.', pages: [4] },
        { front: 'Consistent', back: 'h(n) <= c(n, n2) + h(n2)', pages: [] },
        { front: 'f(n)', back: 'g(n) + h(n)', pages: [] },
      ],
    });
    const spec = quizSpec(build(QUIZ));
    expect(spec.questions[0]).toMatchObject({ type: 'mc', correct: 0, options: ['Manhattan distance', 'Twice the true cost', 'A random number'] });
    expect(spec.questions[1]).toMatchObject({ type: 'short', correct: null, options: [], explain: 'So the first goal it pops is optimal.' });
    expect(infographicSpec(build(INFO))).toMatchObject({
      layout: 'timeline',
      panels: [{ value: '1968', heading: 'A* published', body: 'Hart, Nilsson and Raphael.', pages: [4] }, { value: '1985' }, { value: '1990' }],
    });
  });

  it('keep an empty value as a real, empty field', () => {
    const steps: InfographicDraft = { ...INFO, layout: 'steps', panels: INFO.panels.map((p) => ({ ...p, value: null })) };
    const spec = infographicSpec(build(steps));
    expect(spec.panels.map((p) => p.value)).toEqual(['', '', '']);
  });

  it('round-trip through JSON and through the DOM serialiser', () => {
    for (const draft of [CARDS, QUIZ, INFO]) {
      const doc = docOf(para('b_1', 'Before.'), build(draft));
      expect(docFromJson(doc.toJSON()).toJSON()).toEqual(doc.toJSON());
    }
  });

  it('are one block each: children carry no blockId, and their pages count for the block', () => {
    const doc = docOf(flashcards('b_f', [['a', 'b', [7]], ['c', 'd']], { pages: [3] }), quiz('b_q', [{ prompt: 'p', explain: 'e', pages: [9] }]));
    const seen: string[] = [];
    eachBlock(doc, (node) => seen.push(node.type.name));
    expect(seen).toEqual(['flashcards', 'quiz']);
    expect(blockPages(doc.child(0))).toEqual([3, 7]);
    expect(blocksForPages(doc, [9])).toEqual(['b_q']);
    expect(blocksForPages(doc, [7])).toEqual(['b_f']);
  });

  it('show up in the outline as one entry with their text, answers included', () => {
    const doc = docOf(build(QUIZ, 'b_q'), build(CARDS, 'b_c'), build(INFO, 'b_i'));
    const [q, c, i] = docOutline(doc);
    expect(q).toMatchObject({ blockId: 'b_q', kind: 'quiz', learnerText: false });
    expect(q!.text).toContain('Which heuristic is admissible?');
    expect(q!.text).toContain('*Manhattan distance');
    expect(c!.text).toContain('Admissible = Never overestimates');
    expect(i!.text).toContain('1968 A* published');
  });
});

describe('validateFlashcardsDraft', () => {
  const good = { title: 't', cards: [1, 2, 3].map((n) => ({ front: `f${String(n)}`, back: `b${String(n)}`, pages: [4, 99] })) };

  it('accepts a deck, dropping a page outside the deck', () => {
    const { draft, problems } = validateFlashcardsDraft(good, 10, PROV);
    expect(draft?.cards).toHaveLength(3);
    expect(draft?.cards[0]!.pages).toEqual([4]);
    expect(problems.join()).toContain('outside the deck');
  });

  it('accepts the wrapped form a model adds', () => {
    expect(validateFlashcardsDraft({ flashcards: good }, 10, PROV).draft).not.toBeNull();
  });

  it('drops a card with an empty side, and refuses a deck left with fewer than three', () => {
    const cards = [...good.cards, { front: 'x', back: '' }];
    expect(validateFlashcardsDraft({ cards }, 10, PROV).draft?.cards).toHaveLength(3);
    const thin = validateFlashcardsDraft({ cards: [...good.cards.slice(0, 2), { front: 'x', back: '' }] }, 10, PROV);
    expect(thin.draft).toBeNull();
    expect(thin.problems.join()).toContain('at least 3');
  });

  it('cuts a long deck to twelve rather than refusing it', () => {
    const cards = Array.from({ length: 15 }, (_, n) => ({ front: `f${String(n)}`, back: 'b' }));
    const { draft, problems } = validateFlashcardsDraft({ cards }, 10, PROV);
    expect(draft?.cards).toHaveLength(12);
    expect(problems.join()).toContain('first 12 kept');
  });

  it('refuses a reply with no provenance, and one that is not an object', () => {
    expect(validateFlashcardsDraft(good, 10, { pages: [], reason: null }).draft).toBeNull();
    expect(validateFlashcardsDraft('nope', 10, PROV).draft).toBeNull();
  });
});

describe('validateQuizDraft', () => {
  const mc = (answer: unknown, options: unknown = ['a', 'b', 'c']) => ({ type: 'mc', prompt: 'P?', options, answer, explanation: 'Because.' });
  const short = { type: 'short', prompt: 'Why?', explanation: 'Because.' };

  it('turns `answer` into the one correct option', () => {
    const { draft } = validateQuizDraft({ questions: [mc(2), short, short] }, 10, PROV);
    const options = draft?.questions[0]!.options ?? [];
    expect(options.filter((o) => o.correct).map((o) => o.text)).toEqual(['b']);
    expect(options.map((o) => o.text).sort()).toEqual(['a', 'b', 'c']);
    expect(draft?.questions[1]).toMatchObject({ type: 'short', explain: 'Because.' });
    expect(draft?.questions[1]!.options).toBeUndefined();
  });

  it('drops a multiple-choice question with no one right option or a wrong number of options', () => {
    for (const bad of [mc(0), mc(4), mc(undefined), mc(1, ['a', 'b']), mc(1, ['a', 'b', 'c', 'd', 'e']), mc(1, ['a', 'a', 'c'])]) {
      const out = validateQuizDraft({ questions: [bad, mc(1), short, short] }, 10, PROV);
      expect(out.draft?.questions).toHaveLength(3);
      expect(out.problems.length).toBeGreaterThan(0);
    }
  });

  /** Live run, 1 Oct 2026: every question Sonnet wrote had its right answer first. */
  it('decides where the right option sits, so it is not always first, and keeps it there', () => {
    const prompts = Array.from({ length: 12 }, (_, n) => `Question number ${String(n)}?`);
    const positions = prompts.map((prompt) => placeAnswer(['right', 'w1', 'w2', 'w3'], 0, prompt).findIndex((o) => o.correct));
    expect(new Set(positions).size).toBeGreaterThan(2);
    expect(placeAnswer(['right', 'w1', 'w2'], 0, 'Same?')).toEqual(placeAnswer(['right', 'w1', 'w2'], 0, 'Same?'));
    // The wrong options keep their order around it.
    expect(placeAnswer(['w1', 'right', 'w2', 'w3'], 1, 'Q').filter((o) => !o.correct).map((o) => o.text)).toEqual(['w1', 'w2', 'w3']);
  });

  it('refuses a quiz left with fewer than three questions, and cuts one to five', () => {
    expect(validateQuizDraft({ questions: [mc(1), short] }, 10, PROV).draft).toBeNull();
    expect(validateQuizDraft({ questions: Array.from({ length: 7 }, () => short) }, 10, PROV).draft?.questions).toHaveLength(5);
  });

  it('never invents the answer: a question with no explanation is dropped', () => {
    const out = validateQuizDraft({ questions: [{ ...short, explanation: '' }, short, short] }, 10, PROV);
    expect(out.draft).toBeNull();
  });
});

describe('validateInfographicDraft', () => {
  const panel = (value: unknown) => ({ value, heading: 'H', body: 'B' });

  it('accepts a timeline whose panels all have a value, and turns a bare number into text', () => {
    const { draft } = validateInfographicDraft({ layout: 'timeline', panels: [panel(1968), panel('1985'), panel('1990')] }, 10, PROV);
    expect(draft?.panels.map((p) => p.value)).toEqual(['1968', '1985', '1990']);
  });

  it('drops a stat or a stop with no value, and never pads one in', () => {
    const out = validateInfographicDraft({ layout: 'stats', panels: [panel(''), panel('1'), panel('2'), panel('3')] }, 10, PROV);
    expect(out.draft?.panels).toHaveLength(3);
    expect(validateInfographicDraft({ layout: 'stats', panels: [panel(''), panel('1'), panel('2')] }, 10, PROV).draft).toBeNull();
  });

  it('does not need a value for steps or compare', () => {
    expect(validateInfographicDraft({ layout: 'steps', panels: [panel(null), panel(null), panel(null)] }, 10, PROV).draft?.panels[0]!.value).toBeNull();
  });

  it('refuses an unknown layout (there is no mind map) and a missing heading', () => {
    expect(validateInfographicDraft({ layout: 'mindmap', panels: [panel('1'), panel('2'), panel('3')] }, 10, PROV).draft).toBeNull();
    const out = validateInfographicDraft({ layout: 'steps', panels: [{ heading: '', body: 'x' }, panel(null), panel(null), panel(null)] }, 10, PROV);
    expect(out.draft?.panels).toHaveLength(3);
  });

  it('cuts to eight panels', () => {
    const panels = Array.from({ length: 10 }, () => panel(null));
    expect(validateInfographicDraft({ layout: 'steps', panels }, 10, PROV).draft?.panels).toHaveLength(8);
  });
});

describe('the reply JSON schemas', () => {
  it('are flat objects with the caps in their descriptions', () => {
    for (const schema of [FLASHCARDS_DRAFT_JSON_SCHEMA, QUIZ_DRAFT_JSON_SCHEMA, INFOGRAPHIC_DRAFT_JSON_SCHEMA]) {
      expect(schema.type).toBe('object');
      expect(schema.additionalProperties).toBe(false);
      expect(JSON.stringify(schema)).not.toContain('"$ref"');
    }
    expect((INFOGRAPHIC_DRAFT_JSON_SCHEMA.properties as Record<string, { enum?: string[] }>).layout!.enum).toEqual(['timeline', 'steps', 'stats', 'compare']);
  });
});

// ── batches and the guard ───────────────────────────────────────────────────────────────────

const OPTS = { frozen: false, docId: 'doc_1', now: '2026-10-01T10:00:00.000Z' };
const batchOf = (ops: AgentDocOpBatch['ops']): AgentDocOpBatch => ({
  editId: 'e_new',
  author: 'ellie',
  cause: 'answer_missing',
  ops,
  focusBlockId: null,
  why: 'asked for',
});

describe('inserting one in a batch, and Remove · Keep', () => {
  const base = () => docOf(para('b_1', 'Before.', 'ingest', null, [4]));

  it('inserts each as one block with one id', () => {
    const state = stateOf(base());
    const result = applyBatch(state, batchOf([{ op: 'insert_after', anchorBlockId: 'b_1', blocks: [CARDS, QUIZ, INFO] }]), OPTS);
    expect(result.status).toBe('applied');
    expect(result.blockIds).toHaveLength(3);
    const doc = state.apply(result.tr!).doc;
    expect([1, 2, 3].map((i) => doc.child(i).type.name)).toEqual(['flashcards', 'quiz', 'infographic']);
    doc.check();
  });

  it('Remove takes the whole block back and Keep clears the edit id on every field', () => {
    const state = stateOf(base());
    const before = JSON.stringify(state.doc.toJSON());
    const applied = applyBatch(state, batchOf([{ op: 'insert_after', anchorBlockId: 'b_1', blocks: [CARDS, QUIZ, INFO] }]), OPTS);
    const open = state.apply(applied.tr!);
    const edit = { editId: 'e_new', blockIds: applied.blockIds };

    const back = open.apply(removeEdit(open, edit)!);
    expect(JSON.stringify(back.doc.toJSON())).toBe(before);

    const kept = open.apply(keepEdit(open, edit)!);
    for (const id of applied.blockIds) {
      const node = blockPos(kept.doc, id)!.node;
      node.descendants((child) => {
        if (child.isText) expect(child.marks.find((m) => m.type.name === 'author')!.attrs.editId).toBeNull();
      });
      expect(node.textContent).toBe(blockPos(open.doc, id)!.node.textContent);
    }
  });

  it('holds back a replace_block on one the learner wrote in, whole', () => {
    const doc = docOf(quiz('b_q', [{ prompt: [{ text: 'my own question?', by: 'user' }], explain: 'e' }]));
    const state = stateOf(doc);
    const result = applyBatch(state, batchOf([{ op: 'replace_block', blockId: 'b_q', blocks: [QUIZ] }]), OPTS);
    expect(result.status).toBe('rejected_guard');
    expect(result.tr).toBeNull();
    expect(result.conflicts[0]).toMatchObject({ blockId: 'b_q', text: 'my own question?' });
  });

  it('replaces one only the agents wrote', () => {
    const state = stateOf(docOf(flashcards('b_f', [['a', 'b']])));
    const result = applyBatch(state, batchOf([{ op: 'replace_block', blockId: 'b_f', blocks: [CARDS] }]), OPTS);
    expect(result.status).toBe('applied');
    expect(blockPos(state.apply(result.tr!).doc, 'b_f')).toBeNull();
  });
});

describe('the guard inside the three blocks', () => {
  const doc = () =>
    docOf(
      flashcards('b_f', [['Term', [{ text: 'my own gloss', by: 'user' }]], ['Other', 'agent text']]),
      quiz('b_q', [
        { prompt: 'Which?', options: [{ text: 'a', correct: true }, { text: [{ text: 'my option', by: 'user' }] }, { text: 'c' }], explain: 'Because.' },
      ]),
      infographic('b_i', [{ value: '1', heading: 'H', body: [{ text: 'what I noticed', by: 'user' }] }]),
      flashcards('b_theirs', [['x', 'y']]),
    );

  it('reports learner text inside each, against the block, as the learner’s', () => {
    const spans = learnerSpans(doc());
    expect(spans.map((s) => [s.blockId, s.text])).toEqual([
      ['b_f', 'my own gloss'],
      ['b_q', 'my option'],
      ['b_i', 'what I noticed'],
    ]);
    expect(docOutline(doc()).map((e) => e.learnerText)).toEqual([true, true, true, false]);
  });

  it('refuses to let a transaction delete a block holding it, and names the words', () => {
    const state = stateOf(doc());
    for (const [id, text] of [['b_f', 'my own gloss'], ['b_q', 'my option'], ['b_i', 'what I noticed']] as const) {
      const target = blockPos(state.doc, id)!;
      const conflicts = learnerConflicts(state, state.tr.delete(target.pos, target.pos + target.node.nodeSize));
      expect(conflicts).toEqual([expect.objectContaining({ blockId: id, text })]);
    }
  });

  it('lets an agent remove one it alone wrote', () => {
    const state = stateOf(doc());
    const target = blockPos(state.doc, 'b_theirs')!;
    expect(learnerConflicts(state, state.tr.delete(target.pos, target.pos + target.node.nodeSize))).toEqual([]);
  });

  it('blockAttrs reads the block’s own provenance, not a child’s', () => {
    expect(blockAttrs(doc().child(0)).blockId).toBe('b_f');
  });
});

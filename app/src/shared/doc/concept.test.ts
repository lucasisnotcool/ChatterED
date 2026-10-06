/**
 * **Concept cards** (2026-10-06, `notebooks.md` §11.2 (amended 2026-10-06), decision D1): the schema, the read
 * side (`cardOf`, the outline), the ops that keep a card a card, and the structural gate.
 *
 * The fixture, in every test below:
 *
 * ```
 * # Planning                                           (b_title)
 * ## Policy iteration                                  (b_h2, p. 39)
 * [card b_card "Policy iteration"]
 *   **Policy iteration**: evaluate, improve, repeat.   (b_core, ingest)
 *   [intuition b_int]  Each round spreads value…       (b_int_p, ingest)
 *   [equation b_eq]    $$U = …$$ + where list          (b_eq_m, b_eq_l)
 *   [pitfall b_pit]    Evaluation does not average…    (b_pit_p, ingest)
 * After the card.                                      (b_after)
 * ```
 */
import { describe, expect, it } from 'vitest';
import { card, cardItem, docOf, heading, mixed, para, stateOf } from './fixture.test-support.js';
import { applyBatch, draftToNodes, removeEdit } from './ops.js';
import {
  blockPos,
  cardIdOf,
  cardOf,
  conceptCards,
  conceptItems,
  conceptText,
  docFromJson,
  docOutline,
  docOutlineNear,
  eachBlock,
  learnerSpans,
  notesSchema,
  questionCardId,
} from './schema.js';
import type { AgentDocOp, AgentDocOpBatch, ConceptDraft, DocBlockDraft } from './types.js';
import { conceptWords, validateConceptDraft } from './validate.js';

const OPTS = { frozen: false, docId: 'doc_1', now: '2026-10-06T10:00:00.000Z' };

function math(blockId: string, tex: string): ReturnType<typeof para> {
  return notesSchema.nodes.math_block!.create({ blockId, tex, pages: [39], reason: null, objectiveIds: [] });
}

function bullets(blockId: string, items: string[]): ReturnType<typeof para> {
  const p = (text: string, i: number) => para(`${blockId}_${String(i)}`, text, 'ingest', null, [39]);
  return notesSchema.nodes.bullet_list!.create(
    { blockId, pages: [39], reason: null, objectiveIds: [] },
    items.map((text, i) => notesSchema.nodes.list_item!.create({ blockId: `${blockId}_li${String(i)}` }, p(text, i))),
  );
}

function fixture(core = para('b_core', '**Policy iteration**: evaluate, improve, repeat.', 'ingest', null, [39])) {
  return docOf(
    heading('b_title', 1, 'Planning'),
    heading('b_h2', 2, 'Policy iteration', [39]),
    card('b_card', 'Policy iteration', core, [
      cardItem('b_int', 'intuition', [para('b_int_p', 'Each round spreads value to every state at once.')]),
      cardItem('b_eq', 'equation', [math('b_eq_m', 'U^{\\pi}(s) = \\sum_{s\'} P(s\'|s,\\pi(s))[R + \\gamma U^{\\pi}(s\')]'), bullets('b_eq_l', ['$P$: chance of landing in s′'])], [39]),
      cardItem('b_pit', 'pitfall', [para('b_pit_p', 'Evaluation does not average over actions.')]),
    ], [39]),
    para('b_after', 'After the card.', 'ingest', null, [40]),
  );
}

function batchOf(ops: AgentDocOp[]): AgentDocOpBatch {
  return { editId: 'e_card', author: 'ellie', cause: 'block_action', ops, focusBlockId: null, why: 'test' };
}

const P = (text: string): DocBlockDraft => ({ kind: 'paragraph', text, prov: { pages: [39], reason: null } });

describe('the schema', () => {
  it('holds a card at the top level, round-trips through JSON, and walks into it', () => {
    const doc = fixture();
    expect(() => doc.check()).not.toThrow();
    const back = docFromJson(doc.toJSON());
    expect(back.eq(doc)).toBe(true);
    const visited: string[] = [];
    eachBlock(doc, (node) => visited.push(node.type.name === 'concept' ? 'card' : (node.attrs.blockId as string)));
    expect(visited).toEqual(['b_title', 'b_h2', 'card', 'b_core', 'b_int', 'b_int_p', 'b_eq', 'b_eq_m', 'b_eq_l', 'b_pit', 'b_pit_p', 'b_after']);
  });

  it('refuses a card inside a card, a list or a Q block', () => {
    const inner = card('b_x', 'X', para('b_xc', 'X is x.'));
    expect(() => notesSchema.nodes.concept_item!.create({ role: 'note' }, [inner]).check()).toThrow();
    expect(() => notesSchema.nodes.q_block!.create({}, [inner]).check()).toThrow();
  });

  it('a card needs its core paragraph first', () => {
    expect(() => notesSchema.nodes.concept!.create({}, [cardItem('i', 'note', [para('p', 'x')])]).check()).toThrow();
  });
});

describe('cardOf: which card a block belongs to', () => {
  const doc = fixture();
  it('finds the card from the card, the core line, an item and a block inside an item', () => {
    expect(cardOf(doc, 'b_card')).toMatchObject({ cardId: 'b_card', term: 'Policy iteration', item: null, isCore: false });
    expect(cardOf(doc, 'b_core')).toMatchObject({ cardId: 'b_card', isCore: true, item: null });
    expect(cardOf(doc, 'b_eq')?.item?.role).toBe('equation');
    expect(cardOf(doc, 'b_eq_m')).toMatchObject({ cardId: 'b_card', isCore: false });
    expect(cardOf(doc, 'b_eq_m')?.item?.role).toBe('equation');
    expect(cardOf(doc, 'b_eq_l_0')?.item?.role).toBe('equation');
  });
  it('is null outside a card and for an unknown id', () => {
    expect(cardOf(doc, 'b_after')).toBeNull();
    expect(cardOf(doc, 'b_h2')).toBeNull();
    expect(cardIdOf(doc, 'nope')).toBeNull();
  });
  it('lists the cards and their items', () => {
    expect(conceptCards(doc).map((c) => c.cardId)).toEqual(['b_card']);
    expect(conceptItems(blockPos(doc, 'b_card')!.node).map((i) => i.role)).toEqual(['intuition', 'equation', 'pitfall']);
    expect(conceptText(blockPos(doc, 'b_card')!.node)).toContain('equation: $$U^{\\pi}(s)');
  });
});

describe('the outline of a card', () => {
  it('names the card on every line inside it, the role on every line of an item, and nothing outside', () => {
    const outline = docOutline(fixture());
    const byId = new Map(outline.map((e) => [e.blockId, e]));
    expect(byId.get('b_card')).toMatchObject({ kind: 'concept', cardId: 'b_card', text: 'Policy iteration: evaluate, improve, repeat.' });
    expect(byId.get('b_core')).toMatchObject({ cardId: 'b_card' });
    expect(byId.get('b_core')!.role).toBeUndefined();
    expect(byId.get('b_eq')).toMatchObject({ kind: 'concept_item', role: 'equation' });
    expect(byId.get('b_eq')!.text.startsWith('[equation] $$U^{\\pi}(s)')).toBe(true);
    expect(byId.get('b_eq_m')).toMatchObject({ cardId: 'b_card', role: 'equation' });
    expect(byId.get('b_after')).not.toHaveProperty('cardId');
    expect(byId.get('b_after')).not.toHaveProperty('role');
  });

  it('near a block in a card, carries the whole card even past the radius', () => {
    const near = docOutlineNear(fixture(), 'b_core', 0).map((e) => e.blockId);
    expect(near).toEqual(expect.arrayContaining(['b_card', 'b_core', 'b_int', 'b_eq', 'b_eq_m', 'b_pit', 'b_pit_p']));
    expect(near).not.toContain('b_after');
  });

  it('reports learner text inside a card against the block it is in', () => {
    const doc = fixture(mixed('b_core', [{ text: 'Policy iteration: ', by: 'ingest' }, { text: 'my own words.', by: 'user' }], [39]));
    expect(learnerSpans(doc).map((s) => s.blockId)).toEqual(['b_core']);
  });
});

describe('draftToNodes: a card from a draft', () => {
  const draft: ConceptDraft = {
    kind: 'concept',
    term: 'Markov property',
    core: 'the next state depends only on the current state and action.',
    prov: { pages: [10, 14], reason: null },
    depth: [
      { role: 'equation', prov: { pages: [14], reason: null }, blocks: [{ kind: 'math', tex: 'P(s_{t+1}|s_t,a_t)', prov: { pages: [14], reason: null } }] },
      { role: 'pitfall', prov: { pages: [], reason: 'added: a common misreading' }, blocks: [P('It does not say outcomes are independent.')] },
      { role: 'note', prov: { pages: [14], reason: null }, blocks: [] },
    ],
  };
  it('puts the term in bold in front of the core line, and drops an empty item', () => {
    const [node] = draftToNodes(notesSchema, [draft], 'ingest', null);
    expect(node!.type.name).toBe('concept');
    expect(node!.attrs.term).toBe('Markov property');
    expect(node!.firstChild!.textContent).toBe('Markov property: the next state depends only on the current state and action.');
    expect(node!.firstChild!.firstChild!.marks.some((m) => m.type.name === 'strong')).toBe(true);
    expect(conceptItems(node!).map((i) => i.role)).toEqual(['equation', 'pitfall']);
    expect(conceptItems(node!)[1]!.node.attrs.reason).toBe('added: a common misreading');
    expect(() => node!.check()).not.toThrow();
  });
  it('does not repeat a term the core line already opens with', () => {
    const [node] = draftToNodes(notesSchema, [{ ...draft, core: '**Markov property** — memoryless transitions.' }], 'ingest', null);
    expect(node!.firstChild!.textContent).toBe('Markov property — memoryless transitions.');
  });
});

describe('card_attach: Ellie writes into the card', () => {
  const attach = (op: Partial<Extract<AgentDocOp, { op: 'card_attach' }>>, doc = fixture()) =>
    applyBatch(stateOf(doc), batchOf([{ op: 'card_attach', cardBlockId: 'b_card', role: 'example', mode: 'extend', blocks: [P('A worked case.')], prov: { pages: [40], reason: null }, ...op }]), OPTS);

  it('makes a new item at its role’s place in the reading order', () => {
    const result = attach({});
    expect(result.status).toBe('applied');
    const doc = result.tr!.doc;
    const cardNode = blockPos(doc, 'b_card')!.node;
    expect(conceptItems(cardNode).map((i) => i.role)).toEqual(['intuition', 'equation', 'example', 'pitfall']);
    expect(result.blockIds).toHaveLength(1);
    expect(cardOf(doc, result.blockIds[0]!)?.item?.role).toBe('example');
  });

  it('extends an item that is there: the blocks go at its end', () => {
    const result = attach({ role: 'intuition', mode: 'extend', blocks: [P('A second way to see it.')] });
    const item = blockPos(result.tr!.doc, 'b_int')!.node;
    expect(item.childCount).toBe(2);
    expect(item.lastChild!.textContent).toBe('A second way to see it.');
  });

  it('replaces an item nobody wrote in, keeping its role and place', () => {
    const result = attach({ role: 'intuition', mode: 'replace', blocks: [P('A better picture.')] });
    const items = conceptItems(blockPos(result.tr!.doc, 'b_card')!.node);
    expect(items.map((i) => i.role)).toEqual(['intuition', 'equation', 'pitfall']);
    expect(items[0]!.node.textContent).toBe('A better picture.');
    expect(blockPos(result.tr!.doc, 'b_int')).toBeNull();
  });

  it('holds a replace of an item the learner wrote in to an extend, and reports the conflict', () => {
    const doc = docOf(
      heading('b_title', 1, 'Planning'),
      card('b_card', 'Policy iteration', para('b_core', 'Policy iteration: x.', 'ingest', null, [39]), [
        cardItem('b_int', 'intuition', [mixed('b_mine', [{ text: 'My picture of it.', by: 'user' }])]),
      ]),
    );
    const result = attach({ role: 'intuition', mode: 'replace', blocks: [P('Ellie’s picture.')] }, doc);
    expect(result.status).toBe('applied');
    expect(result.conflicts.map((c) => c.text)).toEqual(['My picture of it.']);
    const item = blockPos(result.tr!.doc, 'b_int')!.node;
    expect(item.firstChild!.textContent).toBe('My picture of it.');
    expect(item.lastChild!.textContent).toBe('Ellie’s picture.');
  });

  it('allows a formula, a list and a table as the addition', () => {
    const blocks: DocBlockDraft[] = [
      { kind: 'math', tex: 'x^2', prov: { pages: [39], reason: null } },
      { kind: 'bullets', items: ['$x$: a thing'], prov: { pages: [39], reason: null } },
      { kind: 'table', columns: ['A', 'B'], rows: [{ cells: ['1', '2'] }], prov: { pages: [39], reason: null } },
    ];
    const result = attach({ role: 'equation', blocks });
    const item = blockPos(result.tr!.doc, 'b_eq')!.node;
    expect([...Array(item.childCount).keys()].map((i) => item.child(i).type.name)).toEqual(['math_block', 'bullet_list', 'math_block', 'bullet_list', 'table']);
  });

  it('is removed in one click, the card as it was', () => {
    const doc = fixture();
    const result = attach({}, doc);
    const after = stateOf(result.tr!.doc);
    const undo = removeEdit(after, { editId: 'e_card', blockIds: result.blockIds });
    expect(undo!.doc.eq(doc)).toBe(true);
  });

  it('skips an id that is not a card', () => {
    expect(attach({ cardBlockId: 'b_after' }).status).toBe('no_change');
  });
});

describe('the other ops keep a card a card', () => {
  const run = (op: AgentDocOp, doc = fixture()) => applyBatch(stateOf(doc), batchOf([op]), OPTS);

  it('insert_after the core line or an item lands after the card', () => {
    for (const anchor of ['b_core', 'b_eq']) {
      const result = run({ op: 'insert_after', anchorBlockId: anchor, blocks: [P('Beside it.')] });
      expect(result.status).toBe('applied');
      const doc = result.tr!.doc;
      expect(() => doc.check()).not.toThrow();
      const index = doc.resolve(blockPos(doc, result.blockIds[0]!)!.pos).index(0);
      expect(doc.child(index - 1).attrs.blockId).toBe('b_card');
    }
  });

  it('insert_before the core line lands before the card; inside an item the anchor stands', () => {
    const before = run({ op: 'insert_before', anchorBlockId: 'b_core', blocks: [P('Above it.')] }).tr!.doc;
    expect(before.child(2).textContent).toBe('Above it.');
    const inside = run({ op: 'insert_after', anchorBlockId: 'b_eq_m', blocks: [P('Under the formula.')] }).tr!.doc;
    expect(blockPos(inside, 'b_eq')!.node.child(1).textContent).toBe('Under the formula.');
  });

  it('a Q block anchored anywhere in a card goes under the card', () => {
    for (const anchor of ['b_core', 'b_eq_m']) {
      const result = run({ op: 'insert_q', anchorBlockId: anchor, questionId: 'q1', objectiveId: null, text: 'Why?', prov: { pages: [39], reason: null } });
      const doc = result.tr!.doc;
      expect(() => doc.check()).not.toThrow();
      expect(doc.child(3).type.name).toBe('q_block');
    }
  });

  // Decision 9 (6 Oct afternoon, #67): a verdict counts toward the card its question is about.
  it('a Q block under a card knows its card, and one outside a card knows none', () => {
    const inCard = run({ op: 'insert_q', anchorBlockId: 'b_eq_m', questionId: 'q1', objectiveId: null, text: 'Why?', prov: { pages: [39], reason: null } });
    expect(inCard.tr!.doc.child(3).attrs.cardId).toBe('b_card');
    expect(questionCardId(inCard.tr!.doc, 'q1')).toBe('b_card');
    const outside = run({ op: 'insert_q', anchorBlockId: 'b_after', questionId: 'q2', objectiveId: null, text: 'Why?', prov: { pages: [40], reason: null } });
    expect(outside.tr!.doc.child(4).attrs.cardId).toBeNull();
    expect(questionCardId(outside.tr!.doc, 'q2')).toBeNull();
    expect(questionCardId(outside.tr!.doc, 'q_missing')).toBeNull();
    // It survives the round trip a saved doc makes.
    expect(docFromJson(inCard.tr!.doc.toJSON()).child(3).attrs.cardId).toBe('b_card');
  });

  // Decision 12 (6 Oct afternoon, #67): Max's sentence for the chip is kept on the Q block, never as text.
  it('resolve_q keeps Max’s chip sentence as an attribute, on you got this only', () => {
    const asked = run({ op: 'insert_q', anchorBlockId: 'b_core', questionId: 'q1', objectiveId: null, text: 'Why?', prov: { pages: [39], reason: null } }).tr!.doc;
    const note = 'Policy iteration stops when the policy no longer changes.';
    const resolve = (resolution: 'you_got_this' | 'revisit' | 'recall') =>
      applyBatch(
        stateOf(asked),
        {
          editId: 'e_r',
          author: 'max',
          cause: 'q_resolved',
          ops: [{ op: 'resolve_q', questionId: 'q1', resolution, blocks: [], learnerAnswer: 'Because it repeats.', maxNote: `  ${note}  ` }],
          focusBlockId: null,
          why: 't',
        },
        OPTS,
      ).tr!.doc;
    const earned = resolve('you_got_this').child(3);
    expect(earned.attrs.maxNote).toBe(note);
    // Not text: the learner's answer is the block's only text after the question.
    expect(earned.childCount).toBe(2);
    expect(earned.textContent).not.toContain('no longer changes');
    expect(resolve('revisit').child(3).attrs.maxNote).toBeNull();
    // A recall keeps the learner's answer and no sentence of Max's (decision 14).
    const recalled = resolve('recall').child(3);
    expect(recalled.attrs).toMatchObject({ resolution: 'recall', maxNote: null });
    expect(recalled.child(1).textContent).toBe('Because it repeats.');
    // It survives the round trip a saved doc makes.
    expect(docFromJson(resolve('you_got_this').toJSON()).child(3).attrs.maxNote).toBe(note);
  });

  it('finds the card of an older Q block, written before it carried one, from where it stands', () => {
    const q = (questionId: string) =>
      notesSchema.nodes.q_block!.create({ blockId: `b_${questionId}`, questionId, status: 'resolved' }, [para(`b_${questionId}_p`, 'Why?')]);
    const doc = docOf(
      heading('b_h2', 2, 'Policy iteration', [39]),
      card('b_card', 'Policy iteration', para('b_core', '**Policy iteration**: repeat.', 'ingest', null, [39])),
      q('q_new'),
      q('q_old'),
      para('b_after', 'After the card.', 'ingest', null, [40]),
      q('q_loose'),
    );
    expect(questionCardId(doc, 'q_new')).toBe('b_card');
    expect(questionCardId(doc, 'q_old')).toBe('b_card');
    expect(questionCardId(doc, 'q_loose')).toBeNull();
  });

  it('replace_block on the core line takes one paragraph, and refuses anything else', () => {
    const ok = run({ op: 'replace_block', blockId: 'b_core', blocks: [P('**Policy iteration**: better.')] });
    expect(ok.status).toBe('applied');
    expect(blockPos(ok.tr!.doc, 'b_card')!.node.firstChild!.textContent).toBe('Policy iteration: better.');
    const no = run({ op: 'replace_block', blockId: 'b_core', blocks: [P('One.'), P('Two.')] });
    expect(no.status).toBe('no_change');
  });

  it('replace_block on an item keeps the item’s role', () => {
    const result = run({ op: 'replace_block', blockId: 'b_pit', blocks: [P('A sharper pitfall.')] });
    const items = conceptItems(blockPos(result.tr!.doc, 'b_card')!.node);
    expect(items.at(-1)).toMatchObject({ role: 'pitfall' });
    expect(items.at(-1)!.node.textContent).toBe('A sharper pitfall.');
  });

  it('remove_block on the core line removes the card, unless the learner wrote in it', () => {
    const gone = run({ op: 'remove_block', blockId: 'b_core' }).tr!.doc;
    expect(blockPos(gone, 'b_card')).toBeNull();
    const mine = fixture(mixed('b_core', [{ text: 'Mine.', by: 'user' }], [39]));
    expect(run({ op: 'remove_block', blockId: 'b_core' }, mine).status).toBe('rejected_guard');
  });

  it('append_to_block on an item adds a paragraph at its end', () => {
    const result = run({ op: 'append_to_block', blockId: 'b_int', text: 'One more thing.' });
    expect(blockPos(result.tr!.doc, 'b_int')!.node.lastChild!.textContent).toBe('One more thing.');
  });
});

describe('validateConceptDraft: the structural gate', () => {
  it('repairs before it rejects: unknown roles become notes, bad pages go, an item takes the card’s provenance', () => {
    const { draft, problems } = validateConceptDraft(
      {
        term: 'TD learning',
        core: 'updates toward the next state’s estimate after every step.',
        prov: { pages: [36, 999], reason: null },
        depth: [
          { role: 'formula', blocks: [{ kind: 'math', tex: 'U(s) \\leftarrow U(s) + \\alpha[\\ldots]' }] },
          { role: 'example', prov: { pages: [37] }, blocks: [{ kind: 'paragraph', text: '0.84 → 0.86 with α = 0.5.' }] },
          { role: 'table', blocks: [{ kind: 'table', columns: ['A', 'B'], rows: [['1', '2']] }] },
          { role: 'pitfall', blocks: [] },
          { role: 'note', blocks: [{ kind: 'concept', term: 'x', core: 'y' }] },
        ],
      },
      60,
    );
    expect(draft).not.toBeNull();
    expect(draft!.prov.pages).toEqual([36]);
    expect(draft!.depth.map((i) => i.role)).toEqual(['note', 'example', 'table']);
    expect(draft!.depth[0]!.blocks[0]!.prov.pages).toEqual([36]);
    expect(problems.some((p) => p.includes('card inside a card'))).toBe(true);
    expect(problems.some((p) => p.includes('no usable block'))).toBe(true);
  });

  it('refuses a card with no core line, or no provenance', () => {
    expect(validateConceptDraft({ term: 'X', core: '', prov: { pages: [1] }, depth: [] }, 10).draft).toBeNull();
    expect(validateConceptDraft({ term: 'X', core: 'x.', prov: { pages: [] }, depth: [] }, 10).draft).toBeNull();
  });

  it('counts words without maths or figures, core and depth apart', () => {
    const words = conceptWords({
      kind: 'concept',
      term: 'Q',
      core: 'the value of $a$ in $s$ then acting well.',
      prov: { pages: [1], reason: null },
      depth: [
        {
          role: 'equation',
          prov: { pages: [1], reason: null },
          blocks: [
            { kind: 'math', tex: 'Q(s,a) = \\sum P [R + \\gamma \\max Q]', prov: { pages: [1], reason: null } },
            { kind: 'bullets', items: ['$\\gamma$: the discount', '$R$: the reward'], prov: { pages: [1], reason: null } },
          ],
        },
        { role: 'figure', prov: { pages: [1], reason: null }, blocks: [{ kind: 'figure', page: 1, rect: null, caption: '', prov: { pages: [1], reason: null } }] },
      ],
    });
    expect(words).toEqual({ core: 7, depth: 4 });
  });
});

/**
 * Notes as concept cards (`notebooks.md` §11.2, amended 2026-10-06): the budget arithmetic, the
 * gate's repairs and the fit, all pure, against hand-written model answers. No model call.
 */
import { describe, expect, it } from 'vitest';
import type { ConceptDraft, ConceptItemDraft } from '../../shared/doc/types.js';
import {
  ADDED_REASONS,
  CARD_CUT_ORDER,
  CARD_WORDS,
  CARDS_JSON_SCHEMA,
  cardBudget,
  cardCondenseWords,
  cardsMessage,
  cardWords,
  cutWords,
  figureRect,
  fitCards,
  hasCards,
  proseWords,
  validateCards,
} from './cards.js';
import type { ValidOverview } from './overview.js';

const CTX = { pageCount: 60, pageExists: (p: number) => p !== 30, fallbackTitle: 'MDP' };

function frame(sections: unknown[]): Record<string, unknown> {
  return {
    title: 'Markov decision processes',
    lede: { text: 'Sequential decisions under uncertainty.', pages: [4] },
    objectives: [{ title: 'Explain policy iteration', statement: 's', criteria: ['a'], quizSeeds: [], pages: [39] }],
    sections,
    next: { heading: 'Homework', pages: [60], takeaway: '', ideas: [{ text: 'Read RN 17.1–17.3.', pages: [60] }] },
    greeting: 'I read these too.',
    starterQuestions: ['What is an MDP?', 'Why discount?', 'What is a policy?'],
  };
}

describe('cardBudget: 30–40% of the slide words, 8–10% visible', () => {
  it('sizes the MDP deck as the evidence does', () => {
    const b = cardBudget(5112);
    expect(b.notes).toEqual({ min: 1530, max: 2040 });
    expect(b.core).toEqual({ min: 410, max: 510 });
    expect(b.cards.target).toBe(14);
    expect(b.cards.min).toBeLessThan(b.cards.target);
    expect(b.cards.max).toBeGreaterThan(b.cards.target);
  });
  it('keeps a floor for a two-page handout, and scales linearly above it', () => {
    expect(cardBudget(200).notes.max).toBe(300);
    expect(cardBudget(200).cards.target).toBe(3);
    expect(cardBudget(10_000).notes.max).toBe(2 * cardBudget(5_000).notes.max);
  });
  it('condenses a source to about half its words when the notes are cards', () => {
    expect(cardCondenseWords(5000)).toBe(2500);
    expect(cardCondenseWords(100)).toBe(300);
    expect(cardCondenseWords(100_000)).toBe(6000);
  });
});

describe('the prompt and its schema', () => {
  it('states the budget as numbers and names the figure pages', () => {
    const message = cardsMessage({
      notebookName: 'MDP',
      sourceNames: ['Lecture-mdp.pdf'],
      deckText: '[p. 1]\nHello',
      condensed: false,
      budget: cardBudget(5112),
      imagePages: [],
      figurePages: [{ page: 9, area: 0.62 }, { page: 12, area: 0.05 }],
    });
    expect(message).toContain('The whole notes are 1530 to 2040 words');
    expect(message).toContain('is 410 to 510');
    expect(message).toContain('p. 9 (62% of the slide)');
    expect(message).not.toContain('p. 12 (');
  });
  it('asks for cards in each section, and never recommends a table', () => {
    const sections = (CARDS_JSON_SCHEMA.properties as Record<string, { items: { required: string[]; properties: Record<string, { properties?: Record<string, { enum?: string[] }> }> } }>).sections!;
    expect(sections.items.required).toContain('cards');
    expect(sections.items.properties.recommendation!.properties!.kind!.enum).not.toContain('table');
    expect(hasCards(frame([{ heading: 'h', pages: [1], takeaway: 't', cards: [] }]))).toBe(true);
    expect(hasCards(frame([{ heading: 'h', pages: [1], takeaway: 't', ideas: [] }]))).toBe(false);
  });
});

describe('validateCards: the gate', () => {
  const section = {
    heading: 'Policy iteration',
    pages: [39],
    takeaway: 'Evaluate, improve, repeat.',
    cards: [
      {
        term: 'Policy iteration',
        core: 'start from any policy and alternate evaluation and improvement until it stops changing.',
        pages: [39, 999],
        depth: [
          { role: 'pitfall', text: 'Evaluation does not average over actions.', pages: [40], added: false },
          { role: 'steps', steps: ['Initialise $\\pi_0$.', 'Evaluate.', 'Improve.'], text: 'Terminates: finitely many policies.', pages: [39], added: false },
          { role: 'mystery', text: 'Filed as a note.', pages: [41], added: false },
          { role: 'figure', page: 30, pages: [30], added: false },
          { role: 'table', columns: ['Only one'], rows: [['x']], text: 'A bad table.', pages: [44], added: false },
          { role: 'example', text: 'A made-up case.', pages: [], added: false },
        ],
      },
      { term: 'Orphan', core: 'cites nothing at all.', pages: [], depth: [{ role: 'intuition', text: 'x', pages: [], added: true }] },
      { term: 'Empty', core: '', pages: [39], depth: [] },
    ],
  };

  it('repairs before it rejects, and says what is added', () => {
    const { overview, repairs } = validateCards(frame([section]), { ...CTX, figureRect: () => ({ x0: 0, y0: 0, x1: 1, y1: 0.5 }) });
    expect(overview).not.toBeNull();
    const cards = overview!.sections[0]!.cards!;
    expect(cards.map((c) => c.term)).toEqual(['Policy iteration']);
    const card = cards[0]!;
    expect(card.prov.pages).toEqual([39, 41, 44]);
    // Reading order; the unknown role is a note; the figure on a page in a gap is gone.
    expect(card.depth.map((d) => d.role)).toEqual(['steps', 'example', 'table', 'pitfall', 'note']);
    // The pitfall is added whatever the model said; an item citing no page is added.
    expect(card.depth.find((d) => d.role === 'pitfall')!.prov.reason).toBe(ADDED_REASONS.pitfall);
    expect(card.depth.find((d) => d.role === 'example')!.prov.reason).toBe(ADDED_REASONS.example);
    expect(card.depth.find((d) => d.role === 'steps')!.prov.reason).toBeNull();
    // Steps first, then the prose about them.
    expect(card.depth[0]!.blocks.map((b) => b.kind)).toEqual(['numbers', 'paragraph']);
    // A table that does not pass the table gate keeps its words as prose.
    expect(card.depth.find((d) => d.role === 'table')!.blocks[0]!.kind).toBe('paragraph');
    expect(repairs.cardsDropped).toBe(2);
    expect(repairs.figuresDropped).toBe(1);
    expect(repairs.tablesDropped).toBe(1);
    expect(repairs.itemsAddedForced).toBe(1);
    expect(repairs.pagesDropped).toBeGreaterThan(0);
    // The section's pages take its cards'; `next` stays a map section.
    expect(overview!.sections[0]!.pages).toEqual([39, 41, 44]);
    expect(overview!.sections.at(-1)!.next).toBe(true);
    expect(overview!.sections.at(-1)!.ideas).toHaveLength(1);
  });

  it('crops a figure as code says, and an equation is a formula and its where-list', () => {
    const { overview } = validateCards(
      frame([
        {
          heading: 'Grid world',
          pages: [9],
          takeaway: 't',
          cards: [
            {
              term: 'Bellman equation',
              core: 'utility is reward plus discounted expected utility.',
              pages: [25],
              depth: [
                { role: 'equation', tex: '$$U(s) = R(s) + \\gamma \\sum_{s\'} P(s\'|s,a) U(s\')$$', where: ['$\\gamma$: the discount'], pages: [25], added: false },
                { role: 'figure', page: 9, text: 'The 4×3 grid.', pages: [9], added: false },
              ],
            },
          ],
        },
      ]),
      { ...CTX, figureRect: (page) => (page === 9 ? { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 } : null) },
    );
    const [eq, fig] = overview!.sections[0]!.cards![0]!.depth;
    expect(eq!.blocks.map((b) => b.kind)).toEqual(['math', 'bullets']);
    expect((eq!.blocks[0] as { tex: string }).tex.startsWith('U(s)')).toBe(true);
    expect(fig!.blocks[0]).toMatchObject({ kind: 'figure', page: 9, rect: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }, caption: 'The 4×3 grid.' });
    expect(fig!.prov).toEqual({ pages: [9], reason: null });
  });

  it('cuts a core line past 40 words at a clause', () => {
    const long = `${'word '.repeat(30)}and then, ${'more '.repeat(20)}end.`;
    const { overview, repairs } = validateCards(frame([{ heading: 'h', pages: [5], takeaway: 't', cards: [{ term: 'T', core: long, pages: [5], depth: [] }] }]), CTX);
    expect(proseWords(overview!.sections[0]!.cards![0]!.core)).toBeLessThanOrEqual(40);
    expect(repairs.coresCut).toBe(1);
  });
});

// ── the fit ──────────────────────────────────────────────────────────────────────────────────

const para = (words: number, role: ConceptItemDraft['role']): ConceptItemDraft => ({
  role,
  prov: { pages: [1], reason: null },
  blocks: [{ kind: 'paragraph', text: 'w '.repeat(words).trim(), prov: { pages: [1], reason: null } }],
});

function cardOf(term: string, coreWords: number, items: ConceptItemDraft[]): ConceptDraft {
  return { kind: 'concept', term, core: 'c '.repeat(coreWords).trim(), prov: { pages: [1], reason: null }, depth: items };
}

function notes(cards: ConceptDraft[]): ValidOverview {
  return {
    title: 'T',
    lede: { text: '', pages: [] },
    objectives: [],
    sections: [{ heading: 'S', pages: [1], takeaway: '', ideas: [], recommendation: null, next: false, cards }],
    greeting: 'g',
    starterQuestions: [],
  };
}

describe('fitCards: the budget kept in code', () => {
  it('cuts a card over 400 words in CARD_CUT_ORDER, never its equation, steps, table or figure', () => {
    const card = cardOf('Big', 20, [
      para(200, 'equation'),
      para(150, 'steps'),
      para(100, 'example'),
      para(100, 'intuition'),
      para(50, 'note'),
    ]);
    const { overview, itemsCut } = fitCards(notes([card]), cardBudget(100_000));
    const kept = overview.sections[0]!.cards![0]!.depth.map((d) => d.role);
    expect(kept).toEqual(['equation', 'steps']);
    expect(itemsCut).toBe(3);
    expect(CARD_CUT_ORDER).not.toContain('equation');
  });

  it('trims notes over their ceiling from the heaviest card first, and leaves notes within it alone', () => {
    const cards = [cardOf('A', 10, [para(300, 'example'), para(50, 'pitfall')]), cardOf('B', 10, [para(100, 'example')])];
    const budget = cardBudget(1000); // notes max 400, with the slack 460
    const before = cardWords(notes(cards)).notes;
    expect(before).toBeGreaterThan(460);
    const { overview, itemsCut } = fitCards(notes(cards), budget);
    expect(cardWords(overview).notes).toBeLessThanOrEqual(460);
    expect(overview.sections[0]!.cards![1]!.depth).toHaveLength(1);
    expect(itemsCut).toBeGreaterThan(0);
    const same = fitCards(notes([cardOf('C', 10, [para(50, 'example')])]), cardBudget(1000));
    expect(same.itemsCut).toBe(0);
    expect(same.coresTrimmed).toBe(0);
  });

  it('trims long core lines when the visible layer is over its ceiling', () => {
    const cards = Array.from({ length: 10 }, (_, i) => cardOf(`K${String(i)}`, 38, []));
    const { overview, coresTrimmed } = fitCards(notes(cards), cardBudget(2000)); // core max 200
    expect(coresTrimmed).toBe(10);
    expect(overview.sections[0]!.cards!.every((c) => proseWords(c.core) <= 28)).toBe(true);
  });

  it('counts words as the brief does: maths out, cards apart', () => {
    const card: ConceptDraft = {
      kind: 'concept',
      term: 'Q',
      core: 'value of $a$ in $s$',
      prov: { pages: [1], reason: null },
      depth: [{ role: 'equation', prov: { pages: [1], reason: null }, blocks: [{ kind: 'math', tex: 'Q = x', prov: { pages: [1], reason: null } }] }],
    };
    expect(cardWords(notes([card]))).toEqual({ notes: 4, core: 4, perCard: [3] });
    expect(CARD_WORDS.max).toBe(400);
  });
});

describe('small pieces', () => {
  it('cutWords keeps inline maths whole and ends on a clause', () => {
    expect(cutWords('one two three, four five six seven', 5)).toBe('one two three.');
    expect(cutWords('alpha $x + y = z$ beta gamma delta', 3)).toBe('alpha $x + y = z$ beta gamma…');
    expect(cutWords('short line', 5)).toBe('short line');
  });
  it('figureRect takes the biggest region, padded, or the whole slide when it is small', () => {
    expect(figureRect([{ rect: { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.7 }, area: 0.3 }])).toEqual({ x0: 0.18, y0: 0.18, x1: 0.82, y1: 0.72 });
    expect(figureRect([{ rect: { x0: 0.2, y0: 0.2, x1: 0.3, y1: 0.3 }, area: 0.01 }])).toBeNull();
    expect(figureRect([])).toBeNull();
  });
});

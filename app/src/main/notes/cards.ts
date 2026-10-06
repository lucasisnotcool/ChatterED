/**
 * **Notes as concept cards: the budget, the prompt, the gate and the fit** (`docs/research/
 * notebooks.md` §11.2, amended 2026-10-06; decision D1).
 *
 * For a slide deck the overview of 1 Oct named every idea and explained none: 349 words for a
 * 68-slide deck (5.7% of its words), no equation, no worked example, no table, no figure, and the
 * learner rebuilt the notes by pasting Ellie's chat answers in by hand. The amendment keeps the
 * overview's frame (title, lede, objectives, sections in the deck's order, a takeaway per section,
 * the your-note slot) and writes, in place of each section's two or three key ideas, **one concept
 * card per idea**: a core line that is always visible, and a depth folded under it (intuition, the
 * equation and its symbols in English, the slide's own worked example, the slide figure, a pitfall;
 * algorithms as numbered steps; a comparison the slide draws as a table).
 *
 * Papers and readings keep the 2 Oct prose overview (`overview.ts`): cards are the slides' form.
 *
 * Pure, like `overview.ts`: no database, no clock, no model. **The model proposes, code decides**:
 *
 *  - the budget is computed here from the slides' own words (`cardBudget`), and stated to the
 *    model as numbers, but what lands is decided by `fitCards`: a card over 400 words loses its
 *    least-needed items, and notes well over their ceiling lose items from their heaviest cards;
 *  - every page is checked against the notebook; a card with no page of its own is dropped;
 *  - **what is not on the slides says so**: intuition and pitfalls always carry a `reason`, and any
 *    item the model marks as added, or that cites no page, carries one too (§3.4);
 *  - a figure's crop is chosen in code from the page's own figure regions (`figureRect`), never
 *    from a rectangle the model made up;
 *  - every card goes through `validateConceptDraft`, the shared structural gate, last.
 */
import type { ConceptDraft, ConceptItemDraft, ConceptRole, DocBlockDraft, Provenance, Rect } from '../../shared/doc/types.js';
import { CONCEPT_ROLES } from '../../shared/doc/types.js';
import { isConceptRole } from '../../shared/doc/schema.js';
import { conceptWords, validateConceptDraft, validateTableDraft } from '../../shared/doc/validate.js';
import { draftWords } from './prompts.js';
import {
  OVERVIEW_JSON_SCHEMA,
  RECOMMENDATION_KINDS,
  TITLE_REASON,
  overviewDrafts,
  validateOverview,
  type OverviewRepairs,
  type OverviewSection,
  type ValidateOverviewContext,
  type ValidOverview,
} from './overview.js';

// ── the budget (§11.2) ────────────────────────────────────────────────────────────────────────

/**
 * **The whole notes: 30–40% of the slide words** (maths and figures not counted on either side).
 * After the MDP study day the distinct useful content of the doc came to about 42% of the slide
 * words, about 30% with the pasted chat phrasing tightened; the #48 notes ran to 177–200% and the
 * 1 Oct overview to 5–9%.
 */
export const CARD_NOTES_SHARE = { min: 0.3, max: 0.4 } as const;
/** **The always-visible layer: 8–10%**, about the old overview, so the folded doc is a few minutes' read. */
export const CARD_CORE_SHARE = { min: 0.08, max: 0.1 } as const;
/** **One card: 40–400 words by weight**, about 130 on average (the two drafted cards: 260 and 400). */
export const CARD_WORDS = { min: 40, max: 400, mean: 130 } as const;
/** A core line is the term and one sentence: about 15–30 words, cut in code past this. */
export const CARD_CORE_MAX_WORDS = 40;
/** What an over-long core layer is trimmed back to, line by line. */
export const CARD_CORE_TRIM_WORDS = 28;
/** A two-page handout still gets a few usable cards. */
export const CARD_NOTES_FLOOR = 300;
export const CARD_CORE_FLOOR = 120;
/**
 * How far over its ceiling a card set may land before code cuts it. The ratio is "a check the
 * ingest logs, not a hard ceiling" (§11.2), so the slack is generous: it is there to stop a
 * runaway answer, not to shave a good one.
 */
export const CARD_BUDGET_SLACK = 1.15;
/** The most a card answer may run to. Two thousand words of notes plus JSON and TeX is ~8–10k. */
export const CARDS_MAX_TOKENS = 32_000;
/** The most one condensed source may run to when the notes are cards. */
export const CARDS_CONDENSE_MAX_TOKENS = 16_000;

/**
 * **How long a condensed source may be when the notes are cards** (§3.5 with §11.2): the notes are
 * 30–40% of the slides, so the outline they are written from keeps about half of them, equations,
 * examples and tables verbatim, where the map's outline kept a tenth.
 */
export function cardCondenseWords(sourceWords: number): number {
  return Math.max(300, Math.min(6_000, Math.round((sourceWords * 0.5) / 50) * 50));
}

export interface CardBudget {
  /** The slides' body words (`sourceProfile`), what every number below is a share of. */
  slideWords: number;
  /** Everything the notes write, title excluded. */
  notes: { min: number; max: number };
  /** The visible layer: lede, objective titles, headings, takeaways and core lines. */
  core: { min: number; max: number };
  /** How many cards, roughly: a number for the prompt, never enforced. */
  cards: { min: number; target: number; max: number };
}

const round10 = (n: number): number => Math.round(n / 10) * 10;

/** The budget for slides of this many words. Pure. */
export function cardBudget(slideWords: number): CardBudget {
  const w = Math.max(0, slideWords);
  const notes = {
    min: Math.max(round10(CARD_NOTES_FLOOR * 0.75), round10(CARD_NOTES_SHARE.min * w)),
    max: Math.max(CARD_NOTES_FLOOR, round10(CARD_NOTES_SHARE.max * w)),
  };
  const core = {
    min: Math.max(round10(CARD_CORE_FLOOR * 0.75), round10(CARD_CORE_SHARE.min * w)),
    max: Math.max(CARD_CORE_FLOOR, round10(CARD_CORE_SHARE.max * w)),
  };
  const target = Math.max(3, Math.min(40, Math.round((notes.min + notes.max) / 2 / CARD_WORDS.mean)));
  return {
    slideWords: w,
    notes,
    core,
    cards: { min: Math.max(2, Math.round(target * 0.6)), target, max: Math.min(60, Math.round(target * 2)) },
  };
}

// ── the prompt (§11.2) ────────────────────────────────────────────────────────────────────────

export const CARDS_SYSTEM = [
  'You are writing a student\'s LECTURE NOTES from the slides of their notebook (one or more decks,',
  'laid end to end). The notes must let them study WITHOUT the slides, and still be quick to read.',
  'They are written as CONCEPT CARDS: one card per idea the lecture teaches, NOT one per slide.',
  '',
  'A CARD has two layers.',
  '- `core`, always visible: the term and a one-sentence definition in the deck\'s own terms,',
  '  15 to 30 words. It says what the idea IS, so a reader of the core lines alone has the map.',
  '  Never a pointer ("TD update rule, target, error and learning rate α" names four things and',
  '  gives none: give the rule). `term` is the idea\'s short name, as the deck names it.',
  '- `depth`, folded under the core line and opened on a click: the items the idea needs, from this',
  '  list, in this order. A card has ONLY the items its idea needs; a simple term may have none.',
  '  - `intuition`: one or two plain sentences or an analogy. Not on the slides: always added.',
  '  - `equation`: the slide\'s equation as `tex` (display maths, no $ delimiters), then `where`:',
  '    one line per symbol, "$\\gamma$: the discount factor, between 0 and 1". Every symbol a',
  '    student could ask about. One equation per item; a second equation is a second item.',
  '  - `steps`: an algorithm as numbered `steps`, each one line, updates as inline $...$; then in',
  '    `text` its convergence, optimality and cost, one short line each where the slides give them.',
  '  - `example`: ONE worked example with numbers: the slide\'s own when it has one (say which',
  '    case, then work it), otherwise a tiny one you make up, marked added. Never an exercise the',
  '    slides set for the student to solve: name such an exercise in a `note`, do not solve it.',
  '  - `table`: wherever the slide gives a comparison as a table, the table itself (`columns`,',
  '    `rows`, 2 to 6 columns, at most 12 rows; short cells), with `text` as its caption.',
  '  - `figure`: when the idea\'s slide is mostly a figure (a diagram, a grid, a plot), its `page`,',
  '    with `text` saying in one line what it shows. The app crops the slide; never describe the',
  '    figure at length instead.',
  '  - `result`: a result the deck relies on whose proof is in an appendix: the result in one line.',
  '  - `pitfall`: the one misconception the idea invites, said plainly. Not on the slides: added.',
  '  - `note`: anything else the slides say about the idea that a student needs.',
  '',
  'SECTIONS follow the deck\'s order. Each has a `heading` (the lecturer\'s words), `pages`, a',
  'one-line `takeaway` (the sentence to leave with), then its `cards`. Optionally one',
  '`recommendation` (flashcards, quiz, diagram or infographic) that the student could add.',
  '',
  'LEAVE OUT OR FOLD:',
  '- title, agenda, recap and section-divider slides; homework or readings get ONE line in `next`;',
  '- a repeated slide (say it once); demos, videos and links (one "try it" note at most);',
  '- a motivating story or vignette: one sentence where its idea first appears, never repeated;',
  '- asides (related work, image credits);',
  '- appendix proofs: keep only the results the main deck relies on, as `result` items.',
  '',
  'NOTHING THE SLIDES DO NOT SAY, UNLESS IT IS MARKED. You may explain, connect and phrase. Every',
  'depth item has `pages` (the slides it comes from) and `added`: true when what it says is not',
  'on those slides (an intuition, a pitfall, an example you made up, an argument the slides only',
  'state). Never a fact, number or citation the slides do not give, presented as theirs.',
  '',
  'PAGES ARE MANDATORY AND REAL. Every page number is a [p. N] number from the text you are given:',
  'the notebook\'s page numbers, counted across all the sources. A card cites the page(s) that',
  'define its idea. Never a page you were not shown.',
  '',
  'LENGTH. You are given the word budget for the whole notes and for the visible layer, and how',
  'many cards to expect. They are measured in code; maths and figures do not count. Spend the',
  'words where the slides do: an algorithm or a central equation gets a long card (up to 400',
  'words), a term a short one (about 40). Be dense: no "it is important to note", no narrating the',
  'deck ("this slide shows"), no exam framing, no padding, nothing said twice.',
  '',
  'MARKUP: **bold**, *italic*, `code` and maths. Maths is typeset: inline $...$ TeX in any text,',
  '`tex` (no delimiters) for an equation item. Write formulas as TeX, never as h_FF-style text.',
  '',
  'THE REST OF THE SHAPE, as before: `title` (the sources\' own topic), `lede` (two or three',
  'sentences with `pages`), four to six `objectives` (`title` at most twelve words, a skill or a',
  'claim; a one-sentence `statement`; two to four checkable `criteria`; up to three `quizSeeds`,',
  'never yes/no, never containing their own answer; `pages`), `next` (optional, null otherwise:',
  'what comes next, homework or readings, as `ideas` of one line each), `greeting` (one line in',
  'Ellie\'s voice, a peer, plain, no exclamation marks, no "Welcome to") and exactly three',
  '`starterQuestions` (each under fifteen words, plain text, no markup and no $tex$).',
  '',
  'Return the JSON object and nothing else.',
].join('\n');

export interface CardsPromptInput {
  notebookName: string;
  sourceNames: readonly string[];
  deckText: string;
  condensed: boolean;
  budget: CardBudget;
  /** Pages with images attached to the call. */
  imagePages: readonly number[];
  /** Pages that are mostly a figure, with the share of the slide it covers: figure candidates. */
  figurePages?: readonly { page: number; area: number }[];
}

/** The user message for the card call. */
export function cardsMessage(input: CardsPromptInput): string {
  const parts: string[] = [`NOTEBOOK: ${input.notebookName}`];
  parts.push(
    input.sourceNames.length > 1
      ? `SOURCES (${input.sourceNames.length}, in the order added):\n${input.sourceNames.map((n) => `  - ${n}`).join('\n')}`
      : `SOURCE: ${input.sourceNames[0] ?? input.notebookName}`,
  );
  if (input.imagePages.length > 0) {
    parts.push(
      `YOU ALSO HAVE THE PAGE IMAGES of pages ${input.imagePages.join(', ')}. Use them to see what the text cannot show (what a diagram connects, which cells a table compares, how an equation is laid out). The text is still the authority on wording.`,
    );
  }
  const figures = (input.figurePages ?? []).filter((f) => f.area >= FIGURE_MIN_AREA);
  if (figures.length > 0) {
    parts.push(
      `PAGES THAT ARE MOSTLY A FIGURE (a \`figure\` item may show one): ${figures
        .map((f) => `p. ${String(f.page)} (${String(Math.round(f.area * 100))}% of the slide)`)
        .join(', ')}.`,
    );
  }
  parts.push(
    [
      input.condensed
        ? 'THE SOURCES, CONDENSED. They were too long to send whole, so each was first outlined on its own. The [p. N] markers are still the notebook\'s real page numbers; cite them.'
        : 'THE SOURCES. Each page starts with its [p. N] line: N is the notebook page to cite. Each source starts with its === SOURCE === line.',
      '',
      input.deckText,
    ].join('\n'),
  );
  const b = input.budget;
  parts.push(
    `Write the notes now. The slides say about ${b.slideWords} words (maths aside).` +
      ` **The whole notes are ${b.notes.min} to ${b.notes.max} words**, of which the visible layer` +
      ` (lede, objective titles, headings, takeaways and core lines) is ${b.core.min} to ${b.core.max}.` +
      ` Expect about ${b.cards.target} cards (${b.cards.min} to ${b.cards.max}, one per idea), each 40 to 400 words` +
      ' by weight. Four to six objectives, sections in the deck\'s order, exactly three starter questions.',
  );
  return parts.join('\n\n');
}

/** A figure covering less of its slide than this is decoration, not the slide's content. */
export const FIGURE_MIN_AREA = 0.15;

const PAGES = { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'Notebook pages, from the [p. N] markers.' };

/** A table the slide draws is written in at ingest (§5.3 as amended), so it is not recommended. */
export const CARD_RECOMMENDATION_KINDS = RECOMMENDATION_KINDS.filter((k) => k !== 'table');

/** One depth item, as the model writes it: a flat shape with a role, checked in code. */
const ITEM_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['role', 'pages', 'added'],
  properties: {
    role: { type: 'string', enum: [...CONCEPT_ROLES] },
    text: { type: 'string', description: 'The item\'s prose; for a table its caption, for a figure what it shows.' },
    tex: { type: 'string', description: 'equation: the display formula as TeX, no $ delimiters.' },
    where: { type: 'array', items: { type: 'string' }, description: 'equation: one line per symbol, "$x$: what it is".' },
    steps: { type: 'array', items: { type: 'string' }, description: 'steps: the algorithm, one line per step.' },
    columns: { type: 'array', items: { type: 'string' }, description: 'table: the column headings.' },
    rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'table: one array of cells per row.' },
    page: { type: 'integer', minimum: 1, description: 'figure: the slide to show.' },
    pages: PAGES,
    added: { type: 'boolean', description: 'True when what this item says is not on its pages.' },
  },
};

const CARD_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['term', 'core', 'pages', 'depth'],
  properties: {
    term: { type: 'string', description: 'The idea\'s short name, as the deck names it.' },
    core: { type: 'string', description: 'The term and a one-sentence definition, 15 to 30 words.' },
    pages: PAGES,
    depth: { type: 'array', items: ITEM_SCHEMA, description: 'Only the items the idea needs, in reading order.' },
  },
};

/**
 * **The card call's JSON schema**: the overview's (title, lede, objectives, next, greeting,
 * starters), with each section's `ideas` replaced by `cards`. A near miss comes back as something
 * the gate can repair: the counts and the budget are enforced in code, not here.
 */
export const CARDS_JSON_SCHEMA: Record<string, unknown> = (() => {
  const base = OVERVIEW_JSON_SCHEMA as { properties: Record<string, Record<string, unknown>> } & Record<string, unknown>;
  const sections = base.properties.sections as { items: { properties: Record<string, unknown> } };
  const recommendation = sections.items.properties.recommendation as Record<string, unknown>;
  return {
    ...base,
    properties: {
      ...base.properties,
      sections: {
        type: 'array',
        description: 'In the deck\'s order, one per part of the lecture.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['heading', 'pages', 'takeaway', 'cards'],
          properties: {
            heading: { type: 'string' },
            pages: PAGES,
            takeaway: { type: 'string', description: 'One line.' },
            cards: { type: 'array', items: CARD_SCHEMA },
            recommendation: {
              ...recommendation,
              properties: {
                ...(recommendation.properties as Record<string, unknown>),
                kind: { type: 'string', enum: CARD_RECOMMENDATION_KINDS },
              },
            },
          },
        },
      },
    },
  };
})();

/** True when a model answer is in the card shape: some section carries `cards`. */
export function hasCards(raw: unknown): boolean {
  const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const sections = Array.isArray(root?.sections) ? (root.sections as unknown[]) : [];
  return sections.some((s) => s !== null && typeof s === 'object' && Array.isArray((s as Record<string, unknown>).cards));
}

// ── the gate ──────────────────────────────────────────────────────────────────────────────────

/** Provenance reasons for what is not on the slides (§3.4): honest about what the item is. */
export const ADDED_REASONS: Record<ConceptRole, string> = {
  intuition: 'intuition, added',
  equation: 'added: not on the cited slides',
  steps: 'added: not on the cited slides',
  example: 'a small example, added',
  table: 'added: not on the cited slides',
  figure: 'added: not on the cited slides',
  result: 'added: not on the cited slides',
  pitfall: 'a common pitfall, added',
  note: 'added: not on the cited slides',
};

/** Roles that are never the slides' own words, whatever the model says (§11.2: "marked added"). */
const ALWAYS_ADDED: ReadonlySet<ConceptRole> = new Set(['intuition', 'pitfall']);

export interface CardRepairs {
  cardsDropped: number;
  itemsDropped: number;
  itemsAddedForced: number;
  coresCut: number;
  figuresDropped: number;
  tablesDropped: number;
  problems: number;
}

export interface CardContext extends ValidateOverviewContext {
  /** The crop for a figure on this notebook page (`figureRect`), or null for the whole slide. */
  figureRect?(page: number): Rect | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\s\u00a0]+/g, ' ').trim() : '';
}

/** Lines of prose: paragraphs split on blank lines, each with its whitespace folded. */
function paragraphs(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[\s\u00a0]+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

function strings(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).map(text).filter((s) => s.length > 0);
}

/** Words as the budget counts them: a token with a letter or digit, inline maths left out. */
export function proseWords(value: string): number {
  return value
    .replace(/\$[^$]*\$/g, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * **A line cut to `max` words at its last full clause** (or sentence), never mid-word, never
 * inside inline maths. A cut that would leave under a third of the budget falls at the last whole
 * word instead, with an ellipsis.
 */
export function cutWords(line: string, max: number): string {
  if (proseWords(line) <= max) return line;
  // Tokens, with inline maths kept whole so a formula is never split.
  const tokens = line.match(/\$[^$]*\$\S*|\S+/g) ?? [];
  let counted = 0;
  let lastWithin = -1;
  let clauseEnd = -1;
  let clauseWords = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (!token.startsWith('$') && /[\p{L}\p{N}]/u.test(token)) counted += 1;
    if (counted > max) break;
    lastWithin = i;
    if (/[,;:.!?]["”’)]*$/.test(token)) {
      clauseEnd = i;
      clauseWords = counted;
    }
  }
  if (clauseEnd >= 0 && clauseWords >= Math.ceil(max / 3)) {
    const kept = tokens.slice(0, clauseEnd + 1).join(' ').replace(/[,;:]+$/, '');
    return /[.!?]["”’)]*$/.test(kept) ? kept : `${kept}.`;
  }
  return `${tokens.slice(0, lastWithin + 1).join(' ').replace(/[,;:]+$/, '')}…`;
}

const rank = (role: ConceptRole): number => CONCEPT_ROLES.indexOf(role);

/**
 * **One depth item, as the model wrote it, into blocks.** The role decides the shape: an equation
 * is a formula then its "where" list, steps a numbered list, a table a table (through the shared
 * table gate), a figure the slide image with its crop chosen in code. Prose may come with any role
 * and goes first. Null when nothing usable is left.
 */
function itemOf(raw: unknown, ctx: CardContext, pagesOf: (v: unknown) => number[], repairs: CardRepairs): ConceptItemDraft | null {
  const record = asRecord(raw);
  if (!record) {
    repairs.itemsDropped += 1;
    return null;
  }
  const role: ConceptRole = isConceptRole(record.role) ? record.role : 'note';
  const pages = pagesOf(record.pages);
  const claimed = record.added === true;
  const added = ALWAYS_ADDED.has(role) || claimed || pages.length === 0;
  if (ALWAYS_ADDED.has(role) && !claimed) repairs.itemsAddedForced += 1;
  const prov: Provenance = { pages, reason: added ? ADDED_REASONS[role] : null };
  const blocks: DocBlockDraft[] = [];
  const body = paragraphs(record.text);

  if (role === 'table') {
    const { draft } = validateTableDraft(
      { caption: body.join(' ') || null, columns: record.columns, rows: record.rows },
      ctx.pageCount,
      prov,
    );
    if (draft) blocks.push(draft);
    else {
      repairs.tablesDropped += 1;
      for (const p of body) blocks.push({ kind: 'paragraph', text: p, prov });
    }
  } else if (role === 'figure') {
    const page = typeof record.page === 'number' ? Math.trunc(record.page) : (pages[0] ?? Number.NaN);
    if (!Number.isInteger(page) || page < 1 || page > ctx.pageCount || !ctx.pageExists(page)) {
      repairs.figuresDropped += 1;
      return null;
    }
    // The slide itself: its page is the provenance, and nothing about it is added.
    const figureProv: Provenance = { pages: [...new Set([page, ...pages])].sort((a, b) => a - b), reason: null };
    blocks.push({ kind: 'figure', page, rect: ctx.figureRect?.(page) ?? null, caption: body.join(' '), prov: figureProv });
    return { role, blocks, prov: figureProv };
  } else {
    for (const p of body) blocks.push({ kind: 'paragraph', text: p, prov });
    const steps = strings(record.steps);
    const tex = text(record.tex).replace(/^\$\$?|\$\$?$/g, '').trim();
    const where = strings(record.where);
    // Steps first, then the update: an algorithm's prose is its convergence and cost, which
    // reads after the steps it is about; an equation's is the line that introduces it.
    if (role === 'steps') {
      if (steps.length > 0) blocks.splice(0, 0, { kind: 'numbers', items: steps, prov });
    } else if (steps.length > 0) {
      blocks.push({ kind: 'numbers', items: steps, prov });
    }
    if (tex.length > 0) blocks.push({ kind: 'math', tex, prov });
    if (where.length > 0) blocks.push({ kind: 'bullets', items: where, prov });
  }
  if (blocks.length === 0) {
    repairs.itemsDropped += 1;
    return null;
  }
  return { role, blocks, prov };
}

/**
 * **One card, as the model wrote it, checked.** A card needs a core line and a page of its own (the
 * core line is the slides' definition, so it is cited, §3.4); a core with no page takes its items'
 * pages, and with none at all the card goes. Items are put in reading order. The card's own pages
 * are its core's and every item's that is the slides' own: what the slide strip groups it by.
 */
function cardOf(raw: unknown, ctx: CardContext, pagesOf: (v: unknown) => number[], repairs: CardRepairs): ConceptDraft | null {
  const record = asRecord(raw);
  if (!record) {
    repairs.cardsDropped += 1;
    return null;
  }
  let core = text(record.core);
  const term = text(record.term);
  if (core.length === 0) {
    repairs.cardsDropped += 1;
    return null;
  }
  if (proseWords(core) > CARD_CORE_MAX_WORDS) {
    core = cutWords(core, CARD_CORE_MAX_WORDS);
    repairs.coresCut += 1;
  }
  const depth = (Array.isArray(record.depth) ? record.depth : [])
    .map((item) => itemOf(item, ctx, pagesOf, repairs))
    .filter((item): item is ConceptItemDraft => item !== null)
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item.role) - rank(b.item.role) || a.i - b.i)
    .map(({ item }) => item);
  const own = pagesOf(record.pages);
  const cited = depth.filter((d) => d.prov.reason === null).flatMap((d) => d.prov.pages);
  const pages = [...new Set([...own, ...cited])].sort((a, b) => a - b);
  if (pages.length === 0) {
    repairs.cardsDropped += 1;
    return null;
  }
  const { draft, problems } = validateConceptDraft({ kind: 'concept', term, core, depth, prov: { pages, reason: null } }, ctx.pageCount);
  repairs.problems += problems.length;
  if (!draft) repairs.cardsDropped += 1;
  return draft;
}

export interface ValidCards {
  overview: ValidOverview;
  repairs: OverviewRepairs & CardRepairs;
}

/**
 * **The card answer, checked against the notebook.** The frame (title, lede, objectives, sections,
 * greeting, starters, recommendations) goes through the overview's own gate, unchanged; then each
 * surviving section gets its cards. A section the frame kept whose cards all failed keeps its
 * heading and takeaway. Null only when no section survives.
 */
export function validateCards(raw: unknown, ctx: CardContext): { overview: ValidOverview | null; repairs: OverviewRepairs & CardRepairs } {
  const root = asRecord(raw) ?? {};
  const rawSections = Array.isArray(root.sections) ? (root.sections as unknown[]) : [];
  // The frame sees each card's core line as an idea, so a section whose only substance is its
  // cards is not dropped as empty; the ideas themselves are not kept.
  const framed = {
    ...root,
    sections: rawSections.map((s) => {
      const r = asRecord(s) ?? {};
      const cards = Array.isArray(r.cards) ? r.cards : [];
      const rec = asRecord(r.recommendation);
      return {
        ...r,
        ideas: cards.map((c) => ({ text: text(asRecord(c)?.core) || '…', pages: asRecord(c)?.pages ?? r.pages })),
        recommendation: rec && rec.kind === 'table' ? null : r.recommendation,
      };
    }),
  };
  const { overview, repairs: frameRepairs } = validateOverview(framed, {
    ...ctx,
    // Cards carry no blank (§11.2); the blank check is the map's.
    pageTexts: undefined,
    maxIdeas: Number.MAX_SAFE_INTEGER,
    keepSource: true,
  });
  const repairs: OverviewRepairs & CardRepairs = {
    ...frameRepairs,
    // The frame's "ideas" were the cards' core lines, counted as cards below.
    ideasDropped: 0,
    cardsDropped: 0,
    itemsDropped: 0,
    itemsAddedForced: 0,
    coresCut: 0,
    figuresDropped: 0,
    tablesDropped: 0,
    problems: 0,
  };
  if (!overview) return { overview: null, repairs };

  const pagesOf = (value: unknown): number[] => {
    const out: number[] = [];
    for (const p of Array.isArray(value) ? value : []) {
      const n = typeof p === 'number' ? Math.trunc(p) : Number.NaN;
      if (Number.isInteger(n) && n >= 1 && n <= ctx.pageCount && ctx.pageExists(n)) {
        if (!out.includes(n)) out.push(n);
      } else repairs.pagesDropped += 1;
    }
    return out.sort((a, b) => a - b);
  };

  const sections: OverviewSection[] = overview.sections.map((section) => {
    if (section.next || section.source === undefined) return section;
    const rawCards = asRecord(rawSections[section.source])?.cards;
    const cards = (Array.isArray(rawCards) ? rawCards : [])
      .map((c) => cardOf(c, ctx, pagesOf, repairs))
      .filter((c): c is ConceptDraft => c !== null);
    const pages = [...new Set([...section.pages, ...cards.flatMap((c) => c.prov.pages)])].sort((a, b) => a - b);
    return { ...section, ideas: [], cards, pages };
  });
  return { overview: { ...overview, sections }, repairs };
}

// ── the fit: the budget kept in code (§11.2) ──────────────────────────────────────────────────

/**
 * The order items go in when a card or the notes are over budget: what a student can most easily
 * do without first. An equation, an algorithm's steps, a table and a figure are the slide's own
 * substance and are never cut; the example goes last of the rest.
 */
export const CARD_CUT_ORDER: readonly ConceptRole[] = ['note', 'result', 'intuition', 'pitfall', 'example'];

export interface CardWords {
  /** Everything, title excluded (`overviewWords`). */
  notes: number;
  /** The visible layer: lede, objective titles, headings, takeaways, core lines, `next` ideas. */
  core: number;
  /** Per card, in document order: core line plus depth. */
  perCard: number[];
}

/** The words of notes in the card form, as the budget counts them (maths and figures left out). */
export function cardWords(overview: ValidOverview): CardWords {
  const titles = overview.objectives.map((o) => o.title);
  const drafts = overviewDrafts(overview, titles).drafts;
  let notes = 0;
  let core = 0;
  const perCard: number[] = [];
  for (const d of drafts) {
    if (d.kind === 'heading' && d.prov.reason === TITLE_REASON) continue;
    if (d.kind === 'concept') {
      const w = conceptWords(d);
      notes += w.core + w.depth;
      core += w.core;
      perCard.push(w.core + w.depth);
      continue;
    }
    const w = draftWords([d]);
    notes += w;
    core += w;
  }
  return { notes, core, perCard };
}

/** The first item of a card that may be cut, in `CARD_CUT_ORDER`, or -1. */
function cuttable(card: ConceptDraft): number {
  for (const role of CARD_CUT_ORDER) {
    const at = card.depth.findIndex((item) => item.role === role);
    if (at >= 0) return at;
  }
  return -1;
}

function withoutItem(card: ConceptDraft, index: number): ConceptDraft {
  return { ...card, depth: card.depth.filter((_, i) => i !== index) };
}

export interface CardFit {
  overview: ValidOverview;
  itemsCut: number;
  coresTrimmed: number;
}

/**
 * **The budget, kept in code.** Three passes, each only as far as it has to go:
 *
 *  1. **a card over 400 words** (with the slack) loses items in `CARD_CUT_ORDER` until it fits;
 *  2. **notes over their ceiling** (with the slack) lose one item at a time from the heaviest card
 *     that still has one to lose, until they fit or nothing more may go;
 *  3. **a visible layer over its ceiling** has every core line over `CARD_CORE_TRIM_WORDS` cut back
 *     to it at a clause.
 *
 * Under the floor nothing is added: the ratio is a check that is logged (§11.2). Pure.
 */
export function fitCards(overview: ValidOverview, budget: CardBudget): CardFit {
  let itemsCut = 0;
  let coresTrimmed = 0;
  const cardCap = CARD_WORDS.max * CARD_BUDGET_SLACK;
  let sections = overview.sections.map((section) => {
    if (!section.cards) return section;
    const cards = section.cards.map((card) => {
      let current = card;
      const words = (c: ConceptDraft): number => {
        const w = conceptWords(c);
        return w.core + w.depth;
      };
      while (words(current) > cardCap) {
        const at = cuttable(current);
        if (at < 0) break;
        current = withoutItem(current, at);
        itemsCut += 1;
      }
      return current;
    });
    return { ...section, cards };
  });

  const ceiling = budget.notes.max * CARD_BUDGET_SLACK;
  for (;;) {
    const current: ValidOverview = { ...overview, sections };
    if (cardWords(current).notes <= ceiling) break;
    let best: { s: number; c: number; words: number } | null = null;
    for (let s = 0; s < sections.length; s += 1) {
      const cards = sections[s]!.cards ?? [];
      for (let c = 0; c < cards.length; c += 1) {
        if (cuttable(cards[c]!) < 0) continue;
        const w = conceptWords(cards[c]!);
        if (best === null || w.core + w.depth > best.words) best = { s, c, words: w.core + w.depth };
      }
    }
    if (best === null) break;
    const { s, c } = best;
    sections = sections.map((section, i) =>
      i !== s || !section.cards ? section : { ...section, cards: section.cards.map((card, j) => (j === c ? withoutItem(card, cuttable(card)) : card)) },
    );
    itemsCut += 1;
  }

  if (cardWords({ ...overview, sections }).core > budget.core.max * CARD_BUDGET_SLACK) {
    sections = sections.map((section) =>
      !section.cards
        ? section
        : {
            ...section,
            cards: section.cards.map((card) => {
              if (proseWords(card.core) <= CARD_CORE_TRIM_WORDS) return card;
              coresTrimmed += 1;
              return { ...card, core: cutWords(card.core, CARD_CORE_TRIM_WORDS) };
            }),
          },
    );
  }
  return { overview: { ...overview, sections }, itemsCut, coresTrimmed };
}

// ── figures: the crop chosen in code ─────────────────────────────────────────────────────────

/**
 * **The crop of a figure slide**: the page's biggest figure region when it covers at least
 * `FIGURE_MIN_AREA` of the slide, a little padded; otherwise the whole slide (null). `regions` are
 * pass 1's figure boxes for the page (`extract.ts` `pageFigures`), biggest first.
 */
export function figureRect(regions: readonly { rect: Rect; area: number }[]): Rect | null {
  const biggest = regions[0];
  if (!biggest || biggest.area < FIGURE_MIN_AREA) return null;
  const pad = 0.02;
  const r = biggest.rect;
  const at = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
  return { x0: at(r.x0 - pad), y0: at(r.y0 - pad), x1: at(r.x1 + pad), y1: at(r.y1 + pad) };
}

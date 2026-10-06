/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE NOTES DOCUMENT MODEL (`docs/research/collab-doc.md` §8; issue #48)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The ProseMirror schema for the collaborative lecture notes, and the pure read-side helpers
 * every other track needs (`blockPos`, the outline a prompt is given, the learner's own spans).
 *
 * **Three properties this file exists to make structural rather than careful:**
 *
 *  1. **Provenance is mandatory** (§2). Every block-level node carries `pages` and `reason`, so
 *     a block that came from nowhere is representable only as a bug the validator catches — not
 *     as a block that quietly lost its chip on the way through the editor.
 *  2. **Who wrote which characters is on the text, not beside it** (§5.4). The `author` mark is
 *     on *every* text span; the guard reads nothing else. There is no side table of ranges to
 *     fall out of sync with the document, and a span that survives a copy-paste keeps its author
 *     because marks travel with the slice.
 *  3. **Agents address blocks, never offsets** (§8). `blockId` is on the node, so an agent op
 *     that arrives three edits late still lands on the block it meant, or on nothing at all.
 *
 * **No DOM.** `toDOM`/`parseDOM` below are *data* — ProseMirror only runs them inside a view,
 * and nothing in `src/shared/doc/` constructs one. That is what lets the guard, the ops and the
 * suggestions be unit-tested in vitest's node environment, which §8 requires ("the guard and the
 * op→transaction mapping are pure, in `src/shared/doc/`, tested without a DOM").
 *
 * ## The one compromise: `blockId` has a default
 *
 * The contract calls `blockId` "required". A ProseMirror attr with no default cannot be created
 * without it — which reads well until the learner presses Enter in the middle of a paragraph:
 * `splitBlock` copies the node's attrs, so a hard requirement buys us a *duplicated* id rather
 * than a missing one, and a duplicate is the worse failure (`blockPos` silently resolves an
 * agent op onto the wrong half). So the attr defaults to `''` — "not yet minted" — and
 * `assignMissingBlockIds()` (below) mints ids for empty *and duplicate* ids in one pass. T4 runs
 * it from an `appendTransaction`; every reader here treats `''` as "no id" and never matches it.
 */

import { Fragment, Mark, Node, Schema, type MarkSpec, type NodeSpec, type NodeType } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import type {
  DiagramEdge,
  DiagramLayout,
  DiagramSpec,
  DocAuthor,
  FlashcardsSpec,
  InfographicLayout,
  InfographicSpec,
  OutlineEntry,
  QuizQuestionType,
  QuizSpec,
  Rect,
  TableGrid,
} from './types.js';
import { CONCEPT_ROLES, OBJECTIVES_REASON, type ConceptRole } from './types.js';
import type { TutorialAnswerKind, TutorialOption, TutorialPartOrigin } from '../tutorial.js';

/**
 * What a `parseDOM` handler below actually touches: one method.
 *
 * It is spelled out rather than written `HTMLElement` because of the "No DOM" paragraph above.
 * This file is compiled into the **main** bundle as well as the renderer's — the ingest validates
 * its drafts against this schema — and `tsconfig.main.json`'s `lib` is `ES2022` with no DOM, so
 * naming `HTMLElement` here fails `npm run build:main` even though main never runs a parse rule.
 * `HTMLElement` is assignable to this, so the rules still type-check where a view supplies one.
 */
interface AttrSource {
  getAttribute(name: string): string | null;
}

// ── ids ─────────────────────────────────────────────────────────────────────────────────────

/**
 * `b_<12 hex>` — the same shape `main/vault/repo.ts` and `main/sessions.ts` mint their ids in,
 * from the same source, so an id is recognisable on sight in a log line.
 *
 * `globalThis.crypto` (not `node:crypto`) because this module is imported by the renderer as
 * well as by main; it is a standard global in Node 22 and in Chromium.
 */
export function newBlockId(): string {
  return `b_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

// ── attrs shared by every block-level node ──────────────────────────────────────────────────

/**
 * `blockId` · `pages` · `reason` · `objectiveIds` on every block (§2, §6).
 *
 * The arrays are shared default *values*: ProseMirror stores an attr by reference and nothing in
 * this codebase mutates an attr array in place — every helper that produces one builds a fresh
 * array. Keep it that way.
 */
const BLOCK_ATTRS = {
  blockId: { default: '' },
  pages: { default: [] as number[] },
  reason: { default: null as string | null },
  objectiveIds: { default: [] as string[] },
};

/** The block attrs of a node, normalised and copied — never a reference into the node's attrs. */
export interface BlockAttrs {
  blockId: string;
  pages: number[];
  reason: string | null;
  objectiveIds: string[];
}

export function blockAttrs(node: Node): BlockAttrs {
  const attrs = node.attrs as Record<string, unknown>;
  return {
    blockId: typeof attrs.blockId === 'string' ? attrs.blockId : '',
    pages: Array.isArray(attrs.pages) ? [...(attrs.pages as number[])] : [],
    reason: typeof attrs.reason === 'string' ? attrs.reason : null,
    objectiveIds: Array.isArray(attrs.objectiveIds) ? [...(attrs.objectiveIds as string[])] : [],
  };
}

/** `data-*` for the block attrs. Read by the provenance chip (T4) and by nothing else. */
function blockDataAttrs(node: Node): Record<string, string> {
  const { blockId, pages, reason, objectiveIds } = blockAttrs(node);
  const out: Record<string, string> = {};
  if (blockId) out['data-block-id'] = blockId;
  if (pages.length > 0) out['data-pages'] = pages.join(',');
  if (reason) out['data-reason'] = reason;
  if (objectiveIds.length > 0) out['data-objectives'] = objectiveIds.join(',');
  return out;
}

/** `data-pages="4,5"` → `[4, 5]`. Shared by the blocks and by the rows and nodes inside them. */
function readPages(dom: AttrSource): number[] {
  return (dom.getAttribute('data-pages') ?? '')
    .split(',')
    .map((n) => Number.parseInt(n, 10))
    .filter((n) => Number.isInteger(n));
}

/** The inverse, for `parseDOM`. Only ever runs inside a view; kept symmetrical so paste works. */
function readBlockAttrs(dom: AttrSource): Record<string, unknown> {
  const pages = readPages(dom);
  const objectives = (dom.getAttribute('data-objectives') ?? '').split(',').filter((s) => s.length > 0);
  return {
    blockId: dom.getAttribute('data-block-id') ?? '',
    pages,
    reason: dom.getAttribute('data-reason'),
    objectiveIds: objectives,
  };
}

// ── nodes ───────────────────────────────────────────────────────────────────────────────────

/**
 * `card` is a group of one, `concept` (2026-10-06): a concept card may stand where a block stands
 * at the top of the document and nowhere else, so a card is never nested in a card, a list, a
 * Q block or a tutorial part, by construction rather than by care.
 */
const doc: NodeSpec = { content: '(block | card)+' };

const text: NodeSpec = { group: 'inline' };

const paragraph: NodeSpec = {
  content: 'inline*',
  group: 'block',
  attrs: { ...BLOCK_ATTRS },
  parseDOM: [{ tag: 'p', getAttrs: readBlockAttrs }],
  toDOM: (node) => ['p', blockDataAttrs(node), 0],
};

const heading: NodeSpec = {
  content: 'inline*',
  group: 'block',
  defining: true,
  attrs: { level: { default: 1 }, ...BLOCK_ATTRS },
  parseDOM: [1, 2, 3].map((level) => ({
    tag: `h${level}`,
    getAttrs: (dom: AttrSource) => ({ ...readBlockAttrs(dom), level }),
  })),
  toDOM: (node) => [`h${String(node.attrs.level)}`, blockDataAttrs(node), 0],
};

const bullet_list: NodeSpec = {
  content: 'list_item+',
  group: 'block',
  attrs: { ...BLOCK_ATTRS },
  parseDOM: [{ tag: 'ul', getAttrs: readBlockAttrs }],
  toDOM: (node) => ['ul', blockDataAttrs(node), 0],
};

const ordered_list: NodeSpec = {
  content: 'list_item+',
  group: 'block',
  attrs: { start: { default: 1 }, ...BLOCK_ATTRS },
  parseDOM: [
    {
      tag: 'ol',
      getAttrs: (dom: AttrSource) => ({
        ...readBlockAttrs(dom),
        start: Number.parseInt(dom.getAttribute('start') ?? '1', 10) || 1,
      }),
    },
  ],
  toDOM: (node) => {
    const attrs = blockDataAttrs(node);
    const start = node.attrs.start as number;
    if (start !== 1) attrs.start = String(start);
    return ['ol', attrs, 0];
  },
};

/**
 * `list_item` carries `blockId` only (the contract): its provenance is the list's. `paragraph
 * block*` rather than `paragraph+` so a nested list is representable — the ingest does not write
 * one, but a learner can paste one and the doc must survive it.
 */
const list_item: NodeSpec = {
  content: 'paragraph block*',
  defining: true,
  attrs: { blockId: { default: '' } },
  parseDOM: [{ tag: 'li', getAttrs: (dom: AttrSource) => ({ blockId: dom.getAttribute('data-block-id') ?? '' }) }],
  toDOM: (node) => {
    const id = node.attrs.blockId as string;
    return ['li', id ? { 'data-block-id': id } : {}, 0];
  },
};

/**
 * Code keeps the author mark (and the suggestion marks) and drops the rest: `**bold**` inside a
 * code block is two asterisks and a word, and the guard must be able to read the author of a
 * character wherever the character is.
 */
const code_block: NodeSpec = {
  content: 'text*',
  marks: 'author suggest_ins suggest_del',
  group: 'block',
  code: true,
  defining: true,
  attrs: { lang: { default: null as string | null }, ...BLOCK_ATTRS },
  parseDOM: [
    {
      tag: 'pre',
      preserveWhitespace: 'full',
      getAttrs: (dom: AttrSource) => ({ ...readBlockAttrs(dom), lang: dom.getAttribute('data-lang') }),
    },
  ],
  toDOM: (node) => {
    const attrs = blockDataAttrs(node);
    const lang = node.attrs.lang as string | null;
    if (lang) attrs['data-lang'] = lang;
    return ['pre', attrs, ['code', 0]];
  },
};

/** Display maths. An atom: the TeX is the node, and KaTeX draws it in the view (T4). */
const math_block: NodeSpec = {
  group: 'block',
  atom: true,
  defining: true,
  attrs: { tex: { default: '' }, ...BLOCK_ATTRS },
  parseDOM: [
    {
      tag: 'div[data-math-block]',
      getAttrs: (dom: AttrSource) => ({ ...readBlockAttrs(dom), tex: dom.getAttribute('data-tex') ?? '' }),
    },
  ],
  toDOM: (node) => [
    'div',
    { ...blockDataAttrs(node), 'data-math-block': '', 'data-tex': node.attrs.tex as string },
  ],
};

/**
 * **Max's question, in the document** (§5.2). `isolating` so no editing gesture can merge it
 * into the prose around it, `block+` because the resolution (§5.3) is written *inside* it under
 * the question paragraph, and the block stays after it is resolved — the learner removes it if
 * they want to.
 *
 * Two attributes from 6 Oct afternoon (#67, `notebooks.md` §11.10):
 *  - `cardId`: the concept card the question is about, set when Max's question goes in under a
 *    card (`insert_q`). A topic is complete only when every card it covers has a *Well done*
 *    (decision 9), so a verdict has to know its card. Null outside a card and on older blocks.
 *  - `maxNote`: Max's one sentence for the closed question's chip (decision 12), set by
 *    `resolve_q` on *you got this*. An attribute, never text, so it is never one of the learner's
 *    spans and never in the outline an agent reads: the chip draws it, marked as his.
 */
const q_block: NodeSpec = {
  content: 'block+',
  group: 'block',
  defining: true,
  isolating: true,
  attrs: {
    questionId: { default: '' },
    askedBy: { default: 'max' },
    status: { default: 'open' },
    resolution: { default: null as string | null },
    objectiveId: { default: null as string | null },
    cardId: { default: null as string | null },
    maxNote: { default: null as string | null },
    ...BLOCK_ATTRS,
  },
  parseDOM: [
    {
      tag: 'section[data-question-id]',
      getAttrs: (dom: AttrSource) => ({
        ...readBlockAttrs(dom),
        questionId: dom.getAttribute('data-question-id') ?? '',
        askedBy: dom.getAttribute('data-asked-by') ?? 'max',
        status: dom.getAttribute('data-status') ?? 'open',
        resolution: dom.getAttribute('data-resolution'),
        objectiveId: dom.getAttribute('data-objective-id'),
        cardId: dom.getAttribute('data-card-id'),
        maxNote: dom.getAttribute('data-max-note'),
      }),
    },
  ],
  toDOM: (node) => {
    const attrs: Record<string, string> = {
      ...blockDataAttrs(node),
      'data-question-id': node.attrs.questionId as string,
      'data-asked-by': node.attrs.askedBy as string,
      'data-status': node.attrs.status as string,
    };
    const resolution = node.attrs.resolution as string | null;
    if (resolution) attrs['data-resolution'] = resolution;
    const objectiveId = node.attrs.objectiveId as string | null;
    if (objectiveId) attrs['data-objective-id'] = objectiveId;
    const cardId = node.attrs.cardId as string | null;
    if (cardId) attrs['data-card-id'] = cardId;
    const maxNote = node.attrs.maxNote as string | null;
    if (maxNote) attrs['data-max-note'] = maxNote;
    return ['section', attrs, 0];
  },
};

/**
 * An evidentiary slide or region, shown inline as a crop of the *rendered* page (§3) — pixels,
 * not a redraw. An atom: the node names the page and the rect, and T4 rasterises it.
 */
const slide_figure: NodeSpec = {
  group: 'block',
  atom: true,
  draggable: true,
  attrs: {
    page: { default: 1 },
    rect: { default: null as Rect | null },
    caption: { default: '' },
    evidentiary: { default: true },
    ...BLOCK_ATTRS,
  },
  parseDOM: [
    {
      tag: 'figure[data-page]',
      getAttrs: (dom: AttrSource) => ({
        ...readBlockAttrs(dom),
        page: Number.parseInt(dom.getAttribute('data-page') ?? '1', 10) || 1,
        rect: parseRect(dom.getAttribute('data-rect')),
        caption: dom.getAttribute('data-caption') ?? '',
        evidentiary: dom.getAttribute('data-evidentiary') !== 'false',
      }),
    },
  ],
  toDOM: (node) => {
    const rect = node.attrs.rect as Rect | null;
    const attrs: Record<string, string> = {
      ...blockDataAttrs(node),
      'data-page': String(node.attrs.page as number),
      'data-evidentiary': String(node.attrs.evidentiary as boolean),
    };
    if (rect) attrs['data-rect'] = `${rect.x0},${rect.y0},${rect.x1},${rect.y1}`;
    const caption = node.attrs.caption as string;
    if (caption) attrs['data-caption'] = caption;
    return ['figure', attrs];
  },
};

/**
 * **A slide, or a crop of one, inside a line of text** (2026-10-03), placed as Word places an image
 * "in line with text": the caret stands on either side of it, Backspace after it deletes it,
 * Backspace before it at the start of a line joins the line to the one above (taking the image
 * with it), it is dragged to any text position, and a selection across it cuts, copies and pastes
 * it with the words. `slide_figure`, a block between paragraphs, could do none of that.
 *
 * `width` is its displayed width in CSS px at 100 % zoom, set by its corner handles (the height
 * follows the crop's shape); null fits the column. `rect` is the crop of the page, as on a figure.
 * The paragraph around it carries the block id and the provenance, so an agent still addresses it
 * as a block and its chip still cites its page (`inlineFigures`).
 */
const slide_image: NodeSpec = {
  inline: true,
  group: 'inline',
  atom: true,
  draggable: true,
  selectable: true,
  attrs: {
    page: { default: 1 },
    rect: { default: null as Rect | null },
    width: { default: null as number | null },
    caption: { default: '' },
  },
  parseDOM: [
    {
      tag: 'span[data-slide-page]',
      getAttrs: (dom: AttrSource) => {
        const width = Number.parseInt(dom.getAttribute('data-width') ?? '', 10);
        return {
          page: Number.parseInt(dom.getAttribute('data-slide-page') ?? '1', 10) || 1,
          rect: parseRect(dom.getAttribute('data-rect')),
          width: Number.isFinite(width) && width > 0 ? width : null,
          caption: dom.getAttribute('data-caption') ?? '',
        };
      },
    },
  ],
  toDOM: (node) => {
    const rect = node.attrs.rect as Rect | null;
    const attrs: Record<string, string> = { class: 'nd-img', 'data-slide-page': String(node.attrs.page as number) };
    if (rect) attrs['data-rect'] = `${rect.x0},${rect.y0},${rect.x1},${rect.y1}`;
    if (typeof node.attrs.width === 'number') attrs['data-width'] = String(node.attrs.width);
    if (node.attrs.caption) attrs['data-caption'] = node.attrs.caption as string;
    return ['span', attrs];
  },
};

// ── a tutorial sheet's parts (2026-10-03, docs/research/tutorials.md) ───────────────────────────

/** JSON in a `data-*` attribute, read back leniently: a pasted fragment with a bad one keeps its text. */
function readJsonAttr<T>(dom: AttrSource, name: string, fallback: T): T {
  const raw = dom.getAttribute(name);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * **One part of a tutorial sheet** (`tutorials.md` §3): the sheet's words for one sub-question
 * ("Problem 3 A) i."), then the learner's slot for the answer. A container, as a `q_block` is: the
 * prompt's paragraphs and the slot are blocks in their own right, so a hint line Max writes lands
 * under the slot by block id and the learner-text guard sees the slot as the learner's.
 *
 * `partId` is the sheet's own address for the part (`P3A.i`), stable across a re-read; `label` is
 * how the chips and the chat name it. The hidden key and the attempt record live in main
 * (`tutorial_parts`), never here: everything in a document reaches the renderer and the clipboard.
 */
const tut_part: NodeSpec = {
  content: 'block+',
  group: 'block',
  defining: true,
  isolating: true,
  attrs: {
    partId: { default: '' },
    label: { default: '' },
    answerKind: { default: 'text' as TutorialAnswerKind },
    /** `sheet` for the tutorial's own questions; `generated` is reserved for practice the app adds. */
    origin: { default: 'sheet' as TutorialPartOrigin },
    ...BLOCK_ATTRS,
  },
  parseDOM: [
    {
      tag: 'section[data-tut-part]',
      getAttrs: (dom: AttrSource) => ({
        ...readBlockAttrs(dom),
        partId: dom.getAttribute('data-tut-part') ?? '',
        label: dom.getAttribute('data-label') ?? '',
        answerKind: dom.getAttribute('data-answer-kind') ?? 'text',
        origin: dom.getAttribute('data-origin') ?? 'sheet',
      }),
    },
  ],
  toDOM: (node) => [
    'section',
    {
      ...blockDataAttrs(node),
      'data-tut-part': node.attrs.partId as string,
      'data-label': node.attrs.label as string,
      'data-answer-kind': node.attrs.answerKind as string,
      'data-origin': node.attrs.origin as string,
    },
    0,
  ],
};

/**
 * **The learner's answer to a part**, typed, pasted, listed: a PDDL domain in a code block, a
 * search tree as a nested list, a plan as a numbered one, or an explanation in paragraphs. One
 * block, as a list is one block, so a learner sentence in it protects all of it from an agent.
 */
const tut_answer: NodeSpec = {
  content: 'block+',
  group: 'block',
  defining: true,
  isolating: true,
  attrs: {
    answerKind: { default: 'text' as TutorialAnswerKind },
    ...BLOCK_ATTRS,
  },
  parseDOM: [
    {
      tag: 'div[data-tut-answer]',
      getAttrs: (dom: AttrSource) => ({ ...readBlockAttrs(dom), answerKind: dom.getAttribute('data-tut-answer') || 'text' }),
    },
  ],
  toDOM: (node) => ['div', { ...blockDataAttrs(node), 'data-tut-answer': node.attrs.answerKind as string }, 0],
};

/**
 * **A blank in the sheet's own words**: `Effect: ____` becomes a field the learner types into, in
 * the line where the sheet put it. An inline atom whose `value` is the answer, so the sheet's
 * words around it cannot be typed into by accident and the blank is never split by a keystroke.
 */
const tut_blank: NodeSpec = {
  inline: true,
  group: 'inline',
  atom: true,
  selectable: false,
  attrs: {
    blankId: { default: '' },
    value: { default: '' },
  },
  leafText: (node) => blankText(node.attrs.value as string),
  parseDOM: [
    {
      tag: 'span[data-tut-blank]',
      getAttrs: (dom: AttrSource) => ({
        blankId: dom.getAttribute('data-tut-blank') ?? '',
        value: dom.getAttribute('data-value') ?? '',
      }),
    },
  ],
  toDOM: (node) => [
    'span',
    { class: 'nd-tut-blank', 'data-tut-blank': node.attrs.blankId as string, 'data-value': node.attrs.value as string },
    blankText(node.attrs.value as string),
  ],
};

/** A blank as text: its answer in brackets, or a rule the width of a short answer. */
export function blankText(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? `[${trimmed}]` : '[____]';
}

/**
 * **"Choose all that apply"**: the sheet's options, each with a tick box. An atom, because the
 * options are the sheet's words and the ticks are the learner's answer; `picked` is the option ids
 * ticked, in the order the sheet lists them.
 */
const tut_choices: NodeSpec = {
  group: 'block',
  atom: true,
  selectable: true,
  attrs: {
    multi: { default: true },
    options: { default: [] as TutorialOption[] },
    picked: { default: [] as string[] },
    ...BLOCK_ATTRS,
  },
  parseDOM: [
    {
      tag: 'div[data-tut-choices]',
      getAttrs: (dom: AttrSource) => ({
        ...readBlockAttrs(dom),
        multi: dom.getAttribute('data-multi') !== 'false',
        options: readJsonAttr<TutorialOption[]>(dom, 'data-options', []),
        picked: readJsonAttr<string[]>(dom, 'data-picked', []),
      }),
    },
  ],
  toDOM: (node) => [
    'div',
    {
      ...blockDataAttrs(node),
      'data-tut-choices': '',
      'data-multi': String(node.attrs.multi as boolean),
      'data-options': JSON.stringify(node.attrs.options),
      'data-picked': JSON.stringify(node.attrs.picked),
    },
    choicesText(node),
  ],
};

/** The options on lines, ticked ones marked: what the outline, a prompt and the clipboard read. */
export function choicesText(node: Node): string {
  const options = (node.attrs.options as TutorialOption[] | null) ?? [];
  const picked = new Set((node.attrs.picked as string[] | null) ?? []);
  return options.map((o) => `${picked.has(o.id) ? '[x]' : '[ ]'} ${o.id}. ${o.text}`).join('\n');
}

/**
 * **A comparison table** (2026-10-01): Ellie fills one on request, and the learner edits it.
 *
 * One addressable block. Its rows and cells are its internals, exactly as a list's items are: they
 * carry no `blockId`, so no agent op can land on a cell and bypass the table. `isolating` so a
 * Backspace at the first cell cannot merge the table into the paragraph above it.
 *
 * The caption is an attr, not a `<caption>` child: a child would be content, and content here is
 * rows. The heading row is simply the first row, with `header` on every cell (`tableGrid`).
 */
const table: NodeSpec = {
  content: 'table_row+',
  group: 'block',
  defining: true,
  isolating: true,
  attrs: { caption: { default: null as string | null }, ...BLOCK_ATTRS },
  parseDOM: [
    {
      tag: 'table',
      getAttrs: (dom: AttrSource) => ({ ...readBlockAttrs(dom), caption: dom.getAttribute('data-caption') }),
    },
  ],
  toDOM: (node) => {
    const attrs = blockDataAttrs(node);
    const caption = node.attrs.caption as string | null;
    if (caption) attrs['data-caption'] = caption;
    return ['table', attrs, ['tbody', 0]];
  },
};

/** A row has its own `pages`: one row of a comparison often comes from a different slide. */
const table_row: NodeSpec = {
  content: 'table_cell+',
  // There is no place between two cells to stand: a gap cursor there is a caret the learner
  // cannot see, and typing at it would need a cell that does not exist.
  allowGapCursor: false,
  attrs: { pages: { default: [] as number[] } },
  parseDOM: [{ tag: 'tr', getAttrs: (dom: AttrSource) => ({ pages: readPages(dom) }) }],
  toDOM: (node) => {
    const pages = childPages(node);
    return ['tr', pages.length > 0 ? { 'data-pages': pages.join(',') } : {}, 0];
  },
};

/**
 * `inline*`, so a cell's text wears the author mark like any other text and what the learner types
 * in a cell is theirs (§5.4). `isolating` keeps an editing gesture inside the cell it started in.
 */
const table_cell: NodeSpec = {
  content: 'inline*',
  isolating: true,
  attrs: { header: { default: false } },
  parseDOM: [
    { tag: 'td', getAttrs: () => ({ header: false }) },
    { tag: 'th', getAttrs: () => ({ header: true }) },
  ],
  toDOM: (node) => [(node.attrs.header as boolean) ? 'th' : 'td', 0],
};

export const DIAGRAM_LAYOUTS: readonly DiagramLayout[] = ['flow', 'hierarchy', 'compare', 'cycle'];

export function isDiagramLayout(value: unknown): value is DiagramLayout {
  return typeof value === 'string' && (DIAGRAM_LAYOUTS as readonly string[]).includes(value);
}

/** Edges as they are trusted: from an attr, from `data-edges`, or from a draft. Never throws. */
function asEdges(value: unknown): DiagramEdge[] {
  if (!Array.isArray(value)) return [];
  const edges: DiagramEdge[] = [];
  for (const raw of value as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const edge = raw as { from?: unknown; to?: unknown; label?: unknown };
    if (typeof edge.from !== 'string' || typeof edge.to !== 'string') continue;
    edges.push({
      from: edge.from,
      to: edge.to,
      label: typeof edge.label === 'string' && edge.label.length > 0 ? edge.label : null,
    });
  }
  return edges;
}

function parseEdges(value: string | null): DiagramEdge[] {
  if (!value) return [];
  try {
    return asEdges(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

/**
 * **An editable diagram** (2026-10-01): an infographic whose labels are real text.
 *
 * The node says *what* is in the picture — the labelled nodes, and the edges between them by
 * `nodeId` — and the renderer lays it out in code from `layout`. Nothing here is a coordinate, so
 * a label the learner rewrites reflows instead of overflowing a box somebody drew.
 *
 * One addressable block, like the table. The edges are an attr rather than nodes because an edge
 * has no text of its own to author beyond a short label, and the title is an attr for the reason
 * the table's caption is.
 */
const diagram: NodeSpec = {
  content: 'diagram_node+',
  group: 'block',
  defining: true,
  isolating: true,
  attrs: {
    layout: { default: 'flow' as DiagramLayout },
    title: { default: null as string | null },
    edges: { default: [] as DiagramEdge[] },
    ...BLOCK_ATTRS,
  },
  parseDOM: [
    {
      tag: 'figure[data-diagram]',
      getAttrs: (dom: AttrSource) => {
        const layout = dom.getAttribute('data-layout');
        return {
          ...readBlockAttrs(dom),
          layout: isDiagramLayout(layout) ? layout : 'flow',
          title: dom.getAttribute('data-title'),
          edges: parseEdges(dom.getAttribute('data-edges')),
        };
      },
    },
  ],
  toDOM: (node) => {
    const attrs: Record<string, string> = {
      ...blockDataAttrs(node),
      'data-diagram': '',
      'data-layout': node.attrs.layout as string,
      'data-edges': JSON.stringify(asEdges(node.attrs.edges)),
    };
    const title = node.attrs.title as string | null;
    if (title) attrs['data-title'] = title;
    return ['figure', attrs, 0];
  },
};

/**
 * One node of a diagram. The label is its inline content, authored span by span; `nodeId` is what
 * edges and `parent` name, and is local to the diagram (it is not a `blockId`, and nothing outside
 * the diagram resolves it). `parent` is read by the `hierarchy` layout and `group` — the column
 * heading the node sits under — by `compare`.
 */
const diagram_node: NodeSpec = {
  content: 'inline*',
  isolating: true,
  attrs: {
    nodeId: { default: '' },
    parent: { default: null as string | null },
    group: { default: null as string | null },
    pages: { default: [] as number[] },
    reason: { default: null as string | null },
  },
  parseDOM: [
    {
      tag: 'div[data-diagram-node]',
      getAttrs: (dom: AttrSource) => ({
        nodeId: dom.getAttribute('data-node-id') ?? '',
        parent: dom.getAttribute('data-parent'),
        group: dom.getAttribute('data-group'),
        pages: readPages(dom),
        reason: dom.getAttribute('data-reason'),
      }),
    },
  ],
  toDOM: (node) => {
    const attrs: Record<string, string> = {
      'data-diagram-node': '',
      'data-node-id': node.attrs.nodeId as string,
    };
    const parent = node.attrs.parent as string | null;
    if (parent) attrs['data-parent'] = parent;
    const group = node.attrs.group as string | null;
    if (group) attrs['data-group'] = group;
    const pages = childPages(node);
    if (pages.length > 0) attrs['data-pages'] = pages.join(',');
    const reason = node.attrs.reason as string | null;
    if (reason) attrs['data-reason'] = reason;
    return ['div', attrs, 0];
  },
};

/** The `pages` of a row or a diagram node, copied. */
function childPages(node: Node): number[] {
  const pages = (node.attrs as { pages?: unknown }).pages;
  return Array.isArray(pages) ? [...(pages as number[])] : [];
}

// ── concept cards (2026-10-06; notebooks.md §11.2, decision D1) ──────────────────────

/**
 * **A concept card**: one idea of the lecture, as notes that can stand in for its slides.
 *
 * The first child is the **core line**, an ordinary paragraph: the term in bold and a one-sentence
 * definition, always visible. Every child after it is a **depth item** (`concept_item`), folded
 * under the core line and opened in place. Folding is view state (`pm/concept.ts`), never saved:
 * the document holds all of the card, so the outline, the search index and every agent see it
 * whole whether or not the learner has opened it.
 *
 * A container, as a `q_block` is, so every block in a card keeps its own `blockId`, provenance and
 * author marks: the guard, the chips and the ops work on a card's paragraphs and formulas exactly
 * as on any other. `isolating` keeps an editing gesture from merging the card into the prose
 * around it. `term` is the card's name for the outline, the search index and anything that has to
 * say which card it means (`cardOf`).
 */
const concept: NodeSpec = {
  content: 'paragraph concept_item*',
  group: 'card',
  defining: true,
  isolating: true,
  attrs: { term: { default: '' }, ...BLOCK_ATTRS },
  parseDOM: [
    {
      tag: 'section[data-concept]',
      getAttrs: (dom: AttrSource) => ({ ...readBlockAttrs(dom), term: dom.getAttribute('data-term') ?? '' }),
    },
  ],
  toDOM: (node) => [
    'section',
    { ...blockDataAttrs(node), 'data-concept': '', 'data-term': node.attrs.term as string },
    0,
  ],
};

export function isConceptRole(value: unknown): value is ConceptRole {
  return typeof value === 'string' && (CONCEPT_ROLES as readonly string[]).includes(value);
}

/**
 * **One item of a card's depth**: intuition, an equation and its "where" list, an algorithm's
 * steps, an example, a table, a figure, a result, a pitfall or a note (`ConceptRole`). `block+`,
 * so an equation item is a formula block and a list, and an agent's addition to an item is one
 * more block in it. A container: its blocks are addressable in their own right.
 */
const concept_item: NodeSpec = {
  content: 'block+',
  defining: true,
  isolating: true,
  attrs: { role: { default: 'note' as ConceptRole }, ...BLOCK_ATTRS },
  parseDOM: [
    {
      tag: 'div[data-concept-item]',
      getAttrs: (dom: AttrSource) => {
        const role = dom.getAttribute('data-concept-item');
        return { ...readBlockAttrs(dom), role: isConceptRole(role) ? role : 'note' };
      },
    },
  ],
  toDOM: (node) => ['div', { ...blockDataAttrs(node), 'data-concept-item': node.attrs.role as string }, 0],
};

// ── flashcards, a quiz, an infographic (2026-10-01; notebooks §5.3) ─────────────────────────
//
// All three follow the diagram: one addressable block (`BLOCK_ATTRS`, in `STRUCTURED`), children
// that carry **no** `blockId` but their own `pages`, and every word an inline field, authored span
// by span. The block says *what* is in it; the renderer decides how it looks (`pm/flashcards.ts`,
// `pm/quiz.ts`, `pm/infographic.ts`), and whether the back of a card or the answer of a question
// is showing is view chrome that is never saved. Nothing here is an image (C9).

export const INFOGRAPHIC_LAYOUTS: readonly InfographicLayout[] = ['timeline', 'steps', 'stats', 'compare'];

export function isInfographicLayout(value: unknown): value is InfographicLayout {
  return typeof value === 'string' && (INFOGRAPHIC_LAYOUTS as readonly string[]).includes(value);
}

/** `A`, `B`, … for the n-th option (0-based): what the quiz's buttons and its read-aloud both say. */
export function optionLabel(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}

export function isQuizQuestionType(value: unknown): value is QuizQuestionType {
  return value === 'mc' || value === 'short';
}

/** The block's own `title` attr, as the table's caption and the diagram's title are. */
function titleDom(node: Node, attrs: Record<string, string>): Record<string, string> {
  const title = node.attrs.title as string | null;
  if (title) attrs['data-title'] = title;
  return attrs;
}

/** A node whose content is one run of inline text and which says only *which field* it is. */
function fieldSpec(marker: string): NodeSpec {
  return {
    content: 'inline*',
    isolating: true,
    parseDOM: [{ tag: `div[${marker}]` }],
    toDOM: () => ['div', { [marker]: '' }, 0],
  };
}

/** The `pages` (and reason) a child of one of these blocks carries, round-tripped through the DOM. */
function childAttrsFrom(dom: AttrSource): Record<string, unknown> {
  return { pages: readPages(dom), reason: dom.getAttribute('data-reason') };
}

function childDomAttrs(node: Node, marker: string): Record<string, string> {
  const attrs: Record<string, string> = { [marker]: '' };
  const pages = childPages(node);
  if (pages.length > 0) attrs['data-pages'] = pages.join(',');
  const reason = node.attrs.reason as string | null;
  if (reason) attrs['data-reason'] = reason;
  return attrs;
}

const CHILD_ATTRS = { pages: { default: [] as number[] }, reason: { default: null as string | null } };

/** A deck of cards, each a front and a back. */
const flashcards: NodeSpec = {
  content: 'flashcard+',
  group: 'block',
  defining: true,
  isolating: true,
  attrs: { title: { default: null as string | null }, ...BLOCK_ATTRS },
  parseDOM: [
    {
      tag: 'section[data-flashcards]',
      getAttrs: (dom: AttrSource) => ({ ...readBlockAttrs(dom), title: dom.getAttribute('data-title') }),
    },
  ],
  toDOM: (node) => ['section', titleDom(node, { ...blockDataAttrs(node), 'data-flashcards': '' }), 0],
};

const flashcard: NodeSpec = {
  content: 'flashcard_front flashcard_back',
  isolating: true,
  attrs: { ...CHILD_ATTRS },
  parseDOM: [{ tag: 'div[data-flashcard]', getAttrs: (dom: AttrSource) => childAttrsFrom(dom) }],
  toDOM: (node) => ['div', childDomAttrs(node, 'data-flashcard'), 0],
};

/** A quiz: questions, each a prompt, options (multiple choice only) and the answer with its why. */
const quiz: NodeSpec = {
  content: 'quiz_question+',
  group: 'block',
  defining: true,
  isolating: true,
  attrs: { title: { default: null as string | null }, ...BLOCK_ATTRS },
  parseDOM: [
    {
      tag: 'section[data-quiz]',
      getAttrs: (dom: AttrSource) => ({ ...readBlockAttrs(dom), title: dom.getAttribute('data-title') }),
    },
  ],
  toDOM: (node) => ['section', titleDom(node, { ...blockDataAttrs(node), 'data-quiz': '' }), 0],
};

const quiz_question: NodeSpec = {
  content: 'quiz_prompt quiz_option* quiz_explain',
  isolating: true,
  attrs: { qtype: { default: 'mc' as QuizQuestionType }, ...CHILD_ATTRS },
  parseDOM: [
    {
      tag: 'div[data-quiz-question]',
      getAttrs: (dom: AttrSource) => {
        const qtype = dom.getAttribute('data-qtype');
        return { ...childAttrsFrom(dom), qtype: isQuizQuestionType(qtype) ? qtype : 'mc' };
      },
    },
  ],
  toDOM: (node) => ['div', { ...childDomAttrs(node, 'data-quiz-question'), 'data-qtype': node.attrs.qtype as string }, 0],
};

/** One choice. `correct` is the author's key to it: exactly one per multiple-choice question. */
const quiz_option: NodeSpec = {
  content: 'inline*',
  isolating: true,
  attrs: { correct: { default: false } },
  parseDOM: [{ tag: 'div[data-quiz-option]', getAttrs: (dom: AttrSource) => ({ correct: dom.getAttribute('data-correct') === 'true' }) }],
  toDOM: (node) => ['div', { 'data-quiz-option': '', 'data-correct': String(node.attrs.correct === true) }, 0],
};

/** A set of panels (timeline stops, steps, stats, columns), laid out by code from `layout`. */
const infographic: NodeSpec = {
  content: 'info_panel+',
  group: 'block',
  defining: true,
  isolating: true,
  attrs: {
    layout: { default: 'steps' as InfographicLayout },
    title: { default: null as string | null },
    ...BLOCK_ATTRS,
  },
  parseDOM: [
    {
      tag: 'section[data-infographic]',
      getAttrs: (dom: AttrSource) => {
        const layout = dom.getAttribute('data-layout');
        return {
          ...readBlockAttrs(dom),
          layout: isInfographicLayout(layout) ? layout : 'steps',
          title: dom.getAttribute('data-title'),
        };
      },
    },
  ],
  toDOM: (node) => [
    'section',
    titleDom(node, { ...blockDataAttrs(node), 'data-infographic': '', 'data-layout': node.attrs.layout as string }),
    0,
  ],
};

/** `info_value` is always present and may be empty: the big number or year of a stat or a stop. */
const info_panel: NodeSpec = {
  content: 'info_value info_heading info_body',
  isolating: true,
  attrs: { ...CHILD_ATTRS },
  parseDOM: [{ tag: 'div[data-info-panel]', getAttrs: (dom: AttrSource) => childAttrsFrom(dom) }],
  toDOM: (node) => ['div', childDomAttrs(node, 'data-info-panel'), 0],
};

/** The nodes of the three blocks that are plain inline fields, by name. */
const FIELD_MARKERS = {
  flashcard_front: 'data-flashcard-front',
  flashcard_back: 'data-flashcard-back',
  quiz_prompt: 'data-quiz-prompt',
  quiz_explain: 'data-quiz-explain',
  info_value: 'data-info-value',
  info_heading: 'data-info-heading',
  info_body: 'data-info-body',
} as const;

/** The top-level blocks that are a set of items, each item a fixed run of inline fields. */
export const ITEM_BLOCKS = { flashcards: 'flashcard', quiz: 'quiz_question', infographic: 'info_panel' } as const;


function parseRect(value: string | null): Rect | null {
  if (!value) return null;
  const parts = value.split(',').map((n) => Number.parseFloat(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return { x0: parts[0]!, y0: parts[1]!, x1: parts[2]!, y1: parts[3]! };
}

// ── marks ───────────────────────────────────────────────────────────────────────────────────

const strong: MarkSpec = {
  parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
  toDOM: () => ['strong', 0],
};

const em: MarkSpec = {
  parseDOM: [{ tag: 'em' }, { tag: 'i' }],
  toDOM: () => ['em', 0],
};

const code: MarkSpec = {
  parseDOM: [{ tag: 'code' }],
  toDOM: () => ['code', 0],
};

/** Inline maths: the mark's `tex` is the source, the text it wraps is the fallback rendering. */
const math_inline: MarkSpec = {
  attrs: { tex: { default: '' } },
  inclusive: false,
  parseDOM: [
    { tag: 'span[data-tex]', getAttrs: (dom: AttrSource) => ({ tex: dom.getAttribute('data-tex') ?? '' }) },
  ],
  toDOM: (mark) => ['span', { 'data-tex': mark.attrs.tex as string, class: 'math-inline' }, 0],
};

/**
 * **The author mark — the whole safety argument of §5.4 in one attr.**
 *
 * On *every* text span. `by` is who typed the characters; `editId` is the agent edit they came
 * in on, and it is what Remove · Keep acts on — `keepEdit` clears it and the colour goes with
 * it, because the renderer colours on `[data-edit-id]`, not on `[data-author]`.
 *
 * `inclusive: false` is load-bearing: with the default, a learner typing at the end of Ellie's
 * sentence would inherit Ellie's mark and their own words would stop counting as theirs (§6),
 * and worse, the guard would stop protecting them. With it off, text typed at a span boundary
 * carries no author mark at all — which is why T4 must stamp `author{by:'user'}` on every
 * learner insertion from a plugin rather than leaning on mark inheritance.
 *
 * Two adjacent spans by different authors, or by the same author on different edits, never merge
 * into one: ProseMirror joins adjacent text nodes only when their mark sets compare equal, and
 * these marks compare by attrs.
 */
const author: MarkSpec = {
  attrs: {
    by: { default: 'ingest' },
    editId: { default: null as string | null },
    at: { default: 0 },
  },
  inclusive: false,
  parseDOM: [
    {
      tag: 'span[data-author]',
      getAttrs: (dom: AttrSource) => ({
        by: dom.getAttribute('data-author') ?? 'ingest',
        editId: dom.getAttribute('data-edit-id'),
        at: Number.parseInt(dom.getAttribute('data-at') ?? '0', 10) || 0,
      }),
    },
  ],
  toDOM: (mark) => {
    const attrs: Record<string, string> = { 'data-author': mark.attrs.by as string };
    const editId = mark.attrs.editId as string | null;
    // Omitted rather than emptied when there is no edit: `[data-edit-id]` is the CSS hook for
    // "this text still wears its colour", and `keepEdit` drops the attribute by nulling it.
    if (editId) attrs['data-edit-id'] = editId;
    const at = mark.attrs.at as number;
    if (at) attrs['data-at'] = String(at);
    return ['span', attrs, 0];
  },
};

function suggestMark(kind: 'ins' | 'del'): MarkSpec {
  return {
    attrs: { suggestionId: { default: '' }, by: { default: 'max' } },
    inclusive: false,
    parseDOM: [
      {
        tag: `span[data-suggest="${kind}"]`,
        getAttrs: (dom: AttrSource) => ({
          suggestionId: dom.getAttribute('data-suggestion-id') ?? '',
          by: dom.getAttribute('data-by') ?? 'max',
        }),
      },
    ],
    toDOM: (mark) => [
      'span',
      {
        'data-suggest': kind,
        'data-suggestion-id': mark.attrs.suggestionId as string,
        'data-by': mark.attrs.by as string,
      },
      0,
    ],
  };
}

/**
 * The notes schema. Node and mark order matters in one place only: `author` must be able to
 * coexist with every other mark, which it does — nothing here declares `excludes`.
 */
export const notesSchema = new Schema({
  nodes: {
    doc,
    paragraph,
    heading,
    bullet_list,
    ordered_list,
    list_item,
    code_block,
    math_block,
    q_block,
    slide_figure,
    slide_image,
    tut_part,
    tut_answer,
    tut_blank,
    tut_choices,
    table,
    table_row,
    table_cell,
    diagram,
    diagram_node,
    flashcards,
    flashcard,
    flashcard_front: fieldSpec(FIELD_MARKERS.flashcard_front),
    flashcard_back: fieldSpec(FIELD_MARKERS.flashcard_back),
    quiz,
    quiz_question,
    quiz_prompt: fieldSpec(FIELD_MARKERS.quiz_prompt),
    quiz_option,
    quiz_explain: fieldSpec(FIELD_MARKERS.quiz_explain),
    infographic,
    info_panel,
    info_value: fieldSpec(FIELD_MARKERS.info_value),
    info_heading: fieldSpec(FIELD_MARKERS.info_heading),
    info_body: fieldSpec(FIELD_MARKERS.info_body),
    concept,
    concept_item,
    text,
  },
  marks: {
    strong,
    em,
    code,
    math_inline,
    author,
    suggest_ins: suggestMark('ins'),
    suggest_del: suggestMark('del'),
  },
});

// ── walking the document ────────────────────────────────────────────────────────────────────

/**
 * The block-level nodes an agent may address: the top level, plus the children of a `q_block`
 * (the question paragraph and Max's resolution live inside one and are addressable in their own
 * right). A list is *one* block — its `list_item`s and their paragraphs are its internals, not
 * separate blocks, because an agent op that landed on a bullet's paragraph would be an op that
 * bypassed the list. A `table` and a `diagram` are one block each for the same reason.
 *
 * A concept card and its depth items are containers too (2026-10-06): the card, its core line,
 * each item and each block inside an item are all addressable, so an agent can extend one item or
 * replace one formula without touching the rest of the card.
 */
const CONTAINERS = new Set(['q_block', 'tut_part', 'concept', 'concept_item']);

/**
 * The blocks that are one addressable unit with structure inside: a `table` and a `diagram`. They
 * are deliberately *not* containers. Rows, cells and diagram nodes carry no `blockId`, `eachBlock`
 * does not descend into them, and the text in them is reported against the table or the diagram —
 * which is what makes one learner-typed cell protect the whole block from an agent's replace.
 */
const STRUCTURED = new Set(['table', 'diagram', 'flashcards', 'quiz', 'infographic']);

export function isStructuredBlock(node: Node): boolean {
  return STRUCTURED.has(node.type.name);
}

// ── reading a table and a diagram back ──────────────────────────────────────────────────────

/**
 * A `table` node as a grid of plain text. `columns` is the first row when every cell in it is a
 * header cell, and `rows` is everything after it; a table with no heading row has `columns: []`.
 */
export function tableGrid(node: Node): TableGrid {
  const all: { header: boolean; cells: string[] }[] = [];
  node.forEach((row) => {
    const cells: string[] = [];
    let header = row.childCount > 0;
    row.forEach((cell) => {
      cells.push(cell.textContent);
      if (!(cell.attrs.header as boolean)) header = false;
    });
    all.push({ header, cells });
  });
  const headed = all.length > 0 && all[0]!.header;
  return {
    caption: (node.attrs.caption as string | null) || null,
    columns: headed ? all[0]!.cells : [],
    rows: (headed ? all.slice(1) : all).map((row) => row.cells),
  };
}

/** A `diagram` node as the renderer's layout input: plain-text labels, and the edges by id. */
export function diagramSpec(node: Node): DiagramSpec {
  const nodes: DiagramSpec['nodes'] = [];
  node.forEach((child) => {
    nodes.push({
      id: child.attrs.nodeId as string,
      label: child.textContent,
      parent: (child.attrs.parent as string | null) || null,
      group: (child.attrs.group as string | null) || null,
      pages: childPages(child),
    });
  });
  const layout = node.attrs.layout as unknown;
  return {
    layout: isDiagramLayout(layout) ? layout : 'flow',
    title: (node.attrs.title as string | null) || null,
    nodes,
    edges: asEdges(node.attrs.edges),
  };
}


/** A `flashcards` node as plain text: each card's two sides, and its own pages. */
export function flashcardsSpec(node: Node): FlashcardsSpec {
  const cards: FlashcardsSpec['cards'] = [];
  node.forEach((card) => {
    cards.push({
      front: card.firstChild?.textContent ?? '',
      back: card.lastChild?.textContent ?? '',
      pages: childPages(card),
    });
  });
  return { title: (node.attrs.title as string | null) || null, cards };
}

/**
 * A `quiz` node as plain text. `correct` is the index of the option marked correct (the first,
 * should a hand-edit have marked several), and null for a short-answer question or an unmarked one.
 */
export function quizSpec(node: Node): QuizSpec {
  const questions: QuizSpec['questions'] = [];
  node.forEach((question) => {
    const options: string[] = [];
    let correct: number | null = null;
    question.forEach((child) => {
      if (child.type.name !== 'quiz_option') return;
      if (child.attrs.correct === true && correct === null) correct = options.length;
      options.push(child.textContent);
    });
    const qtype = question.attrs.qtype as unknown;
    questions.push({
      type: options.length > 0 && qtype !== 'short' ? 'mc' : 'short',
      prompt: question.firstChild?.textContent ?? '',
      options,
      correct,
      explain: question.lastChild?.textContent ?? '',
      pages: childPages(question),
    });
  });
  return { title: (node.attrs.title as string | null) || null, questions };
}

/** An `infographic` node as plain text: its layout, and each panel's value, heading and body. */
export function infographicSpec(node: Node): InfographicSpec {
  const panels: InfographicSpec['panels'] = [];
  node.forEach((panel) => {
    panels.push({
      value: panel.child(0).textContent,
      heading: panel.child(1).textContent,
      body: panel.child(2).textContent,
      pages: childPages(panel),
    });
  });
  const layout = node.attrs.layout as unknown;
  return {
    layout: isInfographicLayout(layout) ? layout : 'steps',
    title: (node.attrs.title as string | null) || null,
    panels,
  };
}

/**
 * The pages a block came from, **including its rows' or its nodes' own**. For every other block
 * this is `blockAttrs(node).pages`; a table or a diagram can cite a page on one row only, and the
 * objective bar and the outline must still find the block from that page.
 */
export function blockPages(node: Node): number[] {
  const pages = blockAttrs(node).pages;
  if (!STRUCTURED.has(node.type.name)) return pages;
  node.forEach((child) => {
    for (const page of childPages(child)) if (!pages.includes(page)) pages.push(page);
  });
  return pages;
}

/**
 * True for a block whose *text* belongs to its children rather than to it: a `q_block`, and a
 * tutorial's `tut_part`. Anything that scans the document span by span has to skip these, or every run
 * inside a Q block would be reported twice: once for the child that holds it and once for the
 * container that contains the child.
 */
export function isContainerBlock(node: Node): boolean {
  return CONTAINERS.has(node.type.name);
}

export function eachBlock(doc: Node, visit: (node: Node, pos: number, depth: number) => void): void {
  const walk = (fragment: Fragment, base: number, depth: number): void => {
    fragment.forEach((node, offset) => {
      if (!node.isBlock) return;
      const pos = base + offset;
      visit(node, pos, depth);
      if (CONTAINERS.has(node.type.name)) walk(node.content, pos + 1, depth + 1);
    });
  };
  walk(doc.content, 0, 0);
}

/**
 * Where a block is. Scans everything (including list internals) so the renderer can locate any
 * node it has an id for; an empty id never matches, because "" is "not yet minted", not a name.
 */
export function blockPos(doc: Node, blockId: string): { pos: number; node: Node } | null {
  if (!blockId) return null;
  let found: { pos: number; node: Node } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.isBlock && (node.attrs as { blockId?: string }).blockId === blockId) {
      found = { pos, node };
      return false;
    }
    return true;
  });
  return found;
}

// ── concept cards: which card a block is in (2026-10-06, D1) ────────────────────────────────

export function isConcept(node: Node): boolean {
  return node.type.name === 'concept';
}

/** A card's always-visible line: its first child, the paragraph with the term in bold. */
export function conceptCore(card: Node): Node | null {
  return isConcept(card) && card.firstChild?.type.name === 'paragraph' ? card.firstChild : null;
}

/** A card's depth items, in order, with where each starts relative to the card's content. */
export function conceptItems(card: Node): { role: ConceptRole; node: Node; offset: number }[] {
  const items: { role: ConceptRole; node: Node; offset: number }[] = [];
  if (!isConcept(card)) return items;
  card.forEach((child, offset) => {
    if (child.type.name !== 'concept_item') return;
    const role = child.attrs.role as unknown;
    items.push({ role: isConceptRole(role) ? role : 'note', node: child, offset });
  });
  return items;
}

export interface CardRef {
  /** The card's position in the document and the card itself. */
  pos: number;
  node: Node;
  cardId: string;
  term: string;
  /** The depth item the block is in (or is), when it is in one; null for the card and its core. */
  item: { pos: number; node: Node; role: ConceptRole } | null;
  /** True when the block asked about is the card's core line. */
  isCore: boolean;
}

/**
 * **The card a block belongs to**: the card itself, its core line, one of its depth items, or any
 * block inside an item. Null for a block outside every card, and for an unknown id.
 *
 * This is the one way to address "the card this block is in" (for Ellie's additions, which attach
 * to the card's depth, and for anything that is placed *under* a card rather than inside it, such
 * as a self-check: `insert_after` with the card's `cardId` as the anchor puts it straight after the
 * card at the top level).
 */
export function cardOf(doc: Node, blockId: string): CardRef | null {
  const at = blockPos(doc, blockId);
  if (!at) return null;
  const $pos = doc.resolve(at.pos);
  // The card is the top-level ancestor (cards only stand at the top level), or the block itself.
  const card = $pos.depth === 0 ? at.node : $pos.node(1);
  const cardPos = $pos.depth === 0 ? at.pos : $pos.before(1);
  if (!isConcept(card)) return null;
  let item: CardRef['item'] = null;
  if (at.node.type.name === 'concept_item') {
    item = { pos: at.pos, node: at.node, role: isConceptRole(at.node.attrs.role) ? at.node.attrs.role : 'note' };
  } else if ($pos.depth >= 2 && $pos.node(2).type.name === 'concept_item') {
    const node = $pos.node(2);
    item = { pos: $pos.before(2), node, role: isConceptRole(node.attrs.role) ? node.attrs.role : 'note' };
  }
  const core = conceptCore(card);
  return {
    pos: cardPos,
    node: card,
    cardId: blockAttrs(card).blockId,
    term: (card.attrs.term as string) || '',
    item,
    isCore: core !== null && $pos.depth === 1 && $pos.index(1) === 0 && at.node === core,
  };
}

/** The `blockId` of the card a block belongs to, or null (`cardOf`). */
export function cardIdOf(doc: Node, blockId: string): string | null {
  return cardOf(doc, blockId)?.cardId ?? null;
}

/**
 * **The concept card a question is about** (6 Oct afternoon, decision 9 on #67): the Q block's own
 * `cardId`, set when it went in under a card. A block written before that attribute existed stood
 * straight after its card (`insert_q` puts it there, newest first), so it falls back to the card
 * just above the run of Q blocks it stands in. Null for a question about no card, and for one
 * whose Q block is gone.
 */
export function questionCardId(doc: Node, questionId: string): string | null {
  if (!questionId) return null;
  let found: string | null = null;
  let previous: Node | null = null;
  let viaPrevious: Node | null = null;
  let done = false;
  doc.forEach((node) => {
    if (done) return;
    if (node.type.name === 'q_block' && node.attrs.questionId === questionId) {
      done = true;
      const own = node.attrs.cardId as string | null;
      if (own) found = own;
      else viaPrevious = previous;
      return;
    }
    // A run of Q blocks under a card keeps pointing at the card.
    if (node.type.name !== 'q_block') previous = node;
  });
  if (found !== null) return found;
  const card = viaPrevious as Node | null;
  return card !== null && isConcept(card) ? blockAttrs(card).blockId || null : null;
}

/** Every card in the document, in order: its id, term and position. */
export function conceptCards(doc: Node): { cardId: string; term: string; pos: number; node: Node }[] {
  const out: { cardId: string; term: string; pos: number; node: Node }[] = [];
  doc.forEach((node, pos) => {
    if (isConcept(node)) out.push({ cardId: blockAttrs(node).blockId, term: (node.attrs.term as string) || '', pos, node });
  });
  return out;
}

/** Every text run in a node, with absolute document positions. Atoms contribute nothing. */
export function textRuns(node: Node, base: number): { from: number; to: number; text: string; marks: readonly Mark[] }[] {
  const runs: { from: number; to: number; text: string; marks: readonly Mark[] }[] = [];
  node.descendants((child, offset) => {
    if (!child.isText) return true;
    const from = base + offset;
    runs.push({ from, to: from + child.nodeSize, text: child.text ?? '', marks: child.marks });
    return false;
  });
  return runs;
}

function authorOf(marks: readonly Mark[]): { by: DocAuthor; editId: string | null } | null {
  for (const mark of marks) {
    if (mark.type.name === 'author') {
      return { by: mark.attrs.by as DocAuthor, editId: (mark.attrs.editId as string | null) ?? null };
    }
  }
  return null;
}

/** True when any text inside the node was typed by the learner. The guard's basic question. */
export function hasLearnerText(node: Node): boolean {
  let learner = false;
  node.descendants((child) => {
    if (learner) return false;
    if (child.isText && authorOf(child.marks)?.by === 'user') learner = true;
    return !learner;
  });
  return learner;
}

export interface LearnerSpan {
  blockId: string;
  from: number;
  to: number;
  text: string;
}

/**
 * The learner's own writing, as contiguous runs per block, in document positions (§6: their doc
 * text is assessed as an attempt, and §5.4: it is what an agent may never overwrite).
 *
 * Runs are merged across the text-node splits that marks cause, so a learner sentence carrying a
 * `**bold**` in the middle is *one* span, which is what "at least one sentence" has to count.
 */
export function learnerSpans(doc: Node): LearnerSpan[] {
  const spans: LearnerSpan[] = [];
  eachBlock(doc, (node, pos) => {
    // A container's text belongs to its children, which are visited in their own right.
    if (CONTAINERS.has(node.type.name)) return;
    const { blockId } = blockAttrs(node);
    let open: LearnerSpan | null = null;
    for (const run of textRuns(node, pos + 1)) {
      if (authorOf(run.marks)?.by === 'user') {
        if (open && open.to === run.from) {
          open.to = run.to;
          open.text += run.text;
        } else {
          open = { blockId, from: run.from, to: run.to, text: run.text };
          spans.push(open);
        }
      } else {
        open = null;
      }
    }
  });
  return spans;
}

// ── the outline: the only view of the doc a model is given ──────────────────────────────────

/** ~24 words (the contract). A prompt gets the shape of a block, never its body. */
const OUTLINE_WORDS = 24;
/**
 * **…except a block the learner wrote in** (interviews, `findings.md` §6; #48). P2's central
 * complaint was that what he writes down is never "registered to the AI", so a block holding
 * learner-authored text reaches the prompt whole enough to be built on: the agents must answer
 * *from* the learner's notes, not past them. The cost is prompt budget only on blocks the learner
 * actually wrote in, and it is capped so a pasted essay cannot swamp a turn.
 */
const LEARNER_OUTLINE_WORDS = 160;

function truncateWords(text: string, limit = OUTLINE_WORDS): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter((w) => w.length > 0);
  if (words.length <= limit) return words.join(' ');
  return `${words.slice(0, limit).join(' ')}…`;
}

/** `[slide p. 41]` for each image in a block: an image is a citation, and the outline should say so. */
function imageMarkers(node: Node): string {
  const marks: string[] = [];
  node.descendants((child) => {
    if (child.type.name === 'slide_image') marks.push(`[slide p. ${String(child.attrs.page as number)}]`);
    return !child.isLeaf;
  });
  return marks.join(' ');
}

function outlineText(node: Node): string {
  if (node.type.name === 'slide_figure') {
    const caption = node.attrs.caption as string;
    return truncateWords(caption || `slide p. ${String(node.attrs.page as number)}`);
  }
  if (node.type.name === 'math_block') return truncateWords(node.attrs.tex as string);
  if (node.type.name === 'tut_choices') return truncateWords(choicesText(node), LEARNER_OUTLINE_WORDS);
  const limit = hasLearnerText(node) ? LEARNER_OUTLINE_WORDS : OUTLINE_WORDS;
  // A card reads as its name and its core line; its items and their blocks have lines of their own.
  if (node.type.name === 'concept') return truncateWords(conceptLine(node), limit);
  if (node.type.name === 'concept_item') {
    return truncateWords(`[${String(node.attrs.role)}] ${nodeText(node)}`, limit);
  }
  if (node.type.name === 'table') return truncateWords(tableText(node), limit);
  if (node.type.name === 'diagram') return truncateWords(diagramText(node), limit);
  if (node.type.name === 'flashcards') return truncateWords(flashcardsText(node), limit);
  if (node.type.name === 'quiz') return truncateWords(quizText(node), limit);
  if (node.type.name === 'infographic') return truncateWords(infographicText(node), limit);
  // `\n` between a list's items so two bullets do not read as one sentence.
  const text = node.textBetween(0, node.content.size, '\n', ' ');
  const images = imageMarkers(node);
  return truncateWords(images ? `${images} ${text}`.trim() : text, limit);
}

/** A block's text with its formulas as TeX and its images as `[slide p. N]`: an item's outline. */
function nodeText(node: Node): string {
  const parts: string[] = [];
  node.forEach((child) => {
    if (child.type.name === 'math_block') parts.push(`$$${String(child.attrs.tex)}$$`);
    else if (child.type.name === 'table') parts.push(tableText(child));
    else {
      const images = imageMarkers(child);
      parts.push(`${images} ${child.textBetween(0, child.content.size, '\n', ' ')}`.trim());
    }
  });
  return parts.filter((p) => p.length > 0).join(' ');
}

/** `Term: the core line`, or the core line alone when it already opens with the term. */
export function conceptLine(card: Node): string {
  const term = ((card.attrs.term as string) || '').trim();
  const core = conceptCore(card)?.textContent.trim() ?? '';
  if (term.length === 0) return core;
  return core.toLowerCase().startsWith(term.toLowerCase()) ? core : `${term}: ${core}`;
}

/**
 * **A whole card as plain text**: its core line, then each depth item on its own line, labelled with
 * its role, formulas as `$$tex$$`. For search, a quote, or anything that wants the card in one go.
 */
export function conceptText(card: Node): string {
  const lines = [conceptLine(card)];
  for (const item of conceptItems(card)) {
    const body = nodeText(item.node);
    if (body.length > 0) lines.push(`${item.role}: ${body}`);
  }
  return lines.join('\n');
}

/**
 * Between a table's rows in its one-line text. Not `\n`: `truncateWords` folds whitespace, and
 * `a | b c | d` would then read as one row of three cells.
 */
const ROW_SEPARATOR = ' || ';

/** A table on one line: `caption: Col | Col || cell | cell || cell | cell`. */
export function tableText(node: Node): string {
  const { caption, columns, rows } = tableGrid(node);
  const lines = [...(columns.length > 0 ? [columns] : []), ...rows].map((cells) => cells.join(' | '));
  return `${caption ? `${caption}: ` : ''}${lines.join(ROW_SEPARATOR)}`;
}

/**
 * A diagram on one line: the title, its labels, then its edges as `A -> B`, by label.
 *
 * A label says where it sits when the layout depends on it — `Child (under Parent)`,
 * `Label [Group]` — because in a `hierarchy` or a `compare` those are the whole structure and
 * there are usually no edges to say it.
 */
export function diagramText(node: Node): string {
  const { title, nodes, edges } = diagramSpec(node);
  const labels = new Map(nodes.map((n) => [n.id, n.label.replace(/\s+/g, ' ').trim() || n.id]));
  const name = (id: string): string => labels.get(id) ?? id;
  const listed = nodes.map((n) => {
    const where = `${n.group ? ` [${n.group}]` : ''}${n.parent ? ` (under ${name(n.parent)})` : ''}`;
    return `${name(n.id)}${where}`;
  });
  const arrows = edges.map((e) => `${name(e.from)} -> ${name(e.to)}${e.label ? ` (${e.label})` : ''}`);
  const body = [listed.join(', '), arrows.join(', ')].filter((part) => part.length > 0).join('; ');
  return `${title ? `${title}: ` : ''}${body}`;
}

/** Flashcards on one line: `title: front = back || front = back`. */
export function flashcardsText(node: Node): string {
  const { title, cards } = flashcardsSpec(node);
  return `${title ? `${title}: ` : ''}${cards.map((c) => `${c.front} = ${c.back}`).join(ROW_SEPARATOR)}`;
}

/**
 * A quiz on one line. Options are listed and the correct one starred, then the explanation: the
 * outline is the model's view of the doc, not the learner's, so nothing here is held back.
 */
export function quizText(node: Node): string {
  const { title, questions } = quizSpec(node);
  const lines = questions.map((q) => {
    const options = q.options.map((o, i) => `${i === q.correct ? '*' : ''}${o}`).join(' / ');
    return `${q.prompt}${options ? ` [${options}]` : ''}${q.explain ? ` -> ${q.explain}` : ''}`;
  });
  return `${title ? `${title}: ` : ''}${lines.join(ROW_SEPARATOR)}`;
}

/** An infographic on one line: `title (layout): value heading: body || …`. */
export function infographicText(node: Node): string {
  const { title, layout, panels } = infographicSpec(node);
  const lines = panels.map((p) => `${[p.value, p.heading].filter((x) => x.length > 0).join(' ')}${p.body ? `: ${p.body}` : ''}`);
  return `${title ? `${title} (${layout}): ` : `(${layout}) `}${lines.join(ROW_SEPARATOR)}`;
}

function entryFor(node: Node, path: string[], card?: { cardId: string; role: ConceptRole | null }): OutlineEntry {
  const { blockId } = blockAttrs(node);
  const entry: OutlineEntry = {
    blockId,
    kind: node.type.name,
    path: [...path],
    text: outlineText(node),
    pages: blockPages(node),
    learnerText: hasLearnerText(node),
    questionId: node.type.name === 'q_block' ? ((node.attrs.questionId as string) || null) : null,
  };
  // Only inside a card, so an outline of a document with no cards is exactly what it was.
  if (card && card.cardId) {
    entry.cardId = card.cardId;
    if (card.role) entry.role = card.role;
  }
  return entry;
}

/**
 * The document as a prompt sees it: one line per addressable block, with the headings above it.
 *
 * `path` is maintained as a heading stack, so a `## Value iteration` under `# Planning` gives
 * every block beneath it `['Planning', 'Value iteration']` — which is how a model that is told
 * "insert after `b_…`" knows where it is about to write.
 */
interface OutlineRow {
  entry: OutlineEntry;
  /** The heading's level, or `null` for everything else. Kept internal: prompts never see it. */
  level: number | null;
}

function outlineRows(doc: Node): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const stack: { level: number; text: string }[] = [];
  // The card (and the depth item) the walk is inside, by where it ends: `eachBlock` visits a
  // container before its children, so everything visited before `end` is inside it.
  let card: { cardId: string; end: number } | null = null;
  let item: { role: ConceptRole; end: number } | null = null;
  eachBlock(doc, (node, pos) => {
    if (card && pos >= card.end) card = null;
    if (item && pos >= item.end) item = null;
    if (node.type.name === 'concept') card = { cardId: blockAttrs(node).blockId, end: pos + node.nodeSize };
    if (node.type.name === 'concept_item') {
      item = { role: isConceptRole(node.attrs.role) ? node.attrs.role : 'note', end: pos + node.nodeSize };
    }
    const inCard = card ? { cardId: card.cardId, role: item?.role ?? null } : undefined;
    if (node.type.name === 'heading') {
      const level = node.attrs.level as number;
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
      rows.push({ entry: entryFor(node, stack.map((h) => h.text), inCard), level });
      stack.push({ level, text: node.textContent.replace(/\s+/g, ' ').trim() });
      return;
    }
    rows.push({ entry: entryFor(node, stack.map((h) => h.text), inCard), level: null });
  });
  return rows;
}

export function docOutline(doc: Node): OutlineEntry[] {
  return outlineRows(doc).map((row) => row.entry);
}

/**
 * The outline around one block — what the doc-edit call is actually given (§8), because a 66-page
 * deck's full outline is both too long and mostly irrelevant to "answer this question here".
 *
 * `radius` blocks either side of the anchor, **plus every heading on the anchor's path**, so the
 * model can always see which section it is writing into even when the nearest heading is fifty
 * blocks up. With no anchor (`null`) it is the table of contents plus the opening of the doc.
 */
export function docOutlineNear(doc: Node, blockId: string | null, radius = 6): OutlineEntry[] {
  const rows = outlineRows(doc);
  const anchorAt = blockId ? rows.findIndex((row) => row.entry.blockId === blockId) : -1;
  const picked = new Set<number>();
  if (anchorAt < 0) {
    // No anchor (or an anchor that has since been removed): the table of contents plus the
    // opening of the document — enough to say what the doc is about and where it starts.
    rows.forEach((row, index) => {
      if (row.level !== null) picked.add(index);
    });
    for (let i = 0; i < Math.min(radius, rows.length); i++) picked.add(i);
    return [...picked].sort((a, b) => a - b).map((index) => rows[index]!.entry);
  }
  for (let i = Math.max(0, anchorAt - radius); i <= Math.min(rows.length - 1, anchorAt + radius); i++) {
    picked.add(i);
  }
  // The whole of the anchor's card, however many lines it runs to (2026-10-06): an addition to a
  // card is planned against what the card already holds, item by item, or it repeats it.
  const cardId = rows[anchorAt]!.entry.cardId;
  if (cardId) {
    rows.forEach((row, index) => {
      if (row.entry.cardId === cardId) picked.add(index);
    });
  }
  // Every heading the anchor sits under, however far above it: walk back and take the nearest
  // heading of each level shallower than the last one taken.
  let deepest = Number.POSITIVE_INFINITY;
  for (let i = anchorAt; i >= 0; i--) {
    const level = rows[i]!.level;
    if (level === null || level >= deepest) continue;
    picked.add(i);
    deepest = level;
  }
  return [...picked].sort((a, b) => a - b).map((index) => rows[index]!.entry);
}

/**
 * The blocks that came from any of these pages — the objective bar's `blockIds` (§6).
 *
 * **Not the objectives list** (live run, 3 Oct 2026). It carries every objective's pages, so it
 * matched every objective and, being near the top, came first: Start scrolled to it, and every
 * lesson's Q block and Ellie's notes in that lesson were filed under it.
 */
export function blocksForPages(doc: Node, pages: readonly number[]): string[] {
  const wanted = new Set(pages);
  const ids: string[] = [];
  eachBlock(doc, (node) => {
    const { blockId, reason } = blockAttrs(node);
    if (!blockId || reason === OBJECTIVES_REASON) return;
    if (node.type.name === 'slide_figure' && wanted.has(node.attrs.page as number)) {
      ids.push(blockId);
      return;
    }
    // A table or a diagram counts through any of its rows or nodes as well as through itself.
    if (blockPages(node).some((page) => wanted.has(page))) ids.push(blockId);
  });
  return ids;
}

// ── documents ───────────────────────────────────────────────────────────────────────────────

/** ProseMirror JSON → a checked document. Throws with the reason, so a bad row is loud. */
export function docFromJson(json: unknown): Node {
  if (!json || typeof json !== 'object') throw new Error('notes doc: expected an object');
  let node: Node;
  try {
    node = Node.fromJSON(notesSchema, json);
  } catch (error) {
    throw new Error(`notes doc: ${error instanceof Error ? error.message : String(error)}`);
  }
  // `check()` is what catches a doc whose *content* violates the schema (an empty `doc`, a
  // `q_block` with no children) — `fromJSON` alone does not.
  node.check();
  if (node.type.name !== 'doc') throw new Error(`notes doc: top node is ${node.type.name}`);
  return node;
}

const authorAt = (): number => Date.now();

/** An `author` mark, for the modules that build content. */
export function authorMark(by: DocAuthor, editId: string | null, at: number = authorAt()): Mark {
  return notesSchema.marks.author!.create({ by, editId, at });
}

/** A new document: the title as `# `, and one empty paragraph for the learner to type into. */
export function emptyDoc(title: string): Node {
  const { paragraph: p, heading: h, doc: docType } = notesSchema.nodes;
  const mark = authorMark('ingest', null);
  const titleNode = h!.create(
    { level: 1, blockId: newBlockId(), pages: [], reason: 'title', objectiveIds: [] },
    title.trim().length > 0 ? notesSchema.text(title.trim(), [mark]) : null,
  );
  const body = p!.create({ blockId: newBlockId(), pages: [], reason: null, objectiveIds: [] });
  return docType!.create(null, [titleNode, body]);
}

/**
 * Mint a `blockId` for every block that has none, and for every block that shares one with an
 * earlier block — which is what `splitBlock` produces when the learner presses Enter mid-block.
 *
 * Pure, and returns `null` when there is nothing to do, so T4's `appendTransaction` can return
 * it straight through. **Every editor hosting this schema must run it**, or agent ops will
 * eventually resolve onto the wrong half of a split paragraph.
 */
export function assignMissingBlockIds(tr: Transaction): Transaction | null {
  const seen = new Set<string>();
  const fixes: { pos: number; node: Node }[] = [];
  tr.doc.descendants((node, pos) => {
    if (!node.isBlock) return true;
    const attrs = node.attrs as { blockId?: string };
    if (typeof attrs.blockId !== 'string') return true;
    const id = attrs.blockId;
    if (id === '' || seen.has(id)) {
      fixes.push({ pos, node });
      return true;
    }
    seen.add(id);
    return true;
  });
  if (fixes.length === 0) return null;
  for (const fix of fixes) {
    tr.setNodeMarkup(fix.pos, undefined, { ...fix.node.attrs, blockId: newBlockId() }, fix.node.marks);
  }
  return tr;
}

// ── images in line with text (2026-10-03) ─────────────────────────────────────────────────────

/**
 * **Every `slide_figure` block as a paragraph holding a `slide_image`** (2026-10-03). The figure's
 * block id, pages and reason move to the paragraph, so an agent's edit addressed to the figure
 * still finds it, its chip still cites the same page, and its section keeps it. Applied when a
 * document is opened in the editor (and saved back as it is on the next save), and by the ops that
 * write an agent's figure (`ops.ts`), so the block form only survives in documents nobody has
 * opened since. Returns the same document when there is nothing to convert.
 */
export function inlineFigures(doc: Node): Node {
  const image = notesSchema.nodes.slide_image!;
  const paragraph = notesSchema.nodes.paragraph!;
  let changed = false;
  const convert = (fragment: Fragment): Fragment => {
    const out: Node[] = [];
    fragment.forEach((node) => {
      if (node.type.name === 'slide_figure') {
        changed = true;
        out.push(figureParagraph(node, image, paragraph));
        return;
      }
      if (node.isBlock && !node.isTextblock && !node.isLeaf) {
        const inner = convert(node.content);
        out.push(inner === node.content ? node : node.copy(inner));
        return;
      }
      out.push(node);
    });
    return changed ? Fragment.from(out) : fragment;
  };
  const content = convert(doc.content);
  return changed ? doc.copy(content) : doc;
}

function figureParagraph(figure: Node, image: NodeType, paragraph: NodeType): Node {
  const { blockId, pages, reason, objectiveIds } = blockAttrs(figure);
  const page = figure.attrs.page as number;
  return paragraph.create(
    { blockId, pages: pages.length > 0 ? pages : [page], reason, objectiveIds },
    image.create({ page, rect: (figure.attrs.rect as Rect | null) ?? null, width: null, caption: (figure.attrs.caption as string) ?? '' }),
  );
}

/**
 * A new image's width: a crop at the width it had on a 560 px slide, so a one-line formula comes
 * in small and a whole slide at a readable size — never narrower than 160 px.
 */
export function defaultImageWidth(rect: Rect | null, full = 560): number {
  const span = rect ? Math.max(0, Math.min(1, rect.x1 - rect.x0)) : 1;
  return Math.max(160, Math.round(full * span));
}

/** A paragraph holding one slide image: what Insert into notes puts in (2026-10-03). */
export function imageParagraph(page: number, rect: Rect | null, blockId: string): Node {
  return notesSchema.nodes.paragraph!.create(
    { blockId, pages: [page], reason: null, objectiveIds: [] },
    notesSchema.nodes.slide_image!.create({ page, rect, width: defaultImageWidth(rect) }),
  );
}

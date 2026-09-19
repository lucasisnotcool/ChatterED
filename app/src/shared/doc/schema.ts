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

import { Fragment, Mark, Node, Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import type { DocAuthor, OutlineEntry, Rect } from './types.js';

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

/** The inverse, for `parseDOM`. Only ever runs inside a view; kept symmetrical so paste works. */
function readBlockAttrs(dom: HTMLElement): Record<string, unknown> {
  const pages = (dom.getAttribute('data-pages') ?? '')
    .split(',')
    .map((n) => Number.parseInt(n, 10))
    .filter((n) => Number.isInteger(n));
  const objectives = (dom.getAttribute('data-objectives') ?? '').split(',').filter((s) => s.length > 0);
  return {
    blockId: dom.getAttribute('data-block-id') ?? '',
    pages,
    reason: dom.getAttribute('data-reason'),
    objectiveIds: objectives,
  };
}

// ── nodes ───────────────────────────────────────────────────────────────────────────────────

const doc: NodeSpec = { content: 'block+' };

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
    getAttrs: (dom: HTMLElement) => ({ ...readBlockAttrs(dom), level }),
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
      getAttrs: (dom: HTMLElement) => ({
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
  parseDOM: [{ tag: 'li', getAttrs: (dom: HTMLElement) => ({ blockId: dom.getAttribute('data-block-id') ?? '' }) }],
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
      getAttrs: (dom: HTMLElement) => ({ ...readBlockAttrs(dom), lang: dom.getAttribute('data-lang') }),
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
      getAttrs: (dom: HTMLElement) => ({ ...readBlockAttrs(dom), tex: dom.getAttribute('data-tex') ?? '' }),
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
    ...BLOCK_ATTRS,
  },
  parseDOM: [
    {
      tag: 'section[data-question-id]',
      getAttrs: (dom: HTMLElement) => ({
        ...readBlockAttrs(dom),
        questionId: dom.getAttribute('data-question-id') ?? '',
        askedBy: dom.getAttribute('data-asked-by') ?? 'max',
        status: dom.getAttribute('data-status') ?? 'open',
        resolution: dom.getAttribute('data-resolution'),
        objectiveId: dom.getAttribute('data-objective-id'),
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
      getAttrs: (dom: HTMLElement) => ({
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
    { tag: 'span[data-tex]', getAttrs: (dom: HTMLElement) => ({ tex: dom.getAttribute('data-tex') ?? '' }) },
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
      getAttrs: (dom: HTMLElement) => ({
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
        getAttrs: (dom: HTMLElement) => ({
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
 * bypassed the list.
 */
const CONTAINERS = new Set(['q_block']);

/**
 * True for a block whose *text* belongs to its children rather than to it — today, only the
 * `q_block`. Anything that scans the document span by span has to skip these, or every run
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

function outlineText(node: Node): string {
  if (node.type.name === 'slide_figure') {
    const caption = node.attrs.caption as string;
    return truncateWords(caption || `slide p. ${String(node.attrs.page as number)}`);
  }
  if (node.type.name === 'math_block') return truncateWords(node.attrs.tex as string);
  // `\n` between a list's items so two bullets do not read as one sentence.
  return truncateWords(
    node.textBetween(0, node.content.size, '\n', ' '),
    hasLearnerText(node) ? LEARNER_OUTLINE_WORDS : OUTLINE_WORDS,
  );
}

function entryFor(node: Node, path: string[]): OutlineEntry {
  const { blockId, pages } = blockAttrs(node);
  return {
    blockId,
    kind: node.type.name,
    path: [...path],
    text: outlineText(node),
    pages,
    learnerText: hasLearnerText(node),
    questionId: node.type.name === 'q_block' ? ((node.attrs.questionId as string) || null) : null,
  };
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
  eachBlock(doc, (node) => {
    if (node.type.name === 'heading') {
      const level = node.attrs.level as number;
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
      rows.push({ entry: entryFor(node, stack.map((h) => h.text)), level });
      stack.push({ level, text: node.textContent.replace(/\s+/g, ' ').trim() });
      return;
    }
    rows.push({ entry: entryFor(node, stack.map((h) => h.text)), level: null });
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

/** The blocks that came from any of these pages — the objective bar's `blockIds` (§6). */
export function blocksForPages(doc: Node, pages: readonly number[]): string[] {
  const wanted = new Set(pages);
  const ids: string[] = [];
  eachBlock(doc, (node) => {
    const { blockId, pages: blockPages } = blockAttrs(node);
    if (!blockId) return;
    if (node.type.name === 'slide_figure' && wanted.has(node.attrs.page as number)) {
      ids.push(blockId);
      return;
    }
    if (blockPages.some((page) => wanted.has(page))) ids.push(blockId);
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

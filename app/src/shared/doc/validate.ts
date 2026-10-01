/**
 * **The gate between what a model wrote and what the document contains** (§2, issue #48).
 *
 * > **Provenance is mandatory on every block**: either `pages: [n, …]` (where the content came
 * > from) or `reason: "…"` (why it is here when no slide says it), or both. A block with neither
 * > is a bug in the ingest and is rejected by validation.
 *
 * That sentence is the whole design of this file, and the reason it is *code* rather than a
 * stricter prompt. §1's evidence is that models fabricate coverage confidently — R4 "claimed 97%
 * coverage after its own check failed", R3's "all lectures" silently became lectures 7–13 — so a
 * page number a model wrote is a claim to be checked against the deck the learner actually
 * opened, not a fact. `pageCount` is the deck's, from the vault; anything outside `1..pageCount`
 * is dropped, and a block left with no provenance at all goes with it.
 *
 * **Repair before reject.** The ingest is two LLM passes over 66 pages; discarding a good
 * paragraph because one of its three page numbers was hallucinated would make the notes worse,
 * not more honest. So: bad pages are dropped, a heading level outside 1–3 is clamped, a
 * malformed figure rect becomes `null` (the figure then shows the whole page, which is true),
 * and only the blocks that have nothing left are rejected — each with the reason, so the caller
 * can log what the model did rather than only that something was wrong.
 *
 * Pure, no DOM, no schema knowledge beyond `draftToNodes` — `src/main/notes` runs it.
 */

import { DIAGRAM_LAYOUTS, INFOGRAPHIC_LAYOUTS, isDiagramLayout, isInfographicLayout, notesSchema, newBlockId } from './schema.js';
import { draftToNodes } from './ops.js';
import { inlineToNodes } from './inline.js';
import type {
  DiagramDraft,
  DocBlockDraft,
  FlashcardsDraft,
  InfographicDraft,
  Provenance,
  QuizDraft,
  Rect,
  TableDraft,
} from './types.js';

export interface ValidationIssue {
  index: number;
  reason: 'no_provenance' | 'bad_page' | 'empty' | 'unknown_kind';
}

/**
 * The kinds the *ingest* may write. `table`, `diagram`, `flashcards`, `quiz` and `infographic` are deliberately absent: they have their
 * own validators below, and one arriving here is an `unknown_kind`.
 */
const KINDS = new Set(['heading', 'paragraph', 'bullets', 'numbers', 'code', 'math', 'figure']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRect(value: unknown): Rect | null {
  const rect = asRecord(value);
  if (!rect) return null;
  const nums = ['x0', 'y0', 'x1', 'y1'].map((key) => rect[key]);
  if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
  const [x0, y0, x1, y1] = nums as [number, number, number, number];
  // A rect that is inside-out or outside the page is a rect nobody can crop to.
  if (x1 <= x0 || y1 <= y0) return null;
  if ([x0, y0, x1, y1].some((n) => n < 0 || n > 1)) return null;
  return { x0, y0, x1, y1 };
}

/** The array a model wrote, however it wrapped it: `[…]`, `{blocks: […]}`, or neither. */
function asBlockArray(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  const record = asRecord(input);
  if (record && Array.isArray(record.blocks)) return record.blocks;
  return [];
}

export function validateDrafts(
  input: unknown,
  pageCount: number,
): { blocks: DocBlockDraft[]; issues: ValidationIssue[] } {
  const blocks: DocBlockDraft[] = [];
  const issues: ValidationIssue[] = [];

  asBlockArray(input).forEach((raw, index) => {
    const record = asRecord(raw);
    if (!record) {
      issues.push({ index, reason: 'unknown_kind' });
      return;
    }
    const kind = typeof record.kind === 'string' ? record.kind : '';
    if (!KINDS.has(kind)) {
      issues.push({ index, reason: 'unknown_kind' });
      return;
    }

    // ── provenance, checked against the deck the learner opened ──
    const prov = asRecord(record.prov) ?? {};
    const rawPages = Array.isArray(prov.pages) ? prov.pages : [];
    const pages: number[] = [];
    let droppedPage = false;
    for (const page of rawPages) {
      const n = typeof page === 'number' ? Math.trunc(page) : Number.NaN;
      if (Number.isInteger(n) && n >= 1 && n <= pageCount) {
        if (!pages.includes(n)) pages.push(n);
      } else {
        droppedPage = true;
      }
    }
    const reason = asText(prov.reason);
    if (droppedPage) issues.push({ index, reason: 'bad_page' });
    if (pages.length === 0 && reason.length === 0) {
      issues.push({ index, reason: 'no_provenance' });
      return;
    }
    const provenance: Provenance = { pages, reason: reason.length > 0 ? reason : null };

    // ── the body ──
    switch (kind) {
      case 'heading': {
        const text = asText(record.text);
        if (text.length === 0) {
          issues.push({ index, reason: 'empty' });
          return;
        }
        const raw2 = typeof record.level === 'number' ? Math.trunc(record.level) : 1;
        const level = (Math.min(3, Math.max(1, raw2)) as 1 | 2 | 3);
        blocks.push({ kind: 'heading', level, text, prov: provenance });
        return;
      }
      case 'paragraph': {
        const text = asText(record.text);
        if (text.length === 0) {
          issues.push({ index, reason: 'empty' });
          return;
        }
        blocks.push({ kind: 'paragraph', text, prov: provenance });
        return;
      }
      case 'bullets':
      case 'numbers': {
        const items = (Array.isArray(record.items) ? record.items : [])
          .map((item) => asText(item))
          .filter((item) => item.length > 0);
        if (items.length === 0) {
          issues.push({ index, reason: 'empty' });
          return;
        }
        blocks.push({ kind, items, prov: provenance });
        return;
      }
      case 'code': {
        // Not trimmed the way prose is: leading indentation is the meaning of a code block.
        const text = typeof record.text === 'string' ? record.text.replace(/\s+$/, '') : '';
        if (text.trim().length === 0) {
          issues.push({ index, reason: 'empty' });
          return;
        }
        const lang = asText(record.lang);
        blocks.push(lang.length > 0 ? { kind: 'code', text, lang, prov: provenance } : { kind: 'code', text, prov: provenance });
        return;
      }
      case 'math': {
        const tex = asText(record.tex);
        if (tex.length === 0) {
          issues.push({ index, reason: 'empty' });
          return;
        }
        blocks.push({ kind: 'math', tex, prov: provenance });
        return;
      }
      case 'figure': {
        const page = typeof record.page === 'number' ? Math.trunc(record.page) : Number.NaN;
        if (!Number.isInteger(page) || page < 1 || page > pageCount) {
          // A figure *is* its page: there is nothing to repair and nothing to show.
          issues.push({ index, reason: 'bad_page' });
          return;
        }
        blocks.push({
          kind: 'figure',
          page,
          rect: asRect(record.rect),
          caption: asText(record.caption),
          prov: provenance.pages.includes(page)
            ? provenance
            : { pages: [...provenance.pages, page], reason: provenance.reason },
        });
        return;
      }
      default:
        issues.push({ index, reason: 'unknown_kind' });
    }
  });

  return { blocks, issues };
}

// ── the table and the diagram: their own call, their own gate (2026-10-01) ──────────────────

/**
 * **Why these are not kinds `validateDrafts` accepts.** `validateDrafts` and
 * `DRAFT_BLOCK_JSON_SCHEMA` are the *ingest's* contract with its model, and the ingest must keep
 * writing exactly what it writes today. A table or a diagram is asked for by the learner and
 * produced by a dedicated call, which is bound to one of the two schemas below and checked by one
 * of the two validators here.
 *
 * The reply carries no `prov`. Provenance is the caller's — it knows which block the request was
 * anchored to — and it is still mandatory (§2): a draft whose `prov` has neither a page of this
 * deck nor a reason is refused like any other block.
 *
 * `problems` is everything that was wrong, in words a log line can carry. **`draft` is `null`
 * exactly when the reply is not usable**; a non-null draft with problems is one that was repaired
 * (a page the deck does not have, an edge to a node that is not there), in the same spirit as
 * "repair before reject" above. What is never repaired is shape: a row with the wrong number of
 * cells is not padded, because the padding would be a cell of the comparison nobody wrote.
 */
export const TABLE_LIMITS = { minColumns: 2, maxColumns: 6, minRows: 1, maxRows: 12 } as const;
export const DIAGRAM_LIMITS = { minNodes: 2, maxNodes: 12, maxLabel: 80 } as const;

/** Pages of this deck, deduplicated; `dropped` when any was not one. */
function clampPages(value: unknown, pageCount: number): { pages: number[]; dropped: boolean } {
  const pages: number[] = [];
  let dropped = false;
  for (const page of Array.isArray(value) ? value : []) {
    const n = typeof page === 'number' ? Math.trunc(page) : Number.NaN;
    if (Number.isInteger(n) && n >= 1 && n <= pageCount) {
      if (!pages.includes(n)) pages.push(n);
    } else {
      dropped = true;
    }
  }
  return { pages, dropped };
}

/** The caller's provenance, checked against the deck. `null` when nothing is left of it. */
function checkedProv(prov: Provenance, pageCount: number, problems: string[]): Provenance | null {
  const { pages, dropped } = clampPages(prov?.pages, pageCount);
  if (dropped) problems.push('provenance: a page outside the deck was dropped');
  const reason = asText(prov?.reason);
  if (pages.length === 0 && reason.length === 0) {
    problems.push('no provenance: neither a page of the deck nor a reason');
    return null;
  }
  return { pages, reason: reason.length > 0 ? reason : null };
}

/** A cell a model wrote: a string, or a bare number (`42`), which is a cell too. */
function asCell(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : asText(value);
}

/** `{ table: {…} }` and `{ diagram: {…} }` are the wrappers a model adds; anything else is the thing. */
function unwrap(raw: unknown, key: string): Record<string, unknown> | null {
  const record = asRecord(raw);
  return record ? (asRecord(record[key]) ?? record) : null;
}

export function validateTableDraft(
  raw: unknown,
  pageCount: number,
  prov: Provenance,
): { draft: TableDraft | null; problems: string[] } {
  const problems: string[] = [];
  const record = unwrap(raw, 'table');
  if (!record) return { draft: null, problems: ['table: not an object'] };
  const provenance = checkedProv(prov, pageCount, problems);
  let usable = provenance !== null;

  const columns = (Array.isArray(record.columns) ? record.columns : []).map((column) => asCell(column));
  const { minColumns, maxColumns, minRows, maxRows } = TABLE_LIMITS;
  if (columns.length < minColumns || columns.length > maxColumns) {
    problems.push(`table: ${String(columns.length)} columns (${String(minColumns)} to ${String(maxColumns)} allowed)`);
    usable = false;
  }
  columns.forEach((column, i) => {
    if (column.length > 0) return;
    problems.push(`table: column ${String(i + 1)} has no heading`);
    usable = false;
  });

  const rawRows = Array.isArray(record.rows) ? record.rows : [];
  if (rawRows.length < minRows || rawRows.length > maxRows) {
    problems.push(`table: ${String(rawRows.length)} rows (${String(minRows)} to ${String(maxRows)} allowed)`);
    usable = false;
  }
  const rows: TableDraft['rows'] = [];
  rawRows.forEach((rawRow, i) => {
    // A row is `{ cells, pages }`; a bare array of cells is the same row without pages.
    const row = asRecord(rawRow);
    const rawCells = Array.isArray(rawRow) ? rawRow : row && Array.isArray(row.cells) ? row.cells : [];
    const cells = rawCells.map((cell) => asCell(cell));
    if (cells.length !== columns.length) {
      problems.push(
        `table: row ${String(i + 1)} has ${String(cells.length)} cells, expected ${String(columns.length)}`,
      );
      usable = false;
    }
    const { pages, dropped } = clampPages(row?.pages, pageCount);
    if (dropped) problems.push(`table: row ${String(i + 1)} cited a page outside the deck, dropped`);
    rows.push({ cells, pages });
  });

  if (!usable || !provenance) return { draft: null, problems };
  const caption = asText(record.caption);
  return {
    draft: { kind: 'table', caption: caption.length > 0 ? caption : null, columns, rows, prov: provenance },
    problems,
  };
}

export function validateDiagramDraft(
  raw: unknown,
  pageCount: number,
  prov: Provenance,
): { draft: DiagramDraft | null; problems: string[] } {
  const problems: string[] = [];
  const record = unwrap(raw, 'diagram');
  if (!record) return { draft: null, problems: ['diagram: not an object'] };
  const provenance = checkedProv(prov, pageCount, problems);
  let usable = provenance !== null;

  const layout = record.layout;
  if (!isDiagramLayout(layout)) {
    problems.push(`diagram: layout must be one of ${DIAGRAM_LAYOUTS.join(', ')}`);
    usable = false;
  }

  const { minNodes, maxNodes, maxLabel } = DIAGRAM_LIMITS;
  const rawNodes = Array.isArray(record.nodes) ? record.nodes : [];
  if (rawNodes.length < minNodes || rawNodes.length > maxNodes) {
    problems.push(`diagram: ${String(rawNodes.length)} nodes (${String(minNodes)} to ${String(maxNodes)} allowed)`);
    usable = false;
  }
  const nodes: DiagramDraft['nodes'] = [];
  const ids = new Set<string>();
  rawNodes.forEach((rawNode, i) => {
    const node = asRecord(rawNode) ?? {};
    const id = asText(node.id);
    const label = asText(node.label);
    const name = id.length > 0 ? `node "${id}"` : `node ${String(i + 1)}`;
    if (id.length === 0) {
      problems.push(`diagram: node ${String(i + 1)} has no id`);
      usable = false;
    } else if (ids.has(id)) {
      problems.push(`diagram: node id "${id}" is used more than once`);
      usable = false;
    }
    ids.add(id);
    if (label.length === 0) {
      problems.push(`diagram: ${name} has no label`);
      usable = false;
    } else if (label.length > maxLabel) {
      problems.push(`diagram: ${name} has a label of ${String(label.length)} characters (at most ${String(maxLabel)})`);
      usable = false;
    }
    const parent = asText(node.parent);
    const group = asText(node.group);
    const { pages, dropped } = clampPages(node.pages, pageCount);
    if (dropped) problems.push(`diagram: ${name} cited a page outside the deck, dropped`);
    nodes.push({
      id,
      label,
      parent: parent.length > 0 ? parent : null,
      group: group.length > 0 ? group : null,
      pages,
    });
  });

  // A parent has to be a node of this diagram, and following parents has to end.
  const parentOf = new Map(nodes.map((node) => [node.id, node.parent ?? null]));
  for (const node of nodes) {
    if (!node.parent) continue;
    if (!ids.has(node.parent)) {
      problems.push(`diagram: node "${node.id}" names a parent "${node.parent}" that is not a node`);
      usable = false;
      continue;
    }
    const seen = new Set<string>([node.id]);
    for (let at: string | null = node.parent; at; at = parentOf.get(at) ?? null) {
      if (seen.has(at)) {
        problems.push(`diagram: node "${node.id}" is its own ancestor`);
        usable = false;
        break;
      }
      seen.add(at);
    }
  }

  if (layout === 'compare') {
    for (const node of nodes) {
      if (node.group) continue;
      problems.push(`diagram: node "${node.id}" has no group, and a compare layout needs one on every node`);
      usable = false;
    }
  }

  // An edge to a node that is not there is dropped, not fatal: the picture is still true without it.
  const edges: NonNullable<DiagramDraft['edges']> = [];
  (Array.isArray(record.edges) ? record.edges : []).forEach((rawEdge, i) => {
    const edge = asRecord(rawEdge) ?? {};
    const from = asText(edge.from);
    const to = asText(edge.to);
    if (!ids.has(from) || !ids.has(to) || from.length === 0 || to.length === 0) {
      problems.push(`diagram: edge ${String(i + 1)} ("${from}" -> "${to}") names a node that does not exist, dropped`);
      return;
    }
    const label = asText(edge.label);
    edges.push({ from, to, label: label.length > 0 ? label : null });
  });

  if (!usable || !provenance || !isDiagramLayout(layout)) return { draft: null, problems };
  const title = asText(record.title);
  return {
    draft: { kind: 'diagram', layout, title: title.length > 0 ? title : null, nodes, edges, prov: provenance },
    problems,
  };
}

/**
 * **The JSON Schemas for those two replies**, flat and permissive for the reason
 * `DRAFT_BLOCK_JSON_SCHEMA` gives below: the caps are in the descriptions, where a model reads
 * them, and in the validators, where they are enforced. No `prov` — see above.
 */
export const TABLE_DRAFT_JSON_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['columns', 'rows'],
  additionalProperties: false,
  properties: {
    caption: { type: ['string', 'null'], description: 'Optional: one line saying what is compared.' },
    columns: {
      type: 'array',
      items: { type: 'string' },
      description: `The column headings, ${String(TABLE_LIMITS.minColumns)} to ${String(TABLE_LIMITS.maxColumns)} of them, none empty.`,
    },
    rows: {
      type: 'array',
      description: `${String(TABLE_LIMITS.minRows)} to ${String(TABLE_LIMITS.maxRows)} rows.`,
      items: {
        type: 'object',
        required: ['cells'],
        additionalProperties: false,
        properties: {
          cells: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Exactly one cell per column, in column order. Inline markup is **bold**, *italic*, `code` and $tex$ only. An empty string is an empty cell.',
          },
          pages: {
            type: 'array',
            items: { type: 'integer', minimum: 1 },
            description: '1-based pages of this deck that this row comes from. Never a page the deck does not have.',
          },
        },
      },
    },
  },
};

export const DIAGRAM_DRAFT_JSON_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['layout', 'nodes'],
  additionalProperties: false,
  properties: {
    layout: {
      type: 'string',
      enum: [...DIAGRAM_LAYOUTS],
      description:
        'flow: steps in order, joined by edges. hierarchy: a tree, by each node\'s parent. compare: nodes in columns, by each node\'s group. cycle: steps that return to the first.',
    },
    title: { type: ['string', 'null'], description: 'Optional: one line saying what the diagram shows.' },
    nodes: {
      type: 'array',
      description: `${String(DIAGRAM_LIMITS.minNodes)} to ${String(DIAGRAM_LIMITS.maxNodes)} nodes.`,
      items: {
        type: 'object',
        required: ['id', 'label'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'A short id, unique in this diagram, e.g. "n1". Edges and parents use it.' },
          label: {
            type: 'string',
            description: `The text in the node, at most ${String(DIAGRAM_LIMITS.maxLabel)} characters. Same inline markup as notes text.`,
          },
          parent: { type: ['string', 'null'], description: 'hierarchy only: the id of the node this one sits under.' },
          group: {
            type: ['string', 'null'],
            description: 'compare only, and then required on every node: the column heading this node sits under.',
          },
          pages: {
            type: 'array',
            items: { type: 'integer', minimum: 1 },
            description: '1-based pages of this deck that this node comes from. Never a page the deck does not have.',
          },
        },
      },
    },
    edges: {
      type: 'array',
      description: 'Optional: arrows between nodes, by id. Both ends must be ids of nodes above.',
      items: {
        type: 'object',
        required: ['from', 'to'],
        additionalProperties: false,
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          label: { type: ['string', 'null'], description: 'Optional: a word or two on the arrow.' },
        },
      },
    },
  },
};

// ── flashcards, a quiz, an infographic (2026-10-01; notebooks §5.3) ─────────────────────────

/**
 * The same gate as the table's and the diagram's, for the three blocks of notebooks §5.3. Counts
 * are the brief's (cards 3 to 12, questions 3 to 5, panels 3 to 8). **Repair before reject, and
 * never pad:** too many items are cut to the cap (the first ones are the ones the model chose to
 * lead with), and a single bad item (an empty side, a multiple-choice question with no one right
 * option) is dropped on its own; the draft is refused only when fewer than the minimum survive.
 * A missing side is never invented.
 */
export const FLASHCARD_LIMITS = { minCards: 3, maxCards: 12, maxSide: 300 } as const;
export const QUIZ_LIMITS = { minQuestions: 3, maxQuestions: 5, minOptions: 3, maxOptions: 4, maxText: 400 } as const;
export const INFOGRAPHIC_LIMITS = { minPanels: 3, maxPanels: 8, maxValue: 24, maxHeading: 80, maxBody: 240 } as const;

/** The optional one-line title every one of these carries. */
function titleOf(record: Record<string, unknown>): string | null {
  const title = asText(record.title);
  return title.length > 0 ? title : null;
}

/** At most `max` of `items`; a cut is a problem worth logging, not a refusal. */
function capped<T>(items: readonly T[], max: number, what: string, problems: string[]): T[] {
  if (items.length <= max) return [...items];
  problems.push(`${what}: ${String(items.length)} given, the first ${String(max)} kept`);
  return items.slice(0, max);
}

export function validateFlashcardsDraft(
  raw: unknown,
  pageCount: number,
  prov: Provenance,
): { draft: FlashcardsDraft | null; problems: string[] } {
  const problems: string[] = [];
  const record = unwrap(raw, 'flashcards');
  if (!record) return { draft: null, problems: ['flashcards: not an object'] };
  const provenance = checkedProv(prov, pageCount, problems);
  const { minCards, maxCards, maxSide } = FLASHCARD_LIMITS;
  const cards: FlashcardsDraft['cards'] = [];
  (Array.isArray(record.cards) ? record.cards : []).forEach((rawCard, i) => {
    const card = asRecord(rawCard) ?? {};
    const front = asText(card.front);
    const back = asText(card.back);
    if (front.length === 0 || back.length === 0) {
      problems.push(`flashcards: card ${String(i + 1)} has no ${front.length === 0 ? 'front' : 'back'}, dropped`);
      return;
    }
    if (front.length > maxSide || back.length > maxSide) {
      problems.push(`flashcards: card ${String(i + 1)} is longer than ${String(maxSide)} characters on a side, dropped`);
      return;
    }
    const { pages, dropped } = clampPages(card.pages, pageCount);
    if (dropped) problems.push(`flashcards: card ${String(i + 1)} cited a page outside the deck, dropped`);
    cards.push({ front, back, pages });
  });
  const kept = capped(cards, maxCards, 'flashcards', problems);
  if (kept.length < minCards) {
    problems.push(`flashcards: ${String(kept.length)} usable cards (at least ${String(minCards)} needed)`);
    return { draft: null, problems };
  }
  if (!provenance) return { draft: null, problems };
  return { draft: { kind: 'flashcards', title: titleOf(record), cards: kept, prov: provenance }, problems };
}

export function validateQuizDraft(
  raw: unknown,
  pageCount: number,
  prov: Provenance,
): { draft: QuizDraft | null; problems: string[] } {
  const problems: string[] = [];
  const record = unwrap(raw, 'quiz');
  if (!record) return { draft: null, problems: ['quiz: not an object'] };
  const provenance = checkedProv(prov, pageCount, problems);
  const { minQuestions, maxQuestions, minOptions, maxOptions, maxText } = QUIZ_LIMITS;
  const questions: QuizDraft['questions'] = [];
  (Array.isArray(record.questions) ? record.questions : []).forEach((rawQuestion, i) => {
    const q = asRecord(rawQuestion) ?? {};
    const name = `quiz: question ${String(i + 1)}`;
    const prompt = asText(q.prompt);
    const explain = asText(q.explanation ?? q.explain);
    if (prompt.length === 0 || explain.length === 0) {
      problems.push(`${name} has no ${prompt.length === 0 ? 'prompt' : 'explanation'}, dropped`);
      return;
    }
    if (prompt.length > maxText || explain.length > maxText) {
      problems.push(`${name} is longer than ${String(maxText)} characters in a field, dropped`);
      return;
    }
    const { pages, dropped } = clampPages(q.pages, pageCount);
    if (dropped) problems.push(`${name} cited a page outside the deck, dropped`);
    const type = q.type === 'short' ? 'short' : q.type === 'mc' ? 'mc' : null;
    if (type === null) {
      problems.push(`${name} has type "${String(q.type)}" (mc or short), dropped`);
      return;
    }
    if (type === 'short') {
      questions.push({ type, prompt, explain, pages });
      return;
    }
    const texts = (Array.isArray(q.options) ? q.options : []).map((option) => asCell(option));
    if (texts.length < minOptions || texts.length > maxOptions || texts.some((t) => t.length === 0 || t.length > maxText)) {
      problems.push(`${name} has ${String(texts.length)} options (${String(minOptions)} to ${String(maxOptions)}, none empty), dropped`);
      return;
    }
    // `answer` is 1-based, as a person counts; the draft carries the mark itself.
    const answer = typeof q.answer === 'number' ? Math.trunc(q.answer) : Number.NaN;
    if (!Number.isInteger(answer) || answer < 1 || answer > texts.length) {
      problems.push(`${name} has no one right option (answer ${String(q.answer)} of ${String(texts.length)}), dropped`);
      return;
    }
    if (new Set(texts.map((t) => t.toLowerCase())).size !== texts.length) {
      problems.push(`${name} repeats an option, dropped`);
      return;
    }
    questions.push({
      type,
      prompt,
      options: texts.map((text, k) => ({ text, correct: k === answer - 1 })),
      explain,
      pages,
    });
  });
  const kept = capped(questions, maxQuestions, 'quiz', problems);
  if (kept.length < minQuestions) {
    problems.push(`quiz: ${String(kept.length)} usable questions (at least ${String(minQuestions)} needed)`);
    return { draft: null, problems };
  }
  if (!provenance) return { draft: null, problems };
  return { draft: { kind: 'quiz', title: titleOf(record), questions: kept, prov: provenance }, problems };
}

export function validateInfographicDraft(
  raw: unknown,
  pageCount: number,
  prov: Provenance,
): { draft: InfographicDraft | null; problems: string[] } {
  const problems: string[] = [];
  const record = unwrap(raw, 'infographic');
  if (!record) return { draft: null, problems: ['infographic: not an object'] };
  const provenance = checkedProv(prov, pageCount, problems);
  const layout = record.layout;
  if (!isInfographicLayout(layout)) {
    problems.push(`infographic: layout must be one of ${INFOGRAPHIC_LAYOUTS.join(', ')}`);
    return { draft: null, problems };
  }
  const { minPanels, maxPanels, maxValue, maxHeading, maxBody } = INFOGRAPHIC_LIMITS;
  // A stat is its number and a stop is its date: a panel with neither is not one of those.
  const needsValue = layout === 'stats' || layout === 'timeline';
  const panels: InfographicDraft['panels'] = [];
  (Array.isArray(record.panels) ? record.panels : []).forEach((rawPanel, i) => {
    const panel = asRecord(rawPanel) ?? {};
    const name = `infographic: panel ${String(i + 1)}`;
    const value = asCell(panel.value);
    const heading = asText(panel.heading);
    const body = asText(panel.body);
    if (heading.length === 0) {
      problems.push(`${name} has no heading, dropped`);
      return;
    }
    if (needsValue && value.length === 0) {
      problems.push(`${name} has no value, and a ${layout} layout needs one on every panel, dropped`);
      return;
    }
    if (value.length > maxValue || heading.length > maxHeading || body.length > maxBody) {
      problems.push(`${name} has a field over its length limit, dropped`);
      return;
    }
    const { pages, dropped } = clampPages(panel.pages, pageCount);
    if (dropped) problems.push(`${name} cited a page outside the deck, dropped`);
    panels.push({ value: value.length > 0 ? value : null, heading, body, pages });
  });
  const kept = capped(panels, maxPanels, 'infographic', problems);
  if (kept.length < minPanels) {
    problems.push(`infographic: ${String(kept.length)} usable panels (at least ${String(minPanels)} needed)`);
    return { draft: null, problems };
  }
  if (!provenance) return { draft: null, problems };
  return { draft: { kind: 'infographic', layout, title: titleOf(record), panels: kept, prov: provenance }, problems };
}

const PAGES_SCHEMA = {
  type: 'array',
  items: { type: 'integer', minimum: 1 },
  description: '1-based pages of this deck that this item comes from. Never a page the deck does not have.',
};
const INLINE_NOTE = 'Inline markup is **bold**, *italic*, `code` and $tex$ only.';

export const FLASHCARDS_DRAFT_JSON_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['cards'],
  additionalProperties: false,
  properties: {
    title: { type: ['string', 'null'], description: 'Optional: one line saying what the deck covers.' },
    cards: {
      type: 'array',
      description: `${String(FLASHCARD_LIMITS.minCards)} to ${String(FLASHCARD_LIMITS.maxCards)} cards.`,
      items: {
        type: 'object',
        required: ['front', 'back'],
        additionalProperties: false,
        properties: {
          front: {
            type: 'string',
            description: `A term or a question, at most ${String(FLASHCARD_LIMITS.maxSide)} characters. ${INLINE_NOTE}`,
          },
          back: {
            type: 'string',
            description: `Its answer or definition, at most ${String(FLASHCARD_LIMITS.maxSide)} characters. ${INLINE_NOTE}`,
          },
          pages: PAGES_SCHEMA,
        },
      },
    },
  },
};

export const QUIZ_DRAFT_JSON_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['questions'],
  additionalProperties: false,
  properties: {
    title: { type: ['string', 'null'], description: 'Optional: one line saying what the quiz covers.' },
    questions: {
      type: 'array',
      description: `${String(QUIZ_LIMITS.minQuestions)} to ${String(QUIZ_LIMITS.maxQuestions)} questions.`,
      items: {
        type: 'object',
        required: ['type', 'prompt', 'explanation'],
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['mc', 'short'], description: 'mc: multiple choice. short: answered in the learner\'s own words.' },
          prompt: { type: 'string', description: `The question, at most ${String(QUIZ_LIMITS.maxText)} characters. ${INLINE_NOTE}` },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: `mc only: ${String(QUIZ_LIMITS.minOptions)} to ${String(QUIZ_LIMITS.maxOptions)} options, one of them right, the others plausible and wrong. Leave out for short.`,
          },
          answer: { type: 'integer', minimum: 1, description: 'mc only: the 1-based number of the one right option.' },
          explanation: {
            type: 'string',
            description: `The answer and why, from the slides, at most ${String(QUIZ_LIMITS.maxText)} characters. Shown only after the learner answers.`,
          },
          pages: PAGES_SCHEMA,
        },
      },
    },
  },
};

export const INFOGRAPHIC_DRAFT_JSON_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['layout', 'panels'],
  additionalProperties: false,
  properties: {
    layout: {
      type: 'string',
      enum: [...INFOGRAPHIC_LAYOUTS],
      description:
        'timeline: dated stops in order (every panel needs a value, the date). steps: a numbered process. stats: big numbers (every panel needs a value). compare: two to four alternatives side by side.',
    },
    title: { type: ['string', 'null'], description: 'Optional: one line saying what the infographic shows.' },
    panels: {
      type: 'array',
      description: `${String(INFOGRAPHIC_LIMITS.minPanels)} to ${String(INFOGRAPHIC_LIMITS.maxPanels)} panels.`,
      items: {
        type: 'object',
        required: ['heading', 'body'],
        additionalProperties: false,
        properties: {
          value: {
            type: ['string', 'null'],
            description: `The big number, year or label (at most ${String(INFOGRAPHIC_LIMITS.maxValue)} characters), for stats and timeline; otherwise null.`,
          },
          heading: { type: 'string', description: `At most ${String(INFOGRAPHIC_LIMITS.maxHeading)} characters. ${INLINE_NOTE}` },
          body: { type: 'string', description: `One or two sentences, at most ${String(INFOGRAPHIC_LIMITS.maxBody)} characters. ${INLINE_NOTE}` },
          pages: PAGES_SCHEMA,
        },
      },
    },
  },
};

/**
 * Validated drafts → a whole document, as ProseMirror JSON `docFromJson` accepts.
 *
 * The title goes in as an H1 with `reason: 'title'` — it is provenance in the §2 sense (it is
 * here because it is the deck's name, not because a slide says it), and it keeps the invariant
 * true for every block in the document including the first one.
 */
export function draftsToDocJson(title: string, blocks: readonly DocBlockDraft[]): unknown {
  const heading = notesSchema.nodes.heading!.create(
    { level: 1, blockId: newBlockId(), pages: [], reason: 'title', objectiveIds: [] },
    inlineToNodes(notesSchema, title.trim() || 'Lecture notes', 'ingest', null),
  );
  const body = draftToNodes(notesSchema, blocks, 'ingest', null);
  // `doc` is `block+`: a deck whose every block failed validation still has to open.
  const content = body.length > 0 ? body : [notesSchema.nodes.paragraph!.create({ blockId: newBlockId(), pages: [], reason: null, objectiveIds: [] })];
  return notesSchema.nodes.doc!.create(null, [heading, ...content]).toJSON();
}

/**
 * **The JSON Schema handed to the model** for a structured `{ blocks: DocBlockDraft[] }` reply.
 *
 * Deliberately permissive — one object shape with a `kind` enum and optional fields, not a deep
 * `oneOf` per kind. Two reasons. A `oneOf` of seven branches is a large share of the ingest's
 * prompt budget on 66 pages of slides, and a model that trips over the branch selection returns
 * *nothing*, where a flat shape returns blocks the validator can repair. And `validateDrafts` is
 * the real gate either way: a schema that lets a bad block through costs one `ValidationIssue`,
 * while a schema strict enough to reject one costs the whole window.
 */
export const DRAFT_BLOCK_JSON_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['blocks'],
  additionalProperties: false,
  properties: {
    blocks: {
      type: 'array',
      description: 'The lecture notes for this window, in reading order.',
      items: {
        type: 'object',
        required: ['kind', 'prov'],
        additionalProperties: false,
        properties: {
          kind: {
            type: 'string',
            enum: ['heading', 'paragraph', 'bullets', 'numbers', 'code', 'math', 'figure'],
          },
          text: {
            type: 'string',
            description:
              'heading, paragraph and code. Inline markup is **bold**, *italic*, `code` and $tex$ only.',
          },
          level: { type: 'integer', minimum: 1, maximum: 3, description: 'heading only.' },
          items: {
            type: 'array',
            items: { type: 'string' },
            description: 'bullets and numbers: one string per item, same inline markup.',
          },
          lang: { type: 'string', description: 'code only: the language, for highlighting.' },
          tex: { type: 'string', description: 'math only: the TeX source, without the $ delimiters.' },
          page: {
            type: 'integer',
            minimum: 1,
            description: 'figure only: the 1-based page of the deck to show as an image.',
          },
          rect: {
            type: 'object',
            description:
              'figure only, optional: the region of the page to crop, normalised 0–1 with y down from the top. Omit to show the whole page.',
            required: ['x0', 'y0', 'x1', 'y1'],
            additionalProperties: false,
            properties: {
              x0: { type: 'number' },
              y0: { type: 'number' },
              x1: { type: 'number' },
              y1: { type: 'number' },
            },
          },
          caption: { type: 'string', description: 'figure only: one line saying what it shows.' },
          prov: {
            type: 'object',
            description:
              'Mandatory. Where this block came from: the deck pages, or why it is here when no slide says it, or both. A block with neither is rejected.',
            additionalProperties: false,
            properties: {
              pages: {
                type: 'array',
                items: { type: 'integer', minimum: 1 },
                description: '1-based page numbers of this deck. Never a page the deck does not have.',
              },
              reason: {
                type: ['string', 'null'],
                description:
                  'Why this block is here when no slide says it — e.g. "bridges p. 12 and p. 13".',
              },
            },
          },
        },
      },
    },
  },
};

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

import { notesSchema, newBlockId } from './schema.js';
import { draftToNodes } from './ops.js';
import { inlineToNodes } from './inline.js';
import type { DocBlockDraft, Provenance, Rect } from './types.js';

export interface ValidationIssue {
  index: number;
  reason: 'no_provenance' | 'bad_page' | 'empty' | 'unknown_kind';
}

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

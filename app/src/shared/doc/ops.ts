/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * AGENT OPS → ONE TRANSACTION (`docs/research/collab-doc.md` §5, §8; issue #48)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * > **Agents address blocks, never offsets.** An agent edit is a structured op from main to
 * > renderer (`insert_after blockId`, `replace_block`, `append_to_block`, `resolve_q`), produced
 * > by a structured model call given the doc outline near the anchor. The renderer turns it into
 * > a transaction, runs the **guard**, animates it behind the agent's cursor, and saves.
 *
 * This file is the "turns it into a transaction" half, and it is where §5.4's rule becomes
 * behaviour rather than intent. The three cases, from the contract:
 *
 * | op on a block holding learner text | what happens |
 * |---|---|
 * | `replace_block` | becomes a **suggestion** — strike the block's text, offer the agent's (a `table`, `diagram`, `flashcards`, `quiz` or `infographic` is **dropped**, `rejected_guard`: see `applyBatch`) |
 * | `remove_block` | **dropped**, `rejected_guard` — nothing an agent says removes your writing |
 * | `append_to_block` | **relocated** to an `insert_after` of the same block |
 *
 * `insert_after`, `insert_before`, `insert_q` and `resolve_q` only ever add, so they never
 * conflict; an agent has free rein over `ingest`, `ellie` and `max` text and may rewrite, move
 * and merge it (contract rule 6).
 *
 * **Everything is one transaction.** A batch is one edit in the history, one Remove · Keep
 * control and one `editId`; half a batch applying and half not would leave a control whose
 * Remove undoes something the learner never saw appear.
 *
 * **Missing blocks are skipped, not fatal.** The model is answering about a document it saw one
 * outline of; between the call and the reply the learner may have deleted the block it chose.
 * Skipping the op and applying the rest is the behaviour that keeps an agent useful in a live
 * document; a batch where *nothing* resolved reports `no_change` and the caller logs it.
 */

import { Fragment, type Node, type Schema } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';
import { learnerConflicts, type LearnerConflict } from './guard.js';
import { inlineToNodes, nodesToInline } from './inline.js';
import {
  authorMark,
  blockAttrs,
  blockPos,
  cardOf,
  conceptItems,
  eachBlock,
  hasLearnerText,
  isStructuredBlock,
  newBlockId,
  notesSchema,
  textRuns,
} from './schema.js';
import { suggestReplaceOnTr } from './suggest.js';
import { displayMathOf } from './tex.js';
import type {
  AgentDocOp,
  AgentDocOpBatch,
  DocAuthor,
  DocBlockDraft,
  DocEditRecord,
  Suggestion,
} from './types.js';
import { CONCEPT_ROLES } from './types.js';

export interface ApplyResult {
  tr: Transaction | null;
  status: 'applied' | 'rejected_guard' | 'no_change';
  /** What the edit created or touched: what Remove undoes, and what the colour is on. */
  blockIds: string[];
  /** Non-empty ⇒ part of the batch was held back for learner text. */
  conflicts: LearnerConflict[];
  /** Set when the batch (or its held-back part) became a suggestion. */
  suggestion: Suggestion | null;
}

// ── drafts → nodes ──────────────────────────────────────────────────────────────────────────

function provAttrs(draft: DocBlockDraft): { blockId: string; pages: number[]; reason: string | null; objectiveIds: string[] } {
  return {
    blockId: newBlockId(),
    pages: [...(draft.prov?.pages ?? [])],
    reason: draft.prov?.reason ?? null,
    objectiveIds: [],
  };
}

/**
 * `DocBlockDraft[]` → ProseMirror blocks, every text span authored.
 *
 * `at` is beyond the cross-track signature and optional (see `inline.ts`): one timestamp for a
 * whole batch reads better in a log than one per block, and a test can pin it.
 */
export function draftToNodes(
  schema: Schema,
  drafts: readonly DocBlockDraft[],
  author: DocAuthor,
  editId: string | null,
  at?: number,
): Node[] {
  const out: Node[] = [];
  for (const draft of drafts) {
    const attrs = provAttrs(draft);
    const inline = (text: string): Node[] => inlineToNodes(schema, text, author, editId, at);
    switch (draft.kind) {
      case 'heading':
        out.push(schema.nodes.heading!.create({ ...attrs, level: draft.level }, inline(draft.text)));
        break;
      case 'paragraph': {
        // A paragraph that is one display formula is a formula block (2026-10-03).
        const display = displayMathOf(draft.text);
        out.push(
          display !== null
            ? schema.nodes.math_block!.create({ ...attrs, tex: display })
            : schema.nodes.paragraph!.create(attrs, inline(draft.text)),
        );
        break;
      }
      case 'bullets':
      case 'numbers': {
        const items = draft.items
          .filter((item) => item.trim().length > 0)
          .map((item) =>
            schema.nodes.list_item!.create(
              { blockId: newBlockId() },
              // The item's paragraph keeps the list's provenance: a bullet the learner clicks the
              // chip on should point at the same slide the list does.
              schema.nodes.paragraph!.create({ ...attrs, blockId: newBlockId() }, inline(item)),
            ),
          );
        if (items.length === 0) break;
        const type = draft.kind === 'bullets' ? schema.nodes.bullet_list! : schema.nodes.ordered_list!;
        out.push(type.create(draft.kind === 'numbers' ? { ...attrs, start: 1 } : attrs, items));
        break;
      }
      case 'code': {
        // Code is literal: no `**bold**` inside it, so the text goes in as one authored span.
        const mark = at === undefined ? authorMark(author, editId) : authorMark(author, editId, at);
        const text = draft.text.length > 0 ? [schema.text(draft.text, [mark])] : [];
        out.push(schema.nodes.code_block!.create({ ...attrs, lang: draft.lang ?? null }, text));
        break;
      }
      case 'math':
        out.push(schema.nodes.math_block!.create({ ...attrs, tex: draft.tex }));
        break;
      case 'figure':
        // In line with text (2026-10-03): a paragraph holding the image, carrying the block's id
        // and provenance, as `inlineFigures` turns an older document's figures into.
        out.push(
          schema.nodes.paragraph!.create(
            { ...attrs, pages: (attrs.pages as number[]).length > 0 ? attrs.pages : [draft.page] },
            schema.nodes.slide_image!.create({ page: draft.page, rect: draft.rect, caption: draft.caption, width: null }),
          ),
        );
        break;
      case 'table': {
        if (draft.columns.length === 0) break;
        const row = (cells: readonly string[], header: boolean, pages: readonly number[]): Node =>
          schema.nodes.table_row!.create(
            { pages: [...pages] },
            cells.map((cell) => schema.nodes.table_cell!.create({ header }, inline(cell))),
          );
        // The headings are the first row. A row with no cells is not a row (`table_cell+`).
        const rows = draft.rows.filter((r) => r.cells.length > 0).map((r) => row(r.cells, false, r.pages ?? []));
        out.push(
          schema.nodes.table!.create({ ...attrs, caption: draft.caption ?? null }, [
            row(draft.columns, true, []),
            ...rows,
          ]),
        );
        break;
      }
      case 'diagram': {
        if (draft.nodes.length === 0) break;
        const nodes = draft.nodes.map((n) =>
          schema.nodes.diagram_node!.create(
            {
              nodeId: n.id,
              parent: n.parent ?? null,
              group: n.group ?? null,
              pages: [...(n.pages ?? [])],
              reason: null,
            },
            inline(n.label),
          ),
        );
        const edges = (draft.edges ?? []).map((e) => ({ from: e.from, to: e.to, label: e.label ?? null }));
        out.push(
          schema.nodes.diagram!.create({ ...attrs, layout: draft.layout, title: draft.title ?? null, edges }, nodes),
        );
        break;
      }
      case 'flashcards': {
        if (draft.cards.length === 0) break;
        const cards = draft.cards.map((c) =>
          schema.nodes.flashcard!.create({ pages: [...(c.pages ?? [])], reason: null }, [
            schema.nodes.flashcard_front!.create(null, inline(c.front)),
            schema.nodes.flashcard_back!.create(null, inline(c.back)),
          ]),
        );
        out.push(schema.nodes.flashcards!.create({ ...attrs, title: draft.title ?? null }, cards));
        break;
      }
      case 'quiz': {
        if (draft.questions.length === 0) break;
        const questions = draft.questions.map((q) => {
          const options = (q.options ?? []).map((o) =>
            schema.nodes.quiz_option!.create({ correct: o.correct }, inline(o.text)),
          );
          return schema.nodes.quiz_question!.create(
            { qtype: options.length > 0 && q.type === 'mc' ? 'mc' : 'short', pages: [...(q.pages ?? [])], reason: null },
            [schema.nodes.quiz_prompt!.create(null, inline(q.prompt)), ...options, schema.nodes.quiz_explain!.create(null, inline(q.explain))],
          );
        });
        out.push(schema.nodes.quiz!.create({ ...attrs, title: draft.title ?? null }, questions));
        break;
      }
      case 'infographic': {
        if (draft.panels.length === 0) break;
        const panels = draft.panels.map((p) =>
          schema.nodes.info_panel!.create({ pages: [...(p.pages ?? [])], reason: null }, [
            schema.nodes.info_value!.create(null, inline(p.value ?? '')),
            schema.nodes.info_heading!.create(null, inline(p.heading)),
            schema.nodes.info_body!.create(null, inline(p.body)),
          ]),
        );
        out.push(schema.nodes.infographic!.create({ ...attrs, layout: draft.layout, title: draft.title ?? null }, panels));
        break;
      }
      case 'concept': {
        // The core line is the card: a card with nothing to say on its one visible line is not one.
        if (draft.core.trim().length === 0) break;
        const core = schema.nodes.paragraph!.create({ ...attrs, blockId: newBlockId() }, inline(coreText(draft.term, draft.core)));
        const items = draft.depth
          .map((item) => conceptItemNode(schema, item, author, editId, at))
          .filter((node): node is Node => node !== null);
        out.push(schema.nodes.concept!.create({ ...attrs, term: draft.term.trim() }, [core, ...items]));
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/**
 * **The core line opens with the term, in bold** (D1). A model asked for both writes the term into
 * its line more often than not, sometimes bold and sometimes not; the term is put in front only
 * when the line does not already start with it, and bolded there when it is plain.
 */
export function coreText(term: string, core: string): string {
  const t = term.trim();
  const line = core.trim();
  if (t.length === 0) return line;
  const plain = line.replace(/^\*\*/, '');
  if (plain.toLowerCase().startsWith(t.toLowerCase())) {
    return line.startsWith('**') ? line : `**${line.slice(0, t.length)}**${line.slice(t.length)}`;
  }
  return `**${t}**: ${line}`;
}

/**
 * One depth item → a `concept_item` holding its blocks, or null when none of them minted. A card
 * inside an item is not a card the schema can hold (`card` stands only at the top level), so one
 * is skipped rather than flattened.
 */
export function conceptItemNode(
  schema: Schema,
  item: { role: string; blocks: readonly DocBlockDraft[]; prov?: { pages: number[]; reason: string | null } },
  author: DocAuthor,
  editId: string | null,
  at?: number,
): Node | null {
  const inner = draftToNodes(
    schema,
    item.blocks.filter((b) => b.kind !== 'concept'),
    author,
    editId,
    at,
  );
  if (inner.length === 0) return null;
  return schema.nodes.concept_item!.create(
    { blockId: newBlockId(), pages: [...(item.prov?.pages ?? [])], reason: item.prov?.reason ?? null, objectiveIds: [], role: item.role },
    inner,
  );
}

/** The ids of blocks this fragment introduces, including a list's items. */
function idsOf(nodes: readonly Node[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    const id = (node.attrs as { blockId?: string }).blockId;
    if (id) ids.push(id);
  }
  return ids;
}

/** A draft's text, for the times a block op has to become an inline suggestion. */
function draftsToText(drafts: readonly DocBlockDraft[]): string {
  const parts: string[] = [];
  for (const draft of drafts) {
    switch (draft.kind) {
      case 'heading':
      case 'paragraph':
      case 'code':
        parts.push(draft.text);
        break;
      case 'bullets':
      case 'numbers':
        parts.push(draft.items.join(' '));
        break;
      case 'math':
        parts.push(`$${draft.tex}$`);
        break;
      case 'figure':
        parts.push(draft.caption);
        break;
      case 'table':
        parts.push(draft.caption ?? '', draft.columns.join(' | '), ...draft.rows.map((r) => r.cells.join(' | ')));
        break;
      case 'diagram':
        parts.push(draft.title ?? '', draft.nodes.map((n) => n.label).join(', '));
        break;
      case 'flashcards':
        parts.push(draft.title ?? '', ...draft.cards.map((c) => `${c.front} = ${c.back}`));
        break;
      case 'quiz':
        parts.push(
          draft.title ?? '',
          ...draft.questions.map((q) => [q.prompt, ...(q.options ?? []).map((o) => o.text), q.explain].join(' ')),
        );
        break;
      case 'infographic':
        parts.push(draft.title ?? '', ...draft.panels.map((p) => [p.value ?? '', p.heading, p.body].join(' ')));
        break;
      case 'concept':
        parts.push(coreText(draft.term, draft.core), ...draft.depth.map((item) => draftsToText(item.blocks)));
        break;
      default:
        break;
    }
  }
  return parts.filter((part) => part.trim().length > 0).join(' ');
}

// ── where an op lands in a card (2026-10-06) ────────────────────────────────────────────────

/**
 * **A card's own structure is kept by the ops, not by the model.** A card is its core paragraph
 * and then depth items only (`paragraph concept_item*`), so a block inserted next to the core
 * line or next to an item has nowhere valid to go *inside* the card. Such an insert lands next to
 * the **card**: after it for `insert_after` and `insert_q`, before it for `insert_before`. Inside
 * an item (`block+`) anything goes, and the anchor stands.
 */
/** The top-level block a block is in (itself, when it is at the top level). */
function topLevelTarget(doc: Node, anchorId: string): { pos: number; node: Node } | null {
  const target = blockPos(doc, anchorId);
  if (!target) return null;
  const $pos = doc.resolve(target.pos);
  return $pos.depth === 0 ? target : { pos: $pos.before(1), node: $pos.node(1) };
}

/**
 * **A replacement fitted to where it lands in a card**, or null when it cannot fit:
 *
 *  - the **core line** takes exactly one paragraph (a card is one visible line, then its depth);
 *  - a **depth item** is replaced by an item of the same role holding the new blocks;
 *  - a **card** only by a card;
 *  - anywhere else, and inside an item, the blocks as they are (no card inside an item).
 */
function shapeForCard(doc: Node, target: { pos: number; node: Node }, nodes: Node[]): Node[] | null {
  const $pos = doc.resolve(target.pos);
  const parent = $pos.depth >= 1 ? $pos.parent.type.name : 'doc';
  if (target.node.type.name === 'concept') return nodes.every((n) => n.type.name === 'concept') ? nodes : null;
  if (target.node.type.name === 'concept_item') {
    const inner = nodes.filter((n) => n.type.name !== 'concept');
    if (inner.length === 0) return null;
    const attrs = blockAttrs(target.node);
    return [
      notesSchema.nodes.concept_item!.create(
        { blockId: newBlockId(), pages: attrs.pages, reason: attrs.reason, objectiveIds: [], role: target.node.attrs.role as string },
        inner,
      ),
    ];
  }
  if (parent === 'concept') return nodes.length === 1 && nodes[0]!.type.name === 'paragraph' ? nodes : null;
  if (parent !== 'doc' && nodes.some((n) => n.type.name === 'concept')) return null;
  return nodes;
}

function placementTarget(doc: Node, anchorId: string): { pos: number; node: Node } | null {
  const target = blockPos(doc, anchorId);
  if (!target) return null;
  const $pos = doc.resolve(target.pos);
  if ($pos.depth >= 1 && $pos.parent.type.name === 'concept') {
    return { pos: $pos.before(1), node: $pos.node(1) };
  }
  return target;
}

// ── applying a batch ────────────────────────────────────────────────────────────────────────

function findQBlock(doc: Node, questionId: string): { pos: number; node: Node } | null {
  let found: { pos: number; node: Node } | null = null;
  eachBlock(doc, (node, pos) => {
    if (found) return;
    if (node.type.name === 'q_block' && (node.attrs.questionId as string) === questionId) {
      found = { pos, node };
    }
  });
  return found;
}

/** The learner runs inside one block, as conflicts — what a held-back op reports. */
function conflictsInBlock(node: Node, pos: number): LearnerConflict[] {
  const { blockId } = blockAttrs(node);
  const out: LearnerConflict[] = [];
  let open: LearnerConflict | null = null;
  for (const run of textRuns(node, pos + 1)) {
    const isUser = run.marks.some((mark) => mark.type.name === 'author' && mark.attrs.by === 'user');
    if (!isUser) {
      open = null;
      continue;
    }
    if (open !== null && open.to === run.from) {
      open.to = run.to;
      open.text += run.text;
      continue;
    }
    open = { blockId, from: run.from, to: run.to, text: run.text };
    out.push(open);
  }
  return out;
}

export function applyBatch(
  state: EditorState,
  batch: AgentDocOpBatch,
  opts: { frozen: boolean; docId: string; now: string },
): ApplyResult {
  // §3's Freeze: "no agent edits the doc; agents still talk. Edits that would have happened are
  // dropped, not queued." Nothing is built, so nothing can leak out of a later mapping.
  if (opts.frozen) {
    return { tr: null, status: 'no_change', blockIds: [], conflicts: [], suggestion: null };
  }

  const at = Number.isFinite(Date.parse(opts.now)) ? Date.parse(opts.now) : Date.now();
  const tr = state.tr;
  const touched: string[] = [];
  const conflicts: LearnerConflict[] = [];
  let guardBlocked = false;
  let suggestion: Suggestion | null = null;

  const nodesFor = (drafts: readonly DocBlockDraft[]): Node[] =>
    draftToNodes(notesSchema, drafts, batch.author, batch.editId, at);

  const suggest = (blockId: string, quote: string, replacement: string, note: string | null, threadId: string | null): boolean => {
    const suggestionId = `sg_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const ok = suggestReplaceOnTr(tr, {
      suggestionId,
      by: batch.author,
      blockId,
      quote,
      replacement,
    });
    if (!ok) return false;
    suggestion = {
      suggestionId,
      docId: opts.docId,
      editId: batch.editId,
      author: batch.author,
      blockId,
      status: 'open',
      note,
      threadId,
      createdAt: opts.now,
      resolvedAt: null,
    };
    if (!touched.includes(blockId)) touched.push(blockId);
    return true;
  };

  /**
   * **Ellie writes into the card, not beside it** (D1; `notebooks.md` §4.2 as amended 2026-10-06).
   * The card's first item of the op's role is extended (the blocks at its end) or replaced (a new
   * item of the same role in its place); a card with no such item gets one, at the place its role
   * has in the reading order (`CONCEPT_ROLES`). A replace of an item the learner wrote in is held
   * to an extend, and the learner's runs are reported as the conflict, so their words stay put.
   */
  const attachToCard = (op: Extract<AgentDocOp, { op: 'card_attach' }>): void => {
    const target = blockPos(tr.doc, op.cardBlockId);
    if (!target || target.node.type.name !== 'concept') return;
    const inner = nodesFor(op.blocks.filter((b) => b.kind !== 'concept'));
    if (inner.length === 0) return;
    const items = conceptItems(target.node);
    const existing = items.find((item) => item.role === op.role) ?? null;
    const base = target.pos + 1;
    if (existing && op.mode === 'replace' && !hasLearnerText(existing.node)) {
      const item = conceptItemNode(notesSchema, { role: op.role, blocks: op.blocks, prov: op.prov }, batch.author, batch.editId, at);
      if (!item) return;
      const from = base + existing.offset;
      tr.replaceWith(from, from + existing.node.nodeSize, item);
      touched.push(...idsOf([item]));
      return;
    }
    if (existing) {
      if (op.mode === 'replace') conflicts.push(...conflictsInBlock(existing.node, base + existing.offset));
      // The end of the item's content: one before the item's closing token.
      tr.insert(base + existing.offset + existing.node.nodeSize - 1, Fragment.fromArray(inner));
      touched.push(...idsOf(inner));
      return;
    }
    const item = conceptItemNode(notesSchema, { role: op.role, blocks: op.blocks, prov: op.prov }, batch.author, batch.editId, at);
    if (!item) return;
    const rank = (role: string): number => {
      const i = (CONCEPT_ROLES as readonly string[]).indexOf(role);
      return i < 0 ? CONCEPT_ROLES.length : i;
    };
    const after = items.find((it) => rank(it.role) > rank(op.role));
    const where = after ? base + after.offset : target.pos + target.node.nodeSize - 1;
    tr.insert(where, item);
    touched.push(...idsOf([item]));
  };

  const applyOp = (op: AgentDocOp): void => {
    switch (op.op) {
      case 'insert_after':
      case 'insert_before': {
        const anchorId = op.anchorBlockId;
        const nodes = nodesFor(op.blocks);
        if (nodes.length === 0) return;
        // A card goes at the top level whatever it was anchored to; anything else as `placementTarget` says.
        const target = nodes.some((n) => n.type.name === 'concept')
          ? topLevelTarget(tr.doc, anchorId)
          : placementTarget(tr.doc, anchorId);
        if (!target) return;
        const where = op.op === 'insert_after' ? target.pos + target.node.nodeSize : target.pos;
        tr.insert(where, Fragment.fromArray(nodes));
        touched.push(...idsOf(nodes));
        return;
      }

      case 'card_attach': {
        attachToCard(op);
        return;
      }

      case 'replace_block': {
        const target = blockPos(tr.doc, op.blockId);
        if (!target) return;
        let nodes = nodesFor(op.blocks);
        if (nodes.length === 0) return;
        const shaped = shapeForCard(tr.doc, target, nodes);
        if (shaped === null) return;
        nodes = shaped;
        if (hasLearnerText(target.node)) {
          // Case 2a: the learner wrote here. The rewrite becomes an offer over the block's own
          // words — struck, with the agent's version beside it — and the learner decides.
          conflicts.push(...conflictsInBlock(target.node, target.pos));
          if (isStructuredBlock(target.node)) {
            // A table or a diagram the learner wrote in is held back whole. There is no honest
            // inline offer to make: the struck text would run across cells, and the agent's
            // version is a grid, not a sentence that fits in one of them.
            guardBlocked = true;
            return;
          }
          const quote = nodesToInline(target.node.content);
          const made = suggest(op.blockId, quote, draftsToText(op.blocks), batch.why || null, null);
          if (!made) guardBlocked = true;
          return;
        }
        tr.replaceWith(target.pos, target.pos + target.node.nodeSize, Fragment.fromArray(nodes));
        touched.push(...idsOf(nodes));
        return;
      }

      case 'append_to_block': {
        const target = blockPos(tr.doc, op.blockId);
        if (!target) return;
        if (op.text.trim().length === 0) return;
        const attrs = blockAttrs(target.node);
        if (target.node.type.name === 'concept_item') {
          // Appending to a depth item is one more paragraph at its end: the item is `block+`.
          const nodes = nodesFor([{ kind: 'paragraph', text: op.text, prov: { pages: attrs.pages, reason: attrs.reason } }]);
          tr.insert(target.pos + target.node.nodeSize - 1, Fragment.fromArray(nodes));
          touched.push(...idsOf(nodes));
          return;
        }
        if (hasLearnerText(target.node) || !target.node.isTextblock) {
          // Case 2c: relocated to an `insert_after` of the same block — the sentence still lands
          // where it was meant to, and not one character of the learner's is moved.
          conflicts.push(...conflictsInBlock(target.node, target.pos));
          const nodes = nodesFor([
            { kind: 'paragraph', text: op.text, prov: { pages: attrs.pages, reason: attrs.reason } },
          ]);
          const place = placementTarget(tr.doc, op.blockId) ?? target;
          tr.insert(place.pos + place.node.nodeSize, Fragment.fromArray(nodes));
          touched.push(...idsOf(nodes));
          return;
        }
        const nodes = inlineToNodes(notesSchema, op.text, batch.author, batch.editId, at);
        if (nodes.length === 0) return;
        tr.insert(target.pos + 1 + target.node.content.size, Fragment.fromArray(nodes));
        touched.push(attrs.blockId);
        return;
      }

      case 'remove_block': {
        let target = blockPos(tr.doc, op.blockId);
        if (!target) return;
        // A card without its core line is not a card: removing the core line removes the card.
        const card = cardOf(tr.doc, op.blockId);
        if (card?.isCore) target = { pos: card.pos, node: card.node };
        if (hasLearnerText(target.node)) {
          // Case 2b. Nothing an agent says removes the learner's writing — not even as a
          // suggestion, because a suggestion is an offer to change words, not to delete a block.
          conflicts.push(...conflictsInBlock(target.node, target.pos));
          guardBlocked = true;
          return;
        }
        tr.delete(target.pos, target.pos + target.node.nodeSize);
        touched.push(op.blockId);
        return;
      }

      case 'insert_q': {
        // Never inside a card (§11.2, §11.5): a Q block anchored anywhere in a card goes under the
        // card, where the renderer's own "Add a question" puts the learner's too.
        const target = topLevelTarget(tr.doc, op.anchorBlockId);
        if (!target) return;
        if (op.text.trim().length === 0) return;
        const blockId = newBlockId();
        const question = notesSchema.nodes.paragraph!.create(
          {
            blockId: newBlockId(),
            pages: [...(op.prov?.pages ?? [])],
            reason: op.prov?.reason ?? null,
            objectiveIds: op.objectiveId ? [op.objectiveId] : [],
          },
          inlineToNodes(notesSchema, op.text, batch.author, batch.editId, at),
        );
        const qBlock = notesSchema.nodes.q_block!.create(
          {
            blockId,
            pages: [...(op.prov?.pages ?? [])],
            reason: op.prov?.reason ?? null,
            objectiveIds: op.objectiveId ? [op.objectiveId] : [],
            questionId: op.questionId,
            askedBy: batch.author,
            status: 'open',
            resolution: null,
            objectiveId: op.objectiveId,
          },
          question,
        );
        tr.insert(target.pos + target.node.nodeSize, qBlock);
        touched.push(blockId);
        return;
      }

      case 'resolve_q': {
        const target = findQBlock(tr.doc, op.questionId);
        if (!target) return;
        // **Once** (#49). Every feedback turn used to resolve the question again, each one
        // inserted above the last, and the notes read as the grading history backwards.
        if ((target.node.attrs.status as string) === 'resolved') return;
        // The Q block stays (§5): the question and its answer are the record of the exchange, and
        // the learner removes it if they want to.
        tr.setNodeMarkup(target.pos, undefined, {
          ...target.node.attrs,
          status: 'resolved',
          resolution: op.resolution,
        });
        touched.push((target.node.attrs.blockId as string) || '');
        const nodes: Node[] = [];
        const own = op.learnerAnswer?.trim() ?? '';
        if (own.length > 0) {
          // Their words, so their author mark — and no `editId`: this is not Max's edit to
          // remove or keep, it is what the learner said, filed under the question they said it to.
          nodes.push(
            notesSchema.nodes.paragraph!.create(
              {
                blockId: newBlockId(),
                pages: [...((target.node.attrs.pages as number[] | undefined) ?? [])],
                reason: 'your answer, from the chat',
                objectiveIds: [...((target.node.attrs.objectiveIds as string[] | undefined) ?? [])],
              },
              notesSchema.text(own, [authorMark('user', null, at)]),
            ),
          );
        }
        nodes.push(...nodesFor(op.blocks));
        if (nodes.length === 0) return;
        // After the question paragraph — the answer reads under the question it answers, not at
        // the bottom of whatever else has accumulated in the block — **and after the learner's
        // own answer under it**. Since answers are written in place (2026-10-01) the paragraphs
        // right under the question are often theirs (`reason: 'your answer'`), and Max's release
        // went in above them, so the block read question, answer key, then what the learner
        // wrote (live run, 1 Oct 2026). Their attempt comes first; the resolution follows it.
        let insertAt = target.pos + 1;
        for (let i = 0; i < target.node.childCount; i += 1) {
          const child = target.node.child(i);
          if (i > 0 && !String(child.attrs.reason ?? '').startsWith('your answer')) break;
          insertAt += child.nodeSize;
        }
        tr.insert(insertAt, Fragment.fromArray(nodes));
        touched.push(...idsOf(nodes));
        return;
      }

      default:
        return;
    }
  };

  for (const op of batch.ops) applyOp(op);

  // The suggestion path is here rather than in the caller: a `cause: 'suggestion'` batch names
  // the quote and the replacement directly (§6 — Max correcting something the learner wrote in
  // the doc), so there is nothing to guard. The edit *is* the offer.
  if (batch.suggestion) {
    suggest(
      batch.suggestion.blockId,
      batch.suggestion.quote,
      batch.suggestion.replacement,
      batch.suggestion.note,
      batch.suggestion.threadId,
    );
  }

  if (tr.steps.length === 0) {
    return {
      tr: null,
      status: guardBlocked ? 'rejected_guard' : 'no_change',
      blockIds: [],
      conflicts,
      suggestion: null,
    };
  }

  // The belt to the braces: whatever the ops above believed they were doing, ask the guard what
  // the finished transaction would actually take out of the learner's document. A conflict here
  // is a bug in *this file*, and the suite asserts it stays empty for every op — but it is
  // cheap, and §5.4 is not a rule to hold by care when it can be held by a check.
  const guarded = learnerConflicts(state, tr);
  if (guarded.length > 0) {
    return { tr: null, status: 'rejected_guard', blockIds: [], conflicts: guarded, suggestion: null };
  }

  const blockIds = [...new Set(touched.filter((id) => id.length > 0))];
  return { tr, status: 'applied', blockIds, conflicts, suggestion };
}

// ── Remove · Keep (§5) ──────────────────────────────────────────────────────────────────────

type EditRef = Pick<DocEditRecord, 'editId' | 'blockIds'>;

interface Removal {
  from: number;
  to: number;
}

/**
 * **Remove** — "every agent edit can be removed … in one click" (§5).
 *
 * What it removes is `editId`, everywhere it is: whole blocks the edit created, and the spans it
 * added to blocks it did not. `blockIds` is a hint that narrows the search, never the authority —
 * the edit may have been split by the learner typing in the middle of it, and the mark on the
 * text is the truth.
 *
 * **The one thing it must never do** is take the learner's words with it. A learner who typed
 * inside Ellie's paragraph and then clicked Remove on Ellie's edit gets their own sentence back
 * in an otherwise-empty block, not a deleted paragraph — so a block is removed whole only when
 * nothing in it is the learner's.
 */
export function removeEdit(state: EditorState, edit: EditRef): Transaction | null {
  const doc = state.doc;
  const removals: Removal[] = [];

  eachBlock(doc, (node, pos) => {
    const blockEnd = pos + node.nodeSize;
    const owns = spansOfEdit(node, pos, edit.editId);
    const isEditsBlock =
      edit.blockIds.includes(blockAttrs(node).blockId) ||
      // A block with content, all of it this edit's, is this edit's block even if the record's
      // `blockIds` has drifted (a list's items, a q_block's resolution paragraph).
      (owns.length > 0 && !hasForeignText(node, edit.editId));

    if (!isEditsBlock && owns.length === 0) return;

    if (hasLearnerText(node)) {
      // The learner is in here. Take the agent's spans, leave the block and their words.
      removals.push(...owns);
      return;
    }
    if (isEditsBlock) {
      // A resolved Q block goes whole — the question and its answer are one thing (§5.3), and a
      // Q block whose question has been removed is worse than no Q block.
      removals.push({ from: pos, to: blockEnd });
      return;
    }
    removals.push(...owns);
  });

  if (removals.length === 0) return null;

  // A q_block and the spans inside it are both on the list; keep the outermost of any nested
  // pair, drop exact duplicates, and delete back to front so no position is ever stale.
  const outermost = removals.filter(
    (range, i) =>
      !removals.some(
        (other, j) =>
          j !== i &&
          other.from <= range.from &&
          other.to >= range.to &&
          (other.to - other.from > range.to - range.from || j < i),
      ),
  );

  const tr = state.tr;
  for (const removal of [...outermost].sort((a, b) => b.from - a.from)) {
    tr.delete(removal.from, removal.to);
  }
  return tr.steps.length > 0 ? tr : null;
}

/** The runs of one edit's text inside a node, merged where a mark boundary split them. */
function spansOfEdit(node: Node, pos: number, editId: string): Removal[] {
  const spans: Removal[] = [];
  let open: Removal | null = null;
  for (const run of textRuns(node, pos + 1)) {
    const mine = run.marks.some((mark) => mark.type.name === 'author' && mark.attrs.editId === editId);
    if (!mine) {
      open = null;
      continue;
    }
    if (open !== null && open.to === run.from) {
      open.to = run.to;
      continue;
    }
    open = { from: run.from, to: run.to };
    spans.push(open);
  }
  return spans;
}

/** True when the node holds text that is not this edit's — anyone else's, learner or agent. */
function hasForeignText(node: Node, editId: string): boolean {
  let foreign = false;
  node.descendants((child) => {
    if (foreign) return false;
    if (!child.isText) return true;
    const author = child.marks.find((mark) => mark.type.name === 'author');
    if (!author || author.attrs.editId !== editId) foreign = true;
    return !foreign;
  });
  return foreign;
}

/**
 * **Keep** — "*Keep* drops the colour and keeps the text and its provenance" (§5).
 *
 * One mark change and nothing else: `editId` goes to `null`, `by` stays. The text is still Max's
 * in the record and in the outline; it has simply stopped being a *pending* edit, which is the
 * only thing the colour ever meant. The renderer colours on `[data-edit-id]` (`schema.ts`), so
 * the colour goes with the attribute.
 */
export function keepEdit(state: EditorState, edit: EditRef): Transaction | null {
  const tr = state.tr;
  const authorType = notesSchema.marks.author!;
  const changes: { from: number; to: number; by: DocAuthor; at: number }[] = [];

  state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const mark = node.marks.find((m) => m.type.name === 'author' && m.attrs.editId === edit.editId);
    if (!mark) return false;
    changes.push({
      from: pos,
      to: pos + node.nodeSize,
      by: mark.attrs.by as DocAuthor,
      at: (mark.attrs.at as number) ?? 0,
    });
    return false;
  });

  if (changes.length === 0) return null;
  for (const change of changes) {
    tr.removeMark(change.from, change.to, authorType);
    tr.addMark(change.from, change.to, authorType.create({ by: change.by, editId: null, at: change.at }));
  }
  return tr.steps.length > 0 ? tr : null;
}

// ── the ingest's windows (§2) ───────────────────────────────────────────────────────────────

/**
 * The document exactly as `emptyDoc()` left it: a title, and one empty paragraph after it that
 * carries no provenance. Returns where that paragraph is and how big it is, or null for anything
 * else — a second block, any text at all, a paragraph that has since been given a page.
 *
 * Deliberately strict. It is read once, before a window is inserted, and everything it refuses
 * is a document the learner may already be writing in.
 */
function pristineSeed(doc: Node): { pos: number; size: number } | null {
  if (doc.childCount !== 2) return null;
  const body = doc.child(1);
  if (body.type !== notesSchema.nodes.paragraph) return null;
  if (body.content.size !== 0) return null;
  const attrs = blockAttrs(body);
  if (attrs.pages.length > 0 || attrs.reason !== null) return null;
  return { pos: doc.child(0).nodeSize, size: body.nodeSize };
}

/**
 * **An ingest window only ever appends** (contract rule 5).
 *
 * "Long decks are ingested in page windows with a running outline so the notes stay cohesive;
 * the doc opens as soon as the first window lands and fills in behind a visible marker" (§2) —
 * and the learner is reading, and may already be writing, while that happens. So there is no
 * guard case here: the one thing this can do is add after `afterBlockId`, or at the end when the
 * previous window's last block is gone (the learner deleted it) or there is no previous window.
 */
export function appendWindow(
  state: EditorState,
  afterBlockId: string | null,
  blocks: readonly DocBlockDraft[],
): Transaction {
  return appendNodes(state, afterBlockId, draftToNodes(notesSchema, blocks, 'ingest', null));
}

/**
 * **The same append, for nodes that already exist** (2026-09-23).
 *
 * `appendWindow` mints fresh block ids every time it runs, and it used to run twice per window —
 * once in main for the stored document and once in the renderer for the open one — so the two
 * copies of a window had different ids. The renderer's next save conflicted, `#rebase` appended
 * the stored blocks it "did not have" by id, and **every window landed twice** (35–45 % of the
 * blocks in every multi-window deck in the live profile). Main now sends the nodes it inserted,
 * ids and all, and the renderer inserts exactly those.
 */
export function appendNodes(state: EditorState, afterBlockId: string | null, nodes: readonly Node[]): Transaction {
  const tr = state.tr;
  if (nodes.length === 0) return tr;
  const target = afterBlockId ? blockPos(tr.doc, afterBlockId) : null;
  const where = target ? target.pos + target.node.nodeSize : tr.doc.content.size;
  const seed = pristineSeed(tr.doc);
  tr.insert(where, Fragment.fromArray(nodes));
  /**
   * **The seed paragraph goes when the notes arrive.**
   *
   * `emptyDoc()` has to put an empty paragraph under the title, because the schema's `doc` is
   * `block+` and a title alone is not a document — and while the ingest runs it is also where
   * the learner can type. The moment the first window lands it is neither: it is an empty block
   * with no `pages` and no `reason`, which is precisely what §2 calls a bug in the ingest, and
   * the provenance chip agrees with it on screen in amber — "no source", between the title and
   * the first heading, on every freshly ingested deck.
   *
   * Only the *pristine* seed is taken (title + one empty, provenance-less paragraph, measured
   * before the insert): once the learner has typed anywhere, any empty paragraph in the document
   * is theirs — the caret may be sitting in it — and §5.4 says an agent never removes their text
   * or their place in it.
   */
  if (seed) {
    const from = tr.mapping.map(seed.pos);
    tr.delete(from, from + seed.size);
  }
  return tr;
}

/**
 * **Update overview's carry-over** (`docs/research/notebooks.md` §2; #58).
 *
 * > Updating rewrites only the overview's own AI-written blocks. The learner's text, and agent
 * > edits the learner kept, carry over under the section with the matching heading, or, when no
 * > section matches, under a final *Earlier notes* heading.
 *
 * Pure: ProseMirror nodes in, nodes out, no database and no model. What is carried is decided per
 * **top-level block**:
 *
 *  - a block with any learner-authored text (`author.by === 'user'`) is carried **whole and
 *    untouched**, so the learner's words come out byte-identical, marks and all. A block where the
 *    learner typed into an ingest paragraph keeps that paragraph's ingest words too: splitting it
 *    would move their sentence away from what it was written against;
 *  - a block an agent edit the learner **kept** created or touched (`notes_doc_edits.status =
 *    'kept'`, its `blockIds`) is carried whole;
 *  - everything else was written by the ingest, or by an agent edit still pending or never kept,
 *    and is dropped. Those are the overview's own blocks and what Regenerate also drops.
 *
 * Where it goes: under the new section whose H2 matches a heading the block sat under in the old
 * doc (innermost first, case- and punctuation-insensitive), just before that section's your-note
 * slot. A carried **your-note slot** the learner wrote in takes the new section's empty slot's
 * place rather than sitting beside it. Anything that matches nothing goes, in its old order, under
 * a final H2 *Earlier notes*.
 */
import type { Node } from 'prosemirror-model';
import { NOTE_SLOT_REASON } from '../../shared/doc/types.js';
import { blockAttrs, hasLearnerText, newBlockId, notesSchema } from '../../shared/doc/schema.js';
import { inlineToNodes } from '../../shared/doc/inline.js';
import { EARLIER_NOTES_HEADING, EARLIER_NOTES_REASON } from './overview.js';

/** Lower-case, NFKC, punctuation dropped, whitespace folded: "Heuristics — h_max!" ~ "heuristics h max". */
export function normaliseHeading(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CarryStats {
  /** Top-level blocks carried. */
  carried: number;
  /** Of those, how many went under *Earlier notes*. */
  earlier: number;
  /** Of those, how many hold learner text. */
  learnerBlocks: number;
  /** Of those, how many were carried because of a kept agent edit (and hold no learner text). */
  keptBlocks: number;
}

/** True when the node or anything inside it has one of these block ids. */
function touchesAny(node: Node, ids: ReadonlySet<string>): boolean {
  if (ids.size === 0) return false;
  if (ids.has(blockAttrs(node).blockId)) return true;
  let hit = false;
  node.descendants((child) => {
    if (hit) return false;
    const id = (child.attrs as { blockId?: unknown }).blockId;
    if (typeof id === 'string' && ids.has(id)) hit = true;
    return !hit;
  });
  return hit;
}

function isSlot(node: Node): boolean {
  return node.type.name === 'paragraph' && blockAttrs(node).reason === NOTE_SLOT_REASON;
}

interface Carried {
  node: Node;
  /** Normalised texts of the headings it sat under, innermost first. */
  under: string[];
  learner: boolean;
}

/**
 * The blocks of `old` that survive an update, with the headings they sat under. The old title
 * (the first H1 with `reason: 'title'`) never carries unless the learner wrote in it.
 */
export function carriedBlocks(old: Node, keptBlockIds: ReadonlySet<string>): Carried[] {
  const out: Carried[] = [];
  const stack: { level: number; text: string }[] = [];
  old.forEach((node) => {
    const learner = hasLearnerText(node);
    const kept = !learner && touchesAny(node, keptBlockIds);
    if (node.type.name === 'heading') {
      const level = node.attrs.level as number;
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
      if (learner || kept) out.push({ node, under: stack.map((h) => h.text).reverse(), learner });
      stack.push({ level, text: normaliseHeading(node.textContent) });
      return;
    }
    if (!learner && !kept) return;
    // A slot the learner never typed in is the overview's own; only a written one is theirs.
    if (isSlot(node) && !learner && node.textContent.trim().length === 0) return;
    out.push({ node, under: stack.map((h) => h.text).reverse(), learner });
  });
  return out;
}

/**
 * The new document's top-level nodes with the old document's carried blocks placed in it.
 *
 * `fresh` is the new overview, title first, as `mintOverview` made it. `old` is the stored
 * document at the moment the new overview landed (null when there is none).
 */
export function carryOver(
  old: Node | null,
  fresh: readonly Node[],
  keptBlockIds: ReadonlySet<string>,
): { nodes: Node[]; stats: CarryStats } {
  const stats: CarryStats = { carried: 0, earlier: 0, learnerBlocks: 0, keptBlocks: 0 };
  if (!old) return { nodes: [...fresh], stats };
  const carried = carriedBlocks(old, keptBlockIds);
  if (carried.length === 0) return { nodes: [...fresh], stats };

  // ── the new doc's sections: each H2, where its slot is, and what it is called ──
  interface Section {
    key: string;
    /** Index in `fresh` of the H2. */
    start: number;
    /** Index in `fresh` of the slot, or -1. */
    slot: number;
    /** Index in `fresh` one past the section's last block. */
    end: number;
    /** What goes before the slot. */
    before: Node[];
    /** A carried written slot, which replaces the new empty one. */
    slotReplacement: Node | null;
  }
  const sections: Section[] = [];
  fresh.forEach((node, i) => {
    if (node.type.name === 'heading' && (node.attrs.level as number) <= 2 && i > 0) {
      if (sections.length > 0) sections[sections.length - 1]!.end = i;
      sections.push({ key: normaliseHeading(node.textContent), start: i, slot: -1, end: fresh.length, before: [], slotReplacement: null });
      return;
    }
    const current = sections[sections.length - 1];
    if (current && isSlot(node) && current.slot === -1) current.slot = i;
  });
  const byKey = new Map<string, Section>();
  for (const section of sections) if (section.key && !byKey.has(section.key)) byKey.set(section.key, section);

  const earlier: Node[] = [];
  for (const item of carried) {
    stats.carried += 1;
    if (item.learner) stats.learnerBlocks += 1;
    else stats.keptBlocks += 1;
    const home = item.under.map((key) => byKey.get(key)).find((s): s is Section => s !== undefined);
    if (!home) {
      earlier.push(item.node);
      stats.earlier += 1;
      continue;
    }
    if (isSlot(item.node) && item.learner && home.slot !== -1 && home.slotReplacement === null) {
      // The learner's own note takes the new slot's place, citing the new section's pages so it
      // still maps to the section's objectives. Only the attrs change; the text is theirs, as is.
      const slotPages = blockAttrs(fresh[home.slot]!).pages;
      home.slotReplacement = item.node.type.create(
        { ...item.node.attrs, pages: [...slotPages] },
        item.node.content,
        item.node.marks,
      );
      continue;
    }
    home.before.push(item.node);
  }

  // ── reassemble ──
  const nodes: Node[] = [];
  const sectionAt = new Map(sections.map((s) => [s.start, s]));
  let current: Section | null = null;
  fresh.forEach((node, i) => {
    const starts = sectionAt.get(i);
    if (starts) {
      if (current && current.slot === -1) nodes.push(...current.before);
      current = starts;
    }
    if (current && i === current.slot) {
      nodes.push(...current.before);
      nodes.push(current.slotReplacement ?? node);
      return;
    }
    nodes.push(node);
  });
  if (current !== null && (current as Section).slot === -1) nodes.push(...(current as Section).before);

  if (earlier.length > 0) {
    nodes.push(
      notesSchema.nodes.heading!.create(
        { level: 2, blockId: newBlockId(), pages: [], reason: EARLIER_NOTES_REASON, objectiveIds: [] },
        inlineToNodes(notesSchema, EARLIER_NOTES_HEADING, 'ingest', null),
      ),
      ...earlier,
    );
  }
  return { nodes, stats };
}

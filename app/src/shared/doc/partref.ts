/**
 * **A tutorial part copied elsewhere is a reference, not a second part** (2026-10-04).
 *
 * Copying a part's words to a later problem, to read them while answering it, is a good habit
 * (Lucas, dogfooding Tutorial 1: Problem 3 A) i.–iii. copied into 3 B)). What it produced was
 * wrong: each copy pasted as a live `tut_part`, nested inside 3 B)'s own part, with the same
 * `partId` as the original. Two parts with one id are one record in main (`tutorial_parts`), so a
 * Check on the copy is a Check on the original, its chrome draws twice, and a part inside a part
 * is not a shape the sheet can have. Blanks copied the same way kept their `blankId`.
 *
 * So, on paste (`referencePastedParts`):
 *  - a phrase or a few lines copied from **inside** one part (or one answer slot) paste as just
 *    those words: the wrapper the selection was open in is dropped;
 *  - a **whole part** whose id is still in the document pastes as a reference: a line saying
 *    which part it is from, then its blocks, with each blank as its text (`[¬A]`) and each set of
 *    choices as lines. A part whose id is no longer in the document (it was cut, to move it) stays
 *    a live part;
 *  - an answer slot copied whole pastes as its contents: a slot belongs to its part;
 *  - a blank whose id is still in the document pastes as its text.
 *
 * And when a document is opened (`unnestCopiedParts`): every part after the first with the same id,
 * and any part inside another part, is put right the same way, so the copies already made become
 * references and keep every word the learner wrote around them. A nested part with a unique id is
 * lifted out after its container rather than flattened: it is the only copy of that part.
 *
 * Pure: schema in, nodes out.
 */
import { Fragment, Slice, type Node } from 'prosemirror-model';
import { blankText, choicesText, notesSchema } from './schema.js';

const WRAPPERS = new Set(['tut_part', 'tut_answer']);

/** Every `partId` and `blankId` in a document. */
export function liveTutorialIds(doc: Node): { parts: Set<string>; blanks: Set<string> } {
  const parts = new Set<string>();
  const blanks = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === 'tut_part' && node.attrs.partId) parts.add(node.attrs.partId as string);
    if (node.type.name === 'tut_blank' && node.attrs.blankId) blanks.add(node.attrs.blankId as string);
    return true;
  });
  return { parts, blanks };
}

/** A fresh copy of a block's attrs without its id, so the minter gives the copy its own. */
function freshAttrs(node: Node): Record<string, unknown> {
  const attrs = { ...node.attrs };
  if ('blockId' in attrs) attrs.blockId = '';
  return attrs;
}

/** Blanks whose ids are taken become their text, everywhere inside `node`'s content. */
function mapInline(fragment: Fragment, takenBlanks: ReadonlySet<string> | 'all'): Fragment {
  const out: Node[] = [];
  fragment.forEach((child) => {
    if (child.type.name === 'tut_blank' && (takenBlanks === 'all' || takenBlanks.has(child.attrs.blankId as string))) {
      out.push(notesSchema.text(blankText((child.attrs.value as string) ?? ''), child.marks));
      return;
    }
    out.push(child.isLeaf ? child : child.copy(mapInline(child.content, takenBlanks)));
  });
  return Fragment.fromArray(out);
}

/** The choices as a plain list: `[x] i. H1 (P1,P3) …`, one item a line. */
function choicesAsList(node: Node): Node {
  const lines = choicesText(node).split('\n').filter((line) => line.trim().length > 0);
  const items = (lines.length > 0 ? lines : ['(no options)']).map((line) =>
    notesSchema.nodes.list_item!.create({}, notesSchema.nodes.paragraph!.create({}, notesSchema.text(line))),
  );
  return notesSchema.nodes.bullet_list!.create({}, items);
}

/** A block of a referenced part, with every live control turned to text. */
function referenceBlocks(node: Node): Node[] {
  switch (node.type.name) {
    case 'tut_part':
      return partAsReference(node);
    case 'tut_answer': {
      const out: Node[] = [];
      node.forEach((child) => out.push(...referenceBlocks(child)));
      return out;
    }
    case 'tut_choices':
      return [choicesAsList(node)];
    default:
      return [node.type.create(freshAttrs(node), node.isLeaf ? null : mapInline(node.content, 'all'), node.marks)];
  }
}

/**
 * A part as reference blocks: *From Problem 3 A) i.:* on its own line, citing the part's pages so
 * its chip still opens the sheet, then the part's blocks with blanks and choices as text.
 */
export function partAsReference(part: Node): Node[] {
  const label = (part.attrs.label as string) || 'another part';
  const heading = notesSchema.nodes.paragraph!.create(
    { blockId: '', pages: (part.attrs.pages as number[] | undefined) ?? [], reason: null, objectiveIds: [] },
    notesSchema.text(`From ${label}:`, [notesSchema.marks.em!.create()]),
  );
  const out: Node[] = [heading];
  part.forEach((child) => out.push(...referenceBlocks(child)));
  return out;
}

/** Replace the child at `index` of `fragment` with `nodes`. */
function spliceChild(fragment: Fragment, index: number, nodes: readonly Node[]): Fragment {
  const children: Node[] = [];
  fragment.forEach((child, _offset, i) => {
    if (i === index) children.push(...nodes);
    else children.push(child);
  });
  return Fragment.fromArray(children);
}

/** The paste rule, as a `transformPasted`. `live` is the document's ids at the moment of the paste. */
export function referencePastedParts(slice: Slice, live: { parts: ReadonlySet<string>; blanks: ReadonlySet<string> }): Slice {
  let content = slice.content;
  let openStart = slice.openStart;
  let openEnd = slice.openEnd;
  let changed = false;

  // A selection that began or ended inside a part or a slot: drop the wrapper it was open in.
  for (let guard = 0; guard < 8; guard++) {
    const first = content.firstChild;
    if (openStart > 0 && first && WRAPPERS.has(first.type.name)) {
      const alone = content.childCount === 1;
      content = spliceChild(content, 0, childrenOf(first));
      openStart -= 1;
      if (alone && openEnd > 0) openEnd -= 1;
      changed = true;
      continue;
    }
    const last = content.lastChild;
    if (openEnd > 0 && last && WRAPPERS.has(last.type.name) && content.childCount > 1) {
      content = spliceChild(content, content.childCount - 1, childrenOf(last));
      openEnd -= 1;
      changed = true;
      continue;
    }
    break;
  }

  // Whole parts, slots and choices at the top of what is pasted.
  const out: Node[] = [];
  content.forEach((child, _offset, index) => {
    const atOpenEdge = (index === 0 && openStart > 0) || (index === content.childCount - 1 && openEnd > 0);
    if (!atOpenEdge && child.type.name === 'tut_part' && live.parts.has(child.attrs.partId as string)) {
      out.push(...partAsReference(child));
      changed = true;
      return;
    }
    if (!atOpenEdge && child.type.name === 'tut_answer') {
      child.forEach((inner) => out.push(inner));
      changed = true;
      return;
    }
    if (!atOpenEdge && child.type.name === 'tut_choices') {
      out.push(choicesAsList(child));
      changed = true;
      return;
    }
    out.push(child);
  });
  content = Fragment.fromArray(out);

  // Blanks that would collide with one already in the document, wherever they are.
  const mapped = mapInline(content, live.blanks);
  if (!mapped.eq(content)) {
    content = mapped;
    changed = true;
  }
  return changed ? new Slice(content, openStart, openEnd) : slice;
}

function childrenOf(node: Node): Node[] {
  const out: Node[] = [];
  node.forEach((child) => out.push(child));
  return out;
}

/**
 * The repair on open: a part after the first with its id, or inside another part, becomes a
 * reference; a nested part with a unique id is lifted out to follow its container. Returns the
 * same document when there is nothing to put right.
 */
export function unnestCopiedParts(doc: Node): Node {
  let needed = false;
  const seen = new Set<string>();
  doc.descendants((node, _pos, parent) => {
    if (node.type.name !== 'tut_part') return true;
    const id = node.attrs.partId as string;
    if ((id && seen.has(id)) || (parent && parent.type.name !== 'doc')) needed = true;
    if (id) seen.add(id);
    return true;
  });
  if (!needed) return doc;

  // A nested part whose id is also a top-level part's is the copy, wherever it comes in the sheet.
  const topIds = new Set<string>();
  doc.forEach((node) => {
    if (node.type.name === 'tut_part' && node.attrs.partId) topIds.add(node.attrs.partId as string);
  });
  const used = new Set<string>();
  const top: Node[] = [];
  doc.forEach((node) => {
    if (node.type.name !== 'tut_part') {
      top.push(node);
      return;
    }
    const id = node.attrs.partId as string;
    if (id && used.has(id)) {
      top.push(...partAsReference(node));
      return;
    }
    if (id) used.add(id);
    const lifted: Node[] = [];
    const inner = repairInside(node, used, topIds, lifted);
    top.push(inner, ...lifted);
  });
  return doc.type.create(doc.attrs, top, doc.marks);
}

/** A part's content with every nested part dealt with: a duplicate as a reference, a unique one lifted. */
function repairInside(node: Node, used: Set<string>, topIds: ReadonlySet<string>, lifted: Node[]): Node {
  const children: Node[] = [];
  node.forEach((child) => {
    if (child.type.name === 'tut_part') {
      const id = child.attrs.partId as string;
      if (id && !used.has(id) && !topIds.has(id)) {
        used.add(id);
        lifted.push(repairInside(child, used, topIds, lifted));
      } else {
        children.push(...partAsReference(child));
      }
      return;
    }
    children.push(child.isLeaf || child.isTextblock ? child : repairInside(child, used, topIds, lifted));
  });
  if (children.length === 0) children.push(notesSchema.nodes.paragraph!.create());
  return node.copy(Fragment.fromArray(children));
}

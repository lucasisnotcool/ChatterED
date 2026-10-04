/**
 * **A tutorial sheet as a notes document** (2026-10-03, `docs/research/tutorials.md` §3).
 *
 * The sheet is copied faithfully — its headings, its words, its lists, its formulas, its figures
 * cropped from the page — and every part gets the slot its answer takes: a code block, a nested
 * list, a numbered list, paragraphs, a field where the sheet had a blank, a tick box on each
 * option. The sheet's words are `ingest`-authored and cited to the tutorial's page, as the
 * overview's are to the slides'; what the learner types is theirs, guarded as everywhere else.
 *
 * Pure (no view, no clock unless given): main builds the document with it at ingest, the tests and
 * the mock bridge with the same function.
 */

import { Fragment, type Mark, type Node } from 'prosemirror-model';
import type { SheetBlock, SheetPart, TutorialAnswerKind, TutorialSheet } from '../tutorial.js';
import { BLANK_TOKEN } from '../tutorial.js';
import { blockToInline, inlineToNodesWith } from './inline.js';
import { authorMark, blankText, blockAttrs, defaultImageWidth, eachBlock, newBlockId, notesSchema } from './schema.js';

/** `reason` on the sheet's own blocks, so the chrome and the agents can tell sheet from notes. */
export const SHEET_REASON = 'sheet';
/** `reason` on the sheet's housekeeping (sign-up, submission rules): dimmed and folded. */
export const SHEET_ADMIN_REASON = 'sheet_admin';
/** `reason` on a part's container. */
export const SHEET_PART_REASON = 'sheet_part';
/** `reason` on a part's answer slot. */
export const ANSWER_SLOT_REASON = 'answer_slot';

export interface TutorialDocOptions {
  /** The tutorial source's `pageBase`: its page 1 is notebook page `pageBase + 1`. */
  pageBase: number;
  /** The author mark's timestamp, for tests. */
  at?: number;
  /** Block ids, for tests. */
  newId?: () => string;
}

/**
 * The sheet → a document's JSON. Throws only on a sheet that could not have passed validation (a
 * part with no prompt is given an empty paragraph rather than refused).
 */
export function tutorialDocJson(sheet: TutorialSheet, options: TutorialDocOptions): unknown {
  return tutorialDoc(sheet, options).toJSON();
}

export function tutorialDoc(sheet: TutorialSheet, options: TutorialDocOptions): Node {
  const s = notesSchema.nodes;
  const mark = options.at === undefined ? authorMark('ingest', null) : authorMark('ingest', null, options.at);
  const id = options.newId ?? newBlockId;
  const page = (local: number): number[] => (Number.isInteger(local) && local >= 1 ? [options.pageBase + local] : []);
  const attrs = (local: number, reason: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    blockId: id(),
    pages: page(local),
    reason,
    objectiveIds: [],
    ...extra,
  });
  const inline = (text: string, blanks = false): Node[] => inlineWithBlanks(text, [mark], blanks);

  const block = (b: SheetBlock, inPart: boolean): Node[] => {
    const admin = 'admin' in b && b.admin === true;
    const reason = admin ? SHEET_ADMIN_REASON : SHEET_REASON;
    switch (b.type) {
      case 'heading':
        return [s.heading!.create(attrs(b.page, reason, { level: b.level }), inline(b.text))];
      case 'paragraph':
        return [s.paragraph!.create(attrs(b.page, reason), inline(b.text, inPart))];
      case 'list': {
        const items = b.items.map((item) =>
          s.list_item!.create(null, s.paragraph!.create({ blockId: '', pages: [], reason: null, objectiveIds: [] }, inline(item, inPart))),
        );
        if (items.length === 0) return [];
        return [(b.ordered ? s.ordered_list! : s.bullet_list!).create(attrs(b.page, reason), items)];
      }
      case 'math':
        return [s.math_block!.create(attrs(b.page, reason, { tex: b.tex }))];
      case 'code':
        return [s.code_block!.create(attrs(b.page, reason), b.text ? notesSchema.text(b.text, [mark]) : null)];
      case 'figure': {
        const rect = b.rect ? { ...b.rect } : null;
        const image = s.slide_image!.create({
          page: page(b.page)[0] ?? 1,
          rect,
          width: defaultImageWidth(rect),
          caption: b.caption,
        });
        return [s.paragraph!.create(attrs(b.page, reason), image)];
      }
      case 'part':
        return [part(b)];
    }
  };

  const part = (p: SheetPart): Node => {
    const children: Node[] = [];
    for (const b of p.prompt) if (b.type !== 'part') children.push(...block(b, true));
    if (children.length === 0) children.push(s.paragraph!.create(attrs(p.page, SHEET_REASON), inline(p.label)));
    const slot = answerSlot(p, (reason, extra) => attrs(p.page, reason, extra));
    if (slot) children.push(slot);
    return s.tut_part!.create(
      attrs(p.page, SHEET_PART_REASON, { partId: p.id, label: p.label, answerKind: p.answer.kind, origin: 'sheet' }),
      children,
    );
  };

  const title = s.heading!.create(
    { blockId: id(), pages: [], reason: 'title', objectiveIds: [], level: 1 },
    sheet.title.trim() ? notesSchema.text(sheet.title.trim(), [mark]) : null,
  );
  const body: Node[] = [title];
  for (const b of sheet.blocks) body.push(...block(b, false));
  if (body.length === 1) body.push(s.paragraph!.create({ blockId: id(), pages: [], reason: null, objectiveIds: [] }));
  const doc = s.doc!.create(null, body);
  doc.check();
  return doc;
}

/** Inline text with `{{blank:ID}}` turned into `tut_blank` nodes (only where blanks belong). */
function inlineWithBlanks(text: string, marks: readonly Mark[], blanks: boolean): Node[] {
  if (!blanks) return inlineToNodesWith(notesSchema, text.replace(BLANK_TOKEN, '____'), marks);
  const out: Node[] = [];
  let last = 0;
  for (const match of text.matchAll(BLANK_TOKEN)) {
    const at = match.index;
    if (at > last) out.push(...inlineToNodesWith(notesSchema, text.slice(last, at), marks));
    out.push(notesSchema.nodes.tut_blank!.create({ blankId: match[1], value: '' }));
    last = at + match[0].length;
  }
  if (last < text.length) out.push(...inlineToNodesWith(notesSchema, text.slice(last), marks));
  return out;
}

/** The slot under a part: empty, shaped for its answer. Blanks need none; their fields are inline. */
function answerSlot(p: SheetPart, attrs: (reason: string, extra?: Record<string, unknown>) => Record<string, unknown>): Node | null {
  const s = notesSchema.nodes;
  const empty = (): Node => s.paragraph!.create({ blockId: '', pages: [], reason: null, objectiveIds: [] });
  const item = (): Node => s.list_item!.create(null, empty());
  const blank = { blockId: '', pages: [], reason: null, objectiveIds: [] };
  switch (p.answer.kind) {
    case 'blanks':
      return null;
    case 'choice':
      return s.tut_choices!.create(
        attrs(ANSWER_SLOT_REASON, { multi: p.answer.multi, options: p.answer.options.map((o) => ({ ...o })), picked: [] }),
      );
    case 'code':
      return s.tut_answer!.create(attrs(ANSWER_SLOT_REASON, { answerKind: 'code' }), s.code_block!.create(blank));
    case 'tree':
      return s.tut_answer!.create(attrs(ANSWER_SLOT_REASON, { answerKind: 'tree' }), s.bullet_list!.create(blank, item()));
    case 'sequence':
      return s.tut_answer!.create(attrs(ANSWER_SLOT_REASON, { answerKind: 'sequence' }), s.ordered_list!.create(blank, item()));
    case 'text':
      return s.tut_answer!.create(attrs(ANSWER_SLOT_REASON, { answerKind: 'text' }), empty());
  }
}

// ── Reading the answers back ─────────────────────────────────────────────────────────────────

/** A part's answer as the saved document holds it: what a check judges and what Max is shown. */
export interface PartAnswer {
  partId: string;
  blockId: string;
  label: string;
  kind: TutorialAnswerKind;
  /** The sheet's words for the part, blanks shown with what is in them (`[____]` when empty). */
  prompt: string;
  /**
   * **The problem the part belongs to**: the sheet's words from the problem's heading down to the
   * part, earlier parts' prompts included and their answers left out. "Show a valid plan" means
   * nothing without the stem that says the table is always clear (live run, 3 Oct 2026: judged
   * on its own line, a correct plan was marked partial).
   */
  context: string;
  /** The slot's text (lists one item per line, nesting as two-space indents); '' when empty. */
  text: string;
  /** For `blanks`: each blank's value, by id. */
  blanks: Record<string, string>;
  /** For `choice`: the ticked option ids. */
  picked: string[];
  /** For `choice`: the options, as the sheet lists them. */
  options: { id: string; text: string }[];
  /** Whether anything at all has been answered. */
  empty: boolean;
  pages: number[];
}

/** Every part in the document, in order, each with the problem it belongs to as `context`. */
export function partAnswers(doc: Node): PartAnswer[] {
  const out: PartAnswer[] = [];
  let context: string[] = [];
  doc.forEach((node) => {
    if (node.type.name === 'heading' && (node.attrs.level as number) <= 2) {
      // A new problem: the context starts again at its heading. The title (level 1) does too.
      context = blockAttrs(node).reason === 'title' ? [] : [blockToInline(node)];
      return;
    }
    if (node.type.name === 'tut_part') {
      const answer = partAnswerOf(node, context.join('\n'));
      out.push(answer);
      // The earlier part's words, never its answer: a filled blank goes back to its rule.
      let bare = answer.prompt;
      for (const value of Object.values(answer.blanks)) if (value) bare = bare.split(blankText(value)).join(blankText(''));
      context.push(`${answer.label}: ${bare}`);
      return;
    }
    const reason = blockAttrs(node).reason;
    if (reason === SHEET_REASON) {
      const text = node.type.name === 'math_block' ? `$$${node.attrs.tex as string}$$` : blockToInline(node);
      if (text.trim()) context.push(text);
    }
  });
  return out;
}

export function partAnswerOf(part: Node, context = ''): PartAnswer {
  const blanks: Record<string, string> = {};
  let picked: string[] = [];
  let options: { id: string; text: string }[] = [];
  const prompt: string[] = [];
  const slot: string[] = [];
  part.forEach((child) => {
    child.descendants((n) => {
      if (n.type.name === 'tut_blank') blanks[n.attrs.blankId as string] = (n.attrs.value as string).trim();
      return true;
    });
    if (child.type.name === 'tut_answer') {
      slot.push(slotText(child));
    } else if (child.type.name === 'tut_choices') {
      picked = [...((child.attrs.picked as string[] | null) ?? [])];
      options = ((child.attrs.options as { id: string; text: string }[] | null) ?? []).map((o) => ({ id: o.id, text: o.text }));
    } else if (blockAttrs(child).reason === SHEET_REASON || blockAttrs(child).reason === null) {
      // The sheet's words, and anything the learner wrote between them (an agent's hint line has
      // its own reason and is left out: it is not the question).
      const text = blockToInline(child);
      if (text.trim()) prompt.push(text);
    }
  });
  const kind = (part.attrs.answerKind as TutorialAnswerKind) || 'text';
  const text = slot.join('\n').trim();
  const empty =
    kind === 'blanks'
      ? Object.values(blanks).every((v) => v.length === 0)
      : kind === 'choice'
        ? picked.length === 0
        : text.length === 0;
  return {
    partId: part.attrs.partId as string,
    blockId: blockAttrs(part).blockId,
    label: part.attrs.label as string,
    kind,
    prompt: prompt.join('\n'),
    context,
    text,
    blanks,
    picked,
    options,
    empty,
    pages: blockAttrs(part).pages,
  };
}

/** A slot's text: paragraphs on lines, list items as `- ` / `1. ` with two spaces per level. */
function slotText(slot: Node): string {
  const lines: string[] = [];
  const walk = (node: Node, depth: number): void => {
    node.forEach((child) => {
      if (child.type.name === 'bullet_list' || child.type.name === 'ordered_list') {
        let n = 1;
        child.forEach((item) => {
          const marker = child.type.name === 'ordered_list' ? `${String(n++)}. ` : '- ';
          let first = true;
          item.forEach((inner) => {
            if (inner.type.name === 'bullet_list' || inner.type.name === 'ordered_list') {
              walk(notesSchema.nodes.tut_answer!.create(null, inner), depth + 1);
            } else {
              const text = blockToInline(inner);
              if (!text.trim()) return;
              lines.push(`${'  '.repeat(depth)}${first ? marker : '  '}${text}`);
              first = false;
            }
          });
        });
      } else if (child.type.name === 'code_block') {
        if (child.textContent.trim()) lines.push(child.textContent);
      } else if (child.isBlock) {
        const text = blockToInline(child);
        if (text.trim()) lines.push(`${'  '.repeat(depth)}${text}`);
      }
    });
  };
  walk(slot, 0);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ── A re-read keeps the learner's answers ─────────────────────────────────────────────────────

/**
 * **The learner's answers carried into a re-read sheet**, by part id: the blanks by blank id, the
 * ticks by option id (an option that no longer exists drops its tick), the slot's content whole.
 * Parts the new reading lacks are returned, so main can put their answers under a final
 * *Earlier answers* heading rather than lose them.
 */
export function carryAnswers(previous: Node, next: Node): { doc: Node; orphans: Node[] } {
  const old = new Map<string, Node>();
  previous.descendants((node) => {
    if (node.type.name === 'tut_part') {
      old.set(node.attrs.partId as string, node);
      return false;
    }
    return true;
  });
  const used = new Set<string>();
  const s = notesSchema.nodes;
  const children: Node[] = [];
  next.forEach((node) => {
    if (node.type.name !== 'tut_part') {
      children.push(node);
      return;
    }
    const before = old.get(node.attrs.partId as string);
    if (!before) {
      children.push(node);
      return;
    }
    used.add(node.attrs.partId as string);
    const blanks = new Map<string, string>();
    let oldSlot: Node | null = null;
    let oldPicked: string[] = [];
    before.descendants((n) => {
      if (n.type.name === 'tut_blank') blanks.set(n.attrs.blankId as string, n.attrs.value as string);
      if (n.type.name === 'tut_answer') oldSlot = n;
      if (n.type.name === 'tut_choices') oldPicked = (n.attrs.picked as string[] | null) ?? [];
      return true;
    });
    const parts: Node[] = [];
    node.forEach((child) => {
      if (child.type.name === 'tut_answer' && oldSlot) {
        parts.push(s.tut_answer!.create(child.attrs, (oldSlot as Node).content));
      } else if (child.type.name === 'tut_choices') {
        const ids = new Set(((child.attrs.options as { id: string }[] | null) ?? []).map((o) => o.id));
        parts.push(child.type.create({ ...child.attrs, picked: oldPicked.filter((p) => ids.has(p)) }));
      } else {
        parts.push(withBlankValues(child, blanks));
      }
    });
    children.push(node.type.create(node.attrs, parts, node.marks));
  });
  const orphans = [...old.entries()].filter(([id]) => !used.has(id)).map(([, n]) => n);
  return { doc: s.doc!.create(null, children), orphans };
}

function withBlankValues(node: Node, values: ReadonlyMap<string, string>): Node {
  if (node.type.name === 'tut_blank') {
    const value = values.get(node.attrs.blankId as string);
    return value === undefined ? node : node.type.create({ ...node.attrs, value }, null, node.marks);
  }
  if (node.isLeaf) return node;
  const children: Node[] = [];
  node.forEach((child) => children.push(withBlankValues(child, values)));
  return node.copy(Fragment.from(children));
}

/** Every part's block id, by part id: what main maps `partId` to an addressable block with. */
export function partBlockIds(doc: Node): Map<string, string> {
  const out = new Map<string, string>();
  eachBlock(doc, (node) => {
    if (node.type.name === 'tut_part') out.set(node.attrs.partId as string, blockAttrs(node).blockId);
  });
  return out;
}

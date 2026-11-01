/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE TUTORIAL CHROME'S PURE HALF (`docs/research/tutorials.md` §3, §4, §7; S7 of the contract)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Everything the part chrome, the blank fields and the practice chips *decide*, without a view or
 * a DOM, so it is tested in node: what a part's status pill says, which rung the Hint button
 * offers next, which placeholder an empty slot shows, the order Tab walks the blanks in, and which
 * tutorial parts practise which section of the main notes. `tutorial.ts` draws it.
 */

import type { Node } from 'prosemirror-model';
import { blockAttrs } from '../../../shared/doc/schema.js';
import { SHEET_ADMIN_REASON } from '../../../shared/doc/tutorialdoc.js';
import type {
  HintLevel,
  TutorialAnswerKind,
  TutorialPartStatus,
  TutorialPartView,
  TutorialView,
} from '../../../shared/tutorial.js';

/** `reason` on the one line Max (or Ellie) writes under a part after help (S5). */
export const TUTOR_HINT_REASON = 'tutor_hint';

// ── the help ladder ─────────────────────────────────────────────────────────────────────────

/** The three rungs (`tutorials.md` §4), in the order Hint climbs them. */
export const HINT_RUNGS: readonly string[] = ['Point', 'Break it down', 'A worked step'];

const RUNG_TITLES: readonly string[] = [
  'Where the material is: the notes and the slides to look at, and what to look for',
  'The part as two to four sub-steps',
  'One step worked on a similar case from the lecture (not this part)',
];

/** The rung the next press of Hint gives, or null once all three have been taken. */
export function nextHintLabel(level: HintLevel): string | null {
  return level >= HINT_RUNGS.length ? null : HINT_RUNGS[level]!;
}

// ── the status pill ─────────────────────────────────────────────────────────────────────────

export interface StatusLook {
  /** The pill's words: `✓ correct`, `½ partial`, `✗ not yet`… */
  label: string;
  /** The glyph alone, for the compact practice chips ('' for untried). */
  glyph: string;
  /** Its tooltip: what the status means and who decided it. */
  title: string;
}

/**
 * The status the chrome shows. Main records `untried` until a check, so the chrome derives
 * *working* from the document itself: written in, not checked. An answer cleared back to nothing
 * reads untried again.
 */
export function shownStatus(view: Pick<TutorialPartView, 'status'> | null, answerEmpty: boolean): TutorialPartStatus {
  const status = view?.status ?? 'untried';
  if (status === 'untried' && !answerEmpty) return 'working';
  if (status === 'working' && answerEmpty) return 'untried';
  return status;
}

function judgedBy(checkedBy: TutorialPartView['checkedBy']): string {
  if (checkedBy === 'simulation') return 'Checked by code against the answer key or formal problem.';
  if (checkedBy === 'model') return 'Judged by Max against a worked answer. The official solution may phrase it differently.';
  return '';
}

export function statusLook(status: TutorialPartStatus, checkedBy: TutorialPartView['checkedBy'] = null): StatusLook {
  const by = judgedBy(checkedBy);
  const join = (first: string): string => (by ? `${first} ${by}` : first);
  switch (status) {
    case 'untried':
      return { label: 'untried', glyph: '', title: 'Nothing written yet.' };
    case 'working':
      return { label: 'working', glyph: '✎', title: 'Written in, not checked yet. Press Check answer when you are ready.' };
    case 'correct':
      return { label: '✓ correct', glyph: '✓', title: join('Correct. It counts in full towards your progress.') };
    case 'partial':
      return { label: '½ partial', glyph: '½', title: join('Partly right. Max says what is missing in the chat.') };
    case 'incorrect':
      return { label: '✗ not yet', glyph: '✗', title: join('Not yet. Max says what is right so far in the chat; try again.') };
    case 'revealed':
      return { label: 'revealed', glyph: '◌', title: 'You asked for the answer. It does not count towards your progress.' };
  }
}

// ── one part's chrome ───────────────────────────────────────────────────────────────────────

export interface PartChromeState {
  status: TutorialPartStatus;
  look: StatusLook;
  hintLevel: HintLevel;
  /** The Hint button's rung, or null when all three are used. */
  nextHint: string | null;
  hintTitle: string;
  /** Hint dots: `true` for each rung taken, three in all. */
  dots: boolean[];
  canCheck: boolean;
  checkTitle: string;
  /** Show answer appears after at least one check, until the answer has been shown. */
  canReveal: boolean;
}

export function partChromeState(view: TutorialPartView | null, answerEmpty: boolean): PartChromeState {
  const status = shownStatus(view, answerEmpty);
  const hintLevel = view?.hintLevel ?? 0;
  const nextHint = nextHintLabel(hintLevel);
  return {
    status,
    look: statusLook(status, view?.checkedBy ?? null),
    hintLevel,
    nextHint,
    hintTitle:
      nextHint === null
        ? view && view.attempts > 0
          ? 'You have had all three hints. A refresher, or Show answer, is still there.'
          : 'You have had all three hints. Try your answer, or ask for a refresher.'
        : `Hint ${String(hintLevel + 1)} of 3, from Max: ${RUNG_TITLES[hintLevel]!.toLowerCase()}`,
    dots: HINT_RUNGS.map((_, i) => i < hintLevel),
    canCheck: !answerEmpty,
    checkTitle: answerEmpty ? 'Write an answer first' : 'Max checks your answer and says what is right and what is missing',
    canReveal: (view?.attempts ?? 0) > 0 && status !== 'revealed',
  };
}

/** "Hints used: 2 of 3 (Point, Break it down)", the dots' tooltip. */
export function hintDotsTitle(level: HintLevel): string {
  if (level === 0) return 'No hints used yet';
  return `Hints used: ${String(level)} of 3 (${HINT_RUNGS.slice(0, level).join(', ')})`;
}

// ── the answer slot's placeholder ───────────────────────────────────────────────────────────

/**
 * The line an empty slot shows, shaped to the answer it takes. Read against the part's prompt so
 * a code slot on a Python sheet does not ask for PDDL.
 */
export function slotPlaceholder(kind: TutorialAnswerKind, prompt = ''): string {
  switch (kind) {
    case 'code':
      return /\bpddl\b/i.test(prompt) ? 'Write your PDDL here' : 'Write your code here';
    case 'tree':
      return /\bsearch\b/i.test(prompt)
        ? 'Your search tree as a nested list (Tab indents)'
        : 'Your tree as a nested list (Tab indents)';
    case 'sequence':
      return /\bplan\b/i.test(prompt) ? 'Your plan, one action per line' : 'Your steps, one per line';
    case 'text':
      return 'Your answer';
    case 'blanks':
    case 'choice':
      return '';
  }
}

/** Is a slot empty: no text and no image or other leaf the learner put there? */
export function slotIsEmpty(slot: Node): boolean {
  if (slot.textContent.trim().length > 0) return false;
  let leaf = false;
  slot.descendants((n) => {
    if (leaf) return false;
    if (n.isLeaf && !n.isText) leaf = true;
    return !leaf;
  });
  return !leaf;
}

/** The first textblock in a slot, relative to the slot's content start: where the placeholder goes. */
export function firstTextblock(slot: Node): { offset: number; node: Node } | null {
  let found: { offset: number; node: Node } | null = null;
  slot.descendants((n, offset) => {
    if (found) return false;
    if (n.isTextblock) {
      found = { offset, node: n };
      return false;
    }
    return true;
  });
  return found;
}

// ── the blanks, in the order Tab walks them ─────────────────────────────────────────────────

export interface BlankSpot {
  /** The blank node's position. */
  pos: number;
  blankId: string;
  /** The part it is in, or null for a blank outside one. */
  partId: string | null;
}

/** Every blank in the document, in reading order. */
export function blankSpots(doc: Node): BlankSpot[] {
  const out: BlankSpot[] = [];
  let part: string | null = null;
  let partEnd = -1;
  doc.descendants((node, pos) => {
    if (pos >= partEnd) part = null;
    if (node.type.name === 'tut_part') {
      part = node.attrs.partId as string;
      partEnd = pos + node.nodeSize;
    }
    if (node.type.name === 'tut_blank') out.push({ pos, blankId: node.attrs.blankId as string, partId: part });
    return true;
  });
  return out;
}

/** The blank after `pos` (dir 1) or before it (dir -1), strictly; null at either end. */
export function blankAfter(spots: readonly BlankSpot[], pos: number, dir: 1 | -1): BlankSpot | null {
  if (dir > 0) return spots.find((s) => s.pos > pos) ?? null;
  for (let i = spots.length - 1; i >= 0; i--) if (spots[i]!.pos < pos) return spots[i]!;
  return null;
}

/**
 * Tab from the sheet's words in a `blanks` part: the next blank of that part after the caret,
 * wrapping to the part's first. Null outside a part with blanks.
 */
export function blankFromCaret(spots: readonly BlankSpot[], partId: string, caret: number, dir: 1 | -1): BlankSpot | null {
  const own = spots.filter((s) => s.partId === partId);
  if (own.length === 0) return null;
  if (dir > 0) return own.find((s) => s.pos >= caret) ?? own[0]!;
  for (let i = own.length - 1; i >= 0; i--) if (own[i]!.pos < caret) return own[i]!;
  return own[own.length - 1]!;
}

// ── the sheet's housekeeping ────────────────────────────────────────────────────────────────

/** The top-level `sheet_admin` blocks, as `[from, to)` ranges in document order. */
export function adminRanges(doc: Node): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  doc.forEach((node, offset) => {
    if (blockAttrs(node).reason === SHEET_ADMIN_REASON) out.push({ from: offset, to: offset + node.nodeSize });
  });
  return out;
}

// ── "From the notes:" ───────────────────────────────────────────────────────────────────────

/**
 * The notes chips of a part: one per section heading its linked blocks fall under, in order,
 * each opening the first linked block of that section. Blocks whose heading is unknown are
 * folded into one plain "Notes" chip, so a link is never silently dropped.
 */
export function notesChips(blockIds: readonly string[], heading: (blockId: string) => string | null, max = 4): { blockId: string; label: string }[] {
  const out: { blockId: string; label: string }[] = [];
  const seen = new Set<string>();
  let unnamed: string | null = null;
  for (const id of blockIds) {
    const name = heading(id)?.trim() || null;
    if (name === null) {
      unnamed ??= id;
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ blockId: id, label: name });
  }
  if (unnamed !== null && out.length < max) out.push({ blockId: unnamed, label: 'Notes' });
  return out.slice(0, max);
}

/** `[3,4,5,7,9,10]` → `[[3,4,5],[7],[9,10]]`: one page chip per run. */
export function pageGroups(pages: readonly number[]): number[][] {
  const sorted = [...new Set(pages.filter((p) => Number.isInteger(p) && p > 0))].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const page of sorted) {
    const last = out[out.length - 1];
    if (last && page === last[last.length - 1]! + 1) last.push(page);
    else out.push([page]);
  }
  return out;
}

/** One group of a citation: `Lecture-complex v4.0 p. 3–5` → source and where (`p. 3–5`). */
export interface CitationGroup {
  /** The source's name as the citation gives it, or null when it names none (`p. 3–5`). */
  source: string | null;
  /** `p. 3–5`, `§2`, or '' for an image source (named only). */
  where: string;
}

/**
 * A citation's words (`citationLabel`: `Lecture p. 17 · Notes §3`, or `p. 17`) split back into
 * groups. A group that is only a place (`p. 3`), or `removed source`, has no source.
 */
export function splitCitation(label: string): CitationGroup[] {
  if (!label.trim()) return [];
  return label.split(' · ').map((raw) => {
    const group = raw.trim();
    if (group === 'removed source' || /^(p\.\s|§)/.test(group)) return { source: null, where: group };
    const at = Math.max(group.lastIndexOf(' p. '), group.lastIndexOf(' §'));
    if (at < 0) return { source: group, where: '' };
    return { source: group.slice(0, at).trim(), where: group.slice(at + 1).trim() };
  });
}

/** Where a source's name may be cut: after the end of a word. */
const WORD_BREAK = /[\s_\-.]/;

/**
 * **The short name of each source a sheet cites**, for its *From the notes* line: the words a
 * name shares at its start with another cited source's name are dropped, at a word break and
 * never down to nothing ("Lecture-complex v4.0" beside "Lecture-complex Notes" reads `v4.0`),
 * then it is cut to `max` with an ellipsis. Keyed by the name as the citation gives it.
 */
export function shortSourceLabels(names: readonly string[], max = 14): Map<string, string> {
  const unique = [...new Set(names)];
  const out = new Map<string, string>();
  unique.forEach((mine, i) => {
    let cut = 0;
    unique.forEach((other, j) => {
      if (j === i) return;
      let n = 0;
      while (n < mine.length && n < other.length && mine[n]!.toLowerCase() === other[n]!.toLowerCase()) n += 1;
      let at = -1;
      for (let k = 0; k < n; k += 1) if (WORD_BREAK.test(mine[k]!)) at = k;
      const rest = mine.slice(at + 1).trim();
      if (at >= 0 && rest.length >= 2 && at + 1 > cut) cut = at + 1;
    });
    const name = mine.slice(cut).trim() || mine;
    out.set(mine, name.length <= max ? name : `${name.slice(0, max - 1).trimEnd()}…`);
  });
  return out;
}

/**
 * The words of one page link on a part's *From the notes* line. With `short` null (the sheet cites
 * one source only, so naming it says nothing) the place alone, `p. 3–5`; otherwise each group's
 * short name in front, `v4.0 p. 3–5`.
 */
export function pageLinkLabel(citation: string, short: ReadonlyMap<string, string> | null): string {
  return splitCitation(citation)
    .map((group) => {
      if (group.source === null) return group.where;
      if (short === null) return group.where || group.source;
      return [short.get(group.source) ?? group.source, group.where].filter(Boolean).join(' ');
    })
    .join(' · ');
}

/**
 * The short names for a whole sheet's page links, from the citation of every page any part cites:
 * null when that is one source (or none), so the links read `p. 3–5`.
 */
export function sheetSourceLabels(allPagesCitation: string, max = 14): Map<string, string> | null {
  const names = [...new Set(splitCitation(allPagesCitation).flatMap((g) => (g.source === null ? [] : [g.source])))];
  return names.length <= 1 ? null : shortSourceLabels(names, max);
}

/**
 * The line's tooltip, the full list in full words:
 * `From the notes: Classical planning in PDDL · Lecture-complex v4.0 p. 3–5`.
 */
export function fromNotesTitle(notes: readonly { label: string }[], pageCitations: readonly string[]): string {
  const items = [...notes.map((n) => n.label), ...pageCitations.filter(Boolean)];
  return items.length === 0 ? '' : `From the notes: ${items.join(' · ')}`;
}

// ── practice chips under each section of the main notes ─────────────────────────────────────

export interface PracticePart {
  fileId: string;
  partId: string;
  label: string;
  status: TutorialPartStatus;
}

export interface PracticeGroup {
  fileId: string;
  /** The tutorial's short name: "Tutorial 1". */
  title: string;
  parts: PracticePart[];
}

export interface PracticeSection {
  headingBlockId: string;
  /** Where the chip row goes: just before the next H2, or the end (as the slide strip). */
  pos: number;
  groups: PracticeGroup[];
}

/** "Tutorial 1 Week 3: Real World Planning" → "Tutorial 1 Week 3". */
export function shortTutorialTitle(title: string, max = 28): string {
  const head = (title.split(/:|\s[–—-]\s/)[0] ?? title).trim() || title.trim() || 'Tutorial';
  return head.length > max ? `${head.slice(0, max - 1).trimEnd()}…` : head;
}

/**
 * **Which tutorial parts practise which section** (`tutorials.md` §7): for each H2 section of the
 * main notes, every part whose `links.notesBlockIds` names a block between that H2 and the next
 * (the heading itself included, and blocks nested in a container), grouped by tutorial in the
 * tutorials' order and each tutorial's part order. Sections with none are left out.
 */
export function practiceBySection(doc: Node, tutorials: readonly TutorialView[]): PracticeSection[] {
  const sections: { headingBlockId: string; ids: Set<string>; pos: number }[] = [];
  let current: { headingBlockId: string; ids: Set<string>; pos: number } | null = null;
  doc.forEach((node, offset) => {
    const isH2 = node.type.name === 'heading' && node.attrs.level === 2;
    if (isH2) {
      if (current) current.pos = offset;
      const id = blockAttrs(node).blockId;
      current = id ? { headingBlockId: id, ids: new Set([id]), pos: doc.content.size } : null;
      if (current) sections.push(current);
      return;
    }
    if (!current) return;
    const ids = current.ids;
    const own = blockAttrs(node).blockId;
    if (own) ids.add(own);
    node.descendants((child) => {
      const id = typeof child.attrs.blockId === 'string' ? (child.attrs.blockId as string) : '';
      if (id) ids.add(id);
      return true;
    });
  });

  const out: PracticeSection[] = [];
  for (const section of sections) {
    const groups: PracticeGroup[] = [];
    for (const tutorial of tutorials) {
      const parts = tutorial.parts
        .filter((p) => p.links.notesBlockIds.some((id) => section.ids.has(id)))
        .map((p) => ({ fileId: tutorial.fileId, partId: p.partId, label: p.label, status: p.status }));
      if (parts.length > 0) groups.push({ fileId: tutorial.fileId, title: shortTutorialTitle(tutorial.title), parts });
    }
    if (groups.length > 0) out.push({ headingBlockId: section.headingBlockId, pos: section.pos, groups });
  }
  return out;
}

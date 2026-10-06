/**
 * **Which section of the notes each slide belongs to** (the slide strips, 2026-10-03).
 *
 * The notes doc (a learning overview, contract C6) cites pages on every block, and the UI draws
 * the deck's slides in strips, one per section of the notes, so a learner reading *Heuristics*
 * sees the heuristics slides beside it. This module decides the strips. It is pure and
 * deterministic: the same doc, pages, page text and overrides always give the same groups, so the
 * renderer can recompute it on every doc change and nothing has to be stored except a learner's
 * own moves (`overrides`, persisted by `notes_slide_groups`, migration 025).
 *
 * **Why not "the pages each section's blocks cite"** (the grouping it replaces, in
 * `DocStore.sections()`). On a real overview (CS4246 Lecture 4, v4.0, 58 pages) that walk put the
 * H1 title in charge of a group that swallowed the objectives list's union of every objective's
 * pages, listed a page in several groups, sent a learner's Q block's pages to whichever section
 * the Q block happened to sit in, and dropped every page nobody cited (the section dividers, the
 * worked examples, the summaries) into one "Not in the notes" pile at the end. Every slide of a
 * section's run belongs with that section whether or not the overview named it, so the rules are:
 *
 *  1. **Sections are the top-level H2 headings**, in document order. The H1 title, the lede and
 *     the "By the end you can" heading and list are the overview's frame, not sections; the title
 *     and the objectives list cast no votes at all (the list cites the union of every objective's
 *     pages, so it would vote for every page). Blocks above the first H2 vote for the synthetic
 *     `opening` group. A heading carried over by Update overview (`EARLIER_NOTES_REASON`) or a
 *     heading that cites no pages of its own is **weak**: it anchors nothing, and gets a slide
 *     only when a block under it cites one that nothing else places. Its strip is still returned,
 *     so a learner can drag a slide into it.
 *  2. **The overview's frame anchors the pages it cites.** A page cited by a section's frame
 *     (its heading, its takeaway and the learner's note slot, all carrying the section's pages,
 *     weigh most; its key ideas next) goes to the section whose frame cites it most; ties go to
 *     the one whose other blocks also cite it, then to the one whose run of pages contains it,
 *     then to the earlier one. The lede's pages seed the opening unless they lie inside a
 *     section's run. **Blocks added since do not anchor**: Ellie's tables and notes, a figure, a
 *     Q block, anything with the learner's own text in it. They say where a page was *discussed*
 *     (a learner asks about p. 4 wherever their cursor is; Ellie's table row cites the reference
 *     list), not where it is taught; they break the frame's ties, and they keep a page out of
 *     "Other slides" when nothing else places it. A block citing a long list of pages (a
 *     learner's paragraph pasted with the objectives' union on it) is diluted in proportion.
 *  3. **Every other page follows the deck**: before the first anchored page it is the opening;
 *     between two pages of one section it is that section's; in a gap between two sections a
 *     short divider page ("Hierarchical Planning and Acting / Manage complexity") starts the next
 *     section and takes the rest of the gap with it, and with no divider the gap is split where
 *     the page text matches each neighbour best (without text, it goes to the next section);
 *     after the last anchored page, and from a References or Appendix page on, it is "Other
 *     slides" unless a block cites it or its text plainly belongs to a section. Without page text
 *     only the structural rules run. An agenda ("Topics", "Outline") before the second section's
 *     run is always the opening's: it lists every section and belongs to none.
 *  4. **A learner's override wins**, applied last, so dragging a slide to another strip is never
 *     second-guessed. An override names the section by its heading's `blockId` and also carries
 *     the heading's text, so a regenerated overview (new block ids) still finds a section with
 *     the same heading; an override whose section is gone is ignored, not misapplied.
 *
 * **Every page is in exactly one group.** A notebook's pages are notebook pages, possibly with
 * gaps where a source was removed; the function groups exactly the pages it is given, in their
 * order, and never needs to know which source a page came from. A text source (Markdown, a
 * Word file) is grouped by the same rules: its "pages" are its chunks.
 */

import type { Node } from 'prosemirror-model';
import { blockAttrs, blockPages, conceptCore, diagramText } from './schema.js';
import { NOTE_SLOT_REASON, OBJECTIVES_REASON } from './types.js';

// ── the public shape ─────────────────────────────────────────────────────────────────────────

/** A heading's `blockId`, or one of the two synthetic groups. */
export type SlideGroupKey = string;

export const OPENING_KEY = 'opening';
export const OTHER_KEY = 'other';
export const OPENING_TITLE = 'Opening';
export const OTHER_TITLE = 'Other slides';

/**
 * A learner's move of one slide to another strip. `title` is the heading's text when the move
 * was made: it is how the move survives a regenerated overview that minted new block ids.
 */
export interface SlideOverride {
  page: number;
  key: SlideGroupKey;
  title: string;
}

export interface SlideGroup {
  key: SlideGroupKey;
  /** The heading's text; 'Opening' / 'Other slides' for the two synthetic groups. */
  title: string;
  /** Null for `opening` and `other`. */
  headingBlockId: string | null;
  /**
   * The block the section ends at (its last top-level block before the next section heading, or
   * the doc's last block): where the UI draws the section's slide strip after. Null for `other`
   * (drawn at the end of the doc) and for `opening` (drawn after the objectives list / lede).
   */
  lastBlockId: string | null;
  /** Ascending. Each page given is in exactly one group overall. */
  pages: number[];
  /** The subset placed here by a learner override. */
  moved: number[];
}

export interface SlideGroupsInput {
  doc: Node;
  /** Every page to place: a deck's 1..N, or a notebook's pages (gaps allowed). */
  pages: readonly number[];
  /** A page's own text, when it is known. Without it only the structural rules run. */
  pageText?: (page: number) => string | null | undefined;
  overrides?: readonly SlideOverride[];
}

/** Why a page is where it is. For tests and for a debug overlay; the UI needs only the groups. */
export type PlacementWhy =
  | 'cited'
  | 'agenda'
  | 'front'
  | 'inside'
  | 'divider'
  | 'before-divider'
  | 'text'
  | 'gap'
  | 'back-matter'
  | 'tail'
  | 'override';

export interface SlidePlacement {
  page: number;
  key: SlideGroupKey;
  why: PlacementWhy;
}

// ── the weights (rule 2) ────────────────────────────────────────────────────────────────────

/** A section's heading, its takeaway and its note slot: what the overview says the section is. */
const W_SECTION = 3;
/** A key idea; the lede, for the opening. Among added blocks: Ellie's, a figure, a diagram. */
const W_BLOCK = 2;
/** A Q block, or any block with the learner's own text in it. */
const W_LEARNER = 1;
/** A weak section (carried over, or citing nothing itself) casts this fraction of its votes. */
const WEAK_FACTOR = 0.25;
/**
 * A block citing more pages than this is diluted to this many pages' worth. The overview's own
 * blocks cite "one or two pages, a short range at most" (the overview prompt); a section heading
 * cites its run, five to eight. Twenty-two is a table of contents.
 */
const DILUTE_AFTER = 8;

/** The carried-over heading's reason. Mirrors `main/notes/overview.ts` (shared may not import main). */
export const EARLIER_NOTES_REASON = 'carried over from before the overview was updated';
const TITLE_REASON = 'title';

// ── the page-text rules (rule 3) ─────────────────────────────────────────────────────────────

/** A page with at most this many words, boilerplate stripped, can be a section divider. */
const DIVIDER_MAX_WORDS = 8;
/** …and at most this many lines: a figure slide with eight scattered labels is not a divider. */
const DIVIDER_MAX_LINES = 4;
/**
 * A line on at least this share of the pages (and on at least three) is the deck's furniture:
 * the course title in the footer, the lecture name, "Example". Measured on the 58-page deck: the
 * footer is on 47 pages, the running title on 10, then nothing above 9.
 */
const BOILERPLATE_SHARE = 0.15;
/**
 * How much of an uncited tail or back-matter page's (IDF-weighted) vocabulary a section's words
 * and slides must cover before the page is that section's rather than "Other slides", and by how
 * much the best section must beat the runner-up. Measured on the 58-page deck: the Homework slide
 * against the "Next" section that names it, 0.46 (runner-up 0.33); a section's own uncited
 * summary slide, 0.33 (0.26); References, the appendix's tool slides and the like, 0.14 at most.
 */
const STRONG_OVERLAP = 0.3;
const STRONG_MARGIN = 1.2;
/** The neighbour's slides a gap page is compared with, nearest first. */
const NEIGHBOUR_PAGES = 4;

const BACK_MATTER =
  /^(references?|bibliography|appendix|appendices|homework|readings?|further readings?|suggested readings?|acknowledge?ments?|thank you|thanks|questions\??|q ?& ?a|the end)\b/;
const AGENDA =
  /^(topics|outline|agenda|contents|table of contents|overview|today|today'?s (lecture|plan|agenda|topics)|lecture outline|learning (objectives|outcomes)|objectives)$/;

const STOPWORDS = new Set(
  (
    'the and for are but not you all any can had her was one our out has him his how its may new now old see ' +
    'two way who did get let say she too use with that this from they will what when your been have into ' +
    'more only over such than them then there these those very which while where would could should about ' +
    'after again also because before being between both each few further here just most other same some ' +
    'through under until upon whom why yet via per etc using used uses within without ' +
    'example examples source sources notes note slide slides figure fig page'
  ).split(' '),
);

interface PageInfo {
  /** Content words (stopworded, stemmed), boilerplate lines dropped. */
  words: Set<string>;
  /** Words on the page's content lines, for the divider test. */
  wordCount: number;
  lineCount: number;
  /** The first content line, lower-cased letters and spaces. */
  title: string;
}

function lettersOf(line: string): string {
  return line.toLowerCase().replace(/[^a-z&'?]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function stem(word: string): string {
  if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function contentWords(text: string): string[] {
  return (text.normalize('NFKC').toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? [])
    .filter((w) => !STOPWORDS.has(w))
    .map(stem);
}

/**
 * Every page's text, read once: the furniture lines found across the deck and dropped, then the
 * title, the size and the vocabulary of what is left. IDF over the pages, so a word on every
 * slide ("planning", in a planning lecture) counts for nothing in an overlap.
 */
class PageTexts {
  readonly info = new Map<number, PageInfo>();
  readonly idf = new Map<string, number>();

  constructor(pages: readonly number[], pageText: (page: number) => string | null | undefined) {
    const raw = new Map<number, string[]>();
    for (const page of pages) {
      const text = pageText(page);
      if (typeof text !== 'string' || text.trim() === '') continue;
      raw.set(page, text.normalize('NFKC').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0));
    }
    const seen = new Map<string, number>();
    for (const lines of raw.values()) {
      for (const key of new Set(lines.map((l) => lettersOf(l.replace(/\d+/g, ' '))))) {
        if (key.length > 0) seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    const floor = Math.max(3, Math.ceil(BOILERPLATE_SHARE * raw.size));
    const furniture = (line: string): boolean => {
      if (/©|copyright|all rights reserved/i.test(line)) return true;
      const key = lettersOf(line.replace(/\d+/g, ' '));
      if (key.replace(/[^a-z]/g, '').length < 2) return true; // a page number, a stray symbol
      return (seen.get(key) ?? 0) >= floor;
    };
    const df = new Map<string, number>();
    for (const [page, lines] of raw) {
      const content = lines.filter((l) => !furniture(l));
      const text = content.join('\n');
      const words = new Set(contentWords(text));
      for (const w of words) df.set(w, (df.get(w) ?? 0) + 1);
      this.info.set(page, {
        words,
        wordCount: (text.match(/[A-Za-z]{2,}/g) ?? []).length,
        lineCount: content.length,
        title: lettersOf(content[0] ?? ''),
      });
    }
    const n = raw.size;
    for (const [w, count] of df) this.idf.set(w, Math.log((n + 1) / (count + 1)));
  }

  has(page: number): boolean {
    return this.info.has(page);
  }

  isDivider(page: number): boolean {
    const info = this.info.get(page);
    return !!info && info.wordCount > 0 && info.wordCount <= DIVIDER_MAX_WORDS && info.lineCount <= DIVIDER_MAX_LINES;
  }

  isBackMatter(page: number): boolean {
    const info = this.info.get(page);
    return !!info && BACK_MATTER.test(info.title);
  }

  isAgenda(page: number): boolean {
    const info = this.info.get(page);
    return !!info && AGENDA.test(info.title.replace(/[?&]/g, '').trim());
  }

  /** The share of the page's IDF mass that `vocab` covers: 0 to 1, 0 for a page with no text. */
  overlap(page: number, vocab: ReadonlySet<string>): number {
    const info = this.info.get(page);
    if (!info) return 0;
    let total = 0;
    let shared = 0;
    for (const w of info.words) {
      const weight = this.idf.get(w) ?? 0;
      total += weight;
      if (vocab.has(w)) shared += weight;
    }
    return total > 0 ? shared / total : 0;
  }

  wordsOf(page: number): ReadonlySet<string> {
    return this.info.get(page)?.words ?? new Set();
  }
}

// ── reading the doc (rule 1) ────────────────────────────────────────────────────────────────

interface Bucket {
  key: SlideGroupKey;
  title: string;
  headingBlockId: string | null;
  lastBlockId: string | null;
  weak: boolean;
  /** Weighted votes from the overview's own frame: heading, takeaway, key ideas, note slot, lede. */
  frame: Map<number, number>;
  /** Weighted votes from the blocks added since: Ellie's, a figure, a Q block, the learner's. */
  added: Map<number, number>;
  /** Weighted votes from inside a block only (a table's row, a diagram's node). */
  nested: Map<number, number>;
  /**
   * The section's own pages (its heading's, its takeaway's, its note slot's): its run in the deck
   * as the overview drew it. Not its ideas' pages: an idea may reach outside the run, and the run
   * is what decides a tie between two sections whose ideas cite the same slide.
   */
  core: Set<number>;
  /** The bucket's own words: heading, takeaway, ideas, and whatever else is written under it. */
  text: string[];
}

function bucket(key: string, title: string, headingBlockId: string | null): Bucket {
  return {
    key,
    title,
    headingBlockId,
    lastBlockId: null,
    weak: false,
    frame: new Map(),
    added: new Map(),
    nested: new Map(),
    core: new Set(),
    text: [],
  };
}

function vote(map: Map<number, number>, page: number, weight: number): void {
  map.set(page, (map.get(page) ?? 0) + weight);
}

/** Who wrote the text in a block. */
function authors(node: Node): Set<string> {
  const out = new Set<string>();
  node.descendants((child) => {
    if (!child.isText) return true;
    for (const mark of child.marks) {
      if (mark.type.name === 'author') out.add(String((mark.attrs as { by?: unknown }).by));
    }
    return false;
  });
  return out;
}

const validPage = (p: unknown): p is number => typeof p === 'number' && Number.isInteger(p) && p >= 1;

/**
 * A top-level block's pages: its `own` (its provenance, or a figure's page) and the ones only its
 * insides cite (`nested`: a table row, a diagram node, a paragraph inside a Q block). A row's
 * citation is a citation in passing ("Reference: NeurIPS 2024, p. 54") and is never enough on its
 * own to pull a slide out of "Other slides".
 */
function pagesOfBlock(node: Node): { own: number[]; nested: number[] } {
  const own = new Set<number>(blockAttrs(node).pages.filter(validPage));
  if (node.type.name === 'slide_figure' && validPage(node.attrs.page)) own.add(node.attrs.page);
  const nested = new Set<number>(blockPages(node).filter(validPage));
  node.descendants((child) => {
    if (!child.isBlock) return false;
    if (child.type.name === 'slide_figure' && validPage(child.attrs.page)) nested.add(child.attrs.page);
    for (const page of blockAttrs(child).pages) if (validPage(page)) nested.add(page);
    return true;
  });
  for (const page of own) nested.delete(page);
  return { own: [...own], nested: [...nested] };
}

function textOfBlock(node: Node): string {
  if (node.type.name === 'diagram') return diagramText(node);
  if (node.type.name === 'slide_figure') return String(node.attrs.caption ?? '');
  return node.textContent;
}

/**
 * The level that marks a section: 2, as the overview writes it. A doc with no H2 at all (a #48
 * full-notes doc written before the overview, or a learner's own) falls back to its H1s after the
 * title, so it is still grouped rather than all "Opening".
 */
function sectionLevel(doc: Node): number {
  let h1 = 0;
  let h2 = 0;
  doc.forEach((node, _offset, index) => {
    if (node.type.name !== 'heading') return;
    const level = node.attrs.level as number;
    if (level === 2) h2 += 1;
    if (level === 1 && blockAttrs(node).reason !== TITLE_REASON && index > 0) h1 += 1;
  });
  return h2 > 0 || h1 === 0 ? 2 : 1;
}

function readDoc(doc: Node): { opening: Bucket; sections: Bucket[] } {
  const opening = bucket(OPENING_KEY, OPENING_TITLE, null);
  const sections: Bucket[] = [];
  const level = sectionLevel(doc);
  let current: Bucket = opening;
  let previous: Node | null = null;

  for (let index = 0; index < doc.childCount; index += 1) {
    const node = doc.child(index);
    const attrs = blockAttrs(node);
    const isSection =
      node.type.name === 'heading' &&
      (node.attrs.level as number) === level &&
      attrs.reason !== TITLE_REASON &&
      !(level === 1 && index === 0);
    const { own, nested } = pagesOfBlock(node);
    if (isSection) {
      if (current !== opening && previous) current.lastBlockId = blockAttrs(previous).blockId || null;
      const n = sections.length;
      current = bucket(attrs.blockId || `section:${n}`, node.textContent.trim() || 'Untitled section', attrs.blockId || null);
      current.weak = attrs.reason === EARLIER_NOTES_REASON || own.length === 0;
      sections.push(current);
    }
    previous = node;
    if (attrs.reason === TITLE_REASON || attrs.reason === OBJECTIVES_REASON) continue;

    // A concept card (2026-10-06) is the overview's frame by its core line: Ellie extending its
    // depth, or the learner writing in it, does not make the card's slides stop being taught there.
    const core = conceptCore(node);
    const by = authors(core ?? node);
    const learner = node.type.name === 'q_block' || by.has('user');
    // The frame is what the overview itself wrote: text by the ingest and nobody else. A block the
    // learner has typed into has become theirs, and votes as theirs.
    const frame = isSection || attrs.reason === NOTE_SLOT_REASON || (!learner && by.size === 1 && by.has('ingest'));
    let weight: number;
    if (isSection || attrs.reason === NOTE_SLOT_REASON) weight = W_SECTION;
    // The takeaway: the ingest's own paragraph under a heading. Above the first heading the
    // ingest's paragraph is the lede, which summarises everything and so counts as a key idea.
    else if (frame && current !== opening && node.type.name === 'paragraph') weight = W_SECTION;
    else if (learner) weight = W_LEARNER;
    else weight = W_BLOCK;

    const dilute = (count: number): number => weight * Math.min(1, DILUTE_AFTER / Math.max(1, count));
    const ownShare = dilute(own.length);
    for (const page of own) {
      vote(frame ? current.frame : current.added, page, ownShare);
      if (weight === W_SECTION) current.core.add(page);
    }
    const nestedShare = dilute(own.length + nested.length);
    for (const page of nested) vote(current.nested, page, nestedShare);
    current.text.push(textOfBlock(node));
  }
  if (current !== opening && previous) current.lastBlockId = blockAttrs(previous).blockId || null;
  return { opening, sections };
}

// ── placing ─────────────────────────────────────────────────────────────────────────────────

function range(pages: ReadonlySet<number>): [number, number] | null {
  if (pages.size === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pages) {
    lo = Math.min(lo, p);
    hi = Math.max(hi, p);
  }
  return [lo, hi];
}

function contains(r: [number, number] | null, page: number): boolean {
  return !!r && page >= r[0] && page <= r[1];
}

const EPS = 1e-9;

/**
 * Where every page goes, with why. `slideGroups` is this, grouped; exported because the reasons
 * are what a test (and a debug overlay) wants to see.
 */
export function slidePlacements(input: SlideGroupsInput): SlidePlacement[] {
  return place(input).placements;
}

function place(input: SlideGroupsInput): { placements: SlidePlacement[]; opening: Bucket; sections: Bucket[] } {
  const deck = [...new Set(input.pages.filter(validPage))].sort((a, b) => a - b);
  const { opening, sections } = readDoc(input.doc);
  const strong = sections.filter((s) => !s.weak);
  const ranges = new Map(strong.map((s) => [s.key, range(s.core)]));
  const texts = input.pageText ? new PageTexts(deck, input.pageText) : null;
  const byKey = new Map<string, Bucket>([[OPENING_KEY, opening], ...sections.map((s) => [s.key, s] as const)]);

  const placed = new Map<number, { key: string; why: PlacementWhy }>();
  /** Pages the frame placed (or the agenda rule): what the deck-order rules lean on. */
  const anchors = new Set<number>();
  const put = (page: number, key: string, why: PlacementWhy): void => void placed.set(page, { key, why });

  // Agenda pages before the second section's run are the opening's, whoever cites them: a
  // "Topics" slide lists every section and belongs to none of them.
  const secondStart = strong.length >= 2 ? (ranges.get(strong[1]!.key)?.[0] ?? Infinity) : Infinity;

  // Rule 2: the pages the overview's frame cites. Only the frame anchors a page. Ellie's tables,
  // a learner's figure and their Q blocks break ties between sections the frame already names,
  // and otherwise wait for rule 3: they say where a page was *discussed*, not where it is taught.
  for (const page of deck) {
    if (texts?.isAgenda(page) && page < secondStart) {
      put(page, OPENING_KEY, 'agenda');
      anchors.add(page);
      continue;
    }
    // The lede seeds the opening, but a slide inside a section's run is that section's even when
    // the lede mentions it.
    const insideASection = strong.some((s) => contains(ranges.get(s.key) ?? null, page));
    const candidates = (insideASection ? strong : [opening, ...strong]).filter((b) => (b.frame.get(page) ?? 0) > 0);
    let best: Bucket | null = null;
    for (const b of candidates) {
      if (!best) {
        best = b;
        continue;
      }
      const diff = (b.frame.get(page) ?? 0) - (best.frame.get(page) ?? 0);
      const extra = (x: Bucket): number => (x.added.get(page) ?? 0) + (x.nested.get(page) ?? 0);
      const tie = Math.abs(diff) <= EPS;
      if (diff > EPS) best = b;
      else if (tie && extra(b) > extra(best) + EPS) best = b;
      else if (tie && Math.abs(extra(b) - extra(best)) <= EPS &&
        contains(ranges.get(b.key) ?? null, page) && !contains(ranges.get(best.key) ?? null, page)) best = b;
    }
    if (!best) continue;
    put(page, best.key, 'cited');
    anchors.add(page);
  }

  // Rule 3: the rest, run by run between anchors, in deck order.
  const anchorKey = (page: number): string => placed.get(page)!.key;
  const vocabOf = (b: Bucket, near: readonly number[]): Set<string> => {
    const vocab = new Set(contentWords(b.text.join('\n')));
    if (texts) for (const page of near) for (const w of texts.wordsOf(page)) vocab.add(w);
    return vocab;
  };
  /**
   * Where a page that the deck order would leave in "Other slides" goes instead: the section
   * whose blocks cite it themselves (a figure the learner placed, Ellie's note on it; weak
   * sections too, since nothing stronger claims it), else the section whose words and slides
   * plainly cover it, else nowhere.
   */
  const rescue = (page: number): { key: string; why: PlacementWhy } | null => {
    let best: Bucket | null = null;
    let bestScore = 0;
    for (const b of [opening, ...sections]) {
      const score = ((b.frame.get(page) ?? 0) + (b.added.get(page) ?? 0)) * (b.weak ? WEAK_FACTOR : 1);
      if (score > bestScore + EPS) {
        best = b;
        bestScore = score;
      }
    }
    if (best) return { key: best.key, why: 'cited' };
    if (!texts?.has(page)) return null;
    const scored = strong
      .map((s) => ({ key: s.key, score: texts.overlap(page, vocabOf(s, deck.filter((p) => anchors.has(p) && anchorKey(p) === s.key))) }))
      .sort((a, b) => b.score - a.score);
    const [first, second] = scored;
    const home = first && first.score >= STRONG_OVERLAP && first.score >= (second?.score ?? 0) * STRONG_MARGIN ? first.key : null;
    return home ? { key: home, why: 'text' } : null;
  };
  const toOther = (page: number, why: PlacementWhy): void => {
    const saved = rescue(page);
    put(page, saved?.key ?? OTHER_KEY, saved ? saved.why : why);
  };

  let i = 0;
  while (i < deck.length) {
    if (anchors.has(deck[i]!)) {
      i += 1;
      continue;
    }
    const start = i;
    while (i < deck.length && !anchors.has(deck[i]!)) i += 1;
    const run = deck.slice(start, i);
    const prev = start > 0 ? anchorKey(deck[start - 1]!) : null;
    const next = i < deck.length ? anchorKey(deck[i]!) : null;

    // From a References / Appendix / Homework page on, the run is back matter.
    const back = texts ? run.findIndex((p) => texts.isBackMatter(p)) : -1;
    const head = back >= 0 ? run.slice(0, back) : run;
    if (back >= 0) for (const page of run.slice(back)) toOther(page, 'back-matter');
    if (head.length === 0) continue;

    if (prev === null && next === null) {
      for (const page of head) toOther(page, 'tail');
    } else if (prev === null) {
      for (const page of head) put(page, OPENING_KEY, 'front');
    } else if (back >= 0) {
      // Before back matter the run is still the previous section's closing slides.
      for (const page of head) put(page, prev, 'gap');
    } else if (next === null) {
      // After the last page the overview cites, the deck has moved on from the notes.
      for (const page of head) toOther(page, 'tail');
    } else if (prev === next) {
      for (const page of head) put(page, prev, 'inside');
    } else {
      const divider = texts ? head.findIndex((p) => texts.isDivider(p)) : -1;
      let split = 0;
      let why: PlacementWhy = 'gap';
      if (divider >= 0) {
        split = divider;
        why = 'divider';
      } else if (texts && head.some((p) => texts.has(p))) {
        const prevNear = deck.slice(0, start).filter((p) => anchors.has(p) && anchorKey(p) === prev).slice(-NEIGHBOUR_PAGES);
        const nextNear = deck.slice(i).filter((p) => anchors.has(p) && anchorKey(p) === next).slice(0, NEIGHBOUR_PAGES);
        const prevVocab = vocabOf(byKey.get(prev)!, prevNear);
        const nextVocab = vocabOf(byKey.get(next)!, nextNear);
        // The split that fits best: everything before it reads like the previous section and
        // everything after like the next. Ties go to the earliest split.
        let bestScore = -Infinity;
        for (let k = 0; k <= head.length; k += 1) {
          let score = 0;
          head.forEach((p, j) => {
            score += texts.overlap(p, j < k ? prevVocab : nextVocab);
          });
          if (score > bestScore + EPS) {
            bestScore = score;
            split = k;
          }
        }
        why = 'text';
      }
      // With no text to go on (split 0): a gap between two sections is most often the next one's
      // divider and opening slides, so it goes forward.
      head.forEach((page, j) => {
        if (j < split) put(page, prev, why === 'divider' ? 'before-divider' : why);
        else put(page, next, why);
      });
    }
  }

  // Rule 4: the learner's moves.
  const sectionByTitle = new Map<string, string>();
  for (const s of sections) if (!sectionByTitle.has(s.title.trim())) sectionByTitle.set(s.title.trim(), s.key);
  const deckSet = new Set(deck);
  for (const o of input.overrides ?? []) {
    if (!deckSet.has(o.page)) continue;
    let key: string | null;
    if (o.key === OPENING_KEY || o.key === OTHER_KEY) key = o.key;
    else if (sections.some((s) => s.headingBlockId !== null && s.headingBlockId === o.key)) key = o.key;
    else key = sectionByTitle.get(o.title.trim()) ?? null;
    if (key !== null) put(o.page, key, 'override');
  }

  const placements = deck.map((page) => ({ page, ...(placed.get(page) ?? { key: OTHER_KEY, why: 'tail' as const }) }));
  return { placements, opening, sections };
}

/**
 * **The slide strips**: the opening (when it has a slide), every section in document order (even
 * an empty one, which the UI may hide; a learner can still drag a slide into it), then "Other
 * slides" (when it has one). Each page given is in exactly one group.
 */
export function slideGroups(input: SlideGroupsInput): SlideGroup[] {
  const { placements, opening, sections } = place(input);
  const groups: SlideGroup[] = [
    { key: OPENING_KEY, title: opening.title, headingBlockId: null, lastBlockId: null, pages: [], moved: [] },
    ...sections.map((s) => ({ key: s.key, title: s.title, headingBlockId: s.headingBlockId, lastBlockId: s.lastBlockId, pages: [], moved: [] })),
    { key: OTHER_KEY, title: OTHER_TITLE, headingBlockId: null, lastBlockId: null, pages: [], moved: [] },
  ];
  const byKey = new Map(groups.map((g) => [g.key, g]));
  for (const { page, key, why } of placements) {
    const group = byKey.get(key) ?? byKey.get(OTHER_KEY)!;
    group.pages.push(page);
    if (why === 'override') group.moved.push(page);
  }
  return groups.filter((g) => g.pages.length > 0 || (g.key !== OPENING_KEY && g.key !== OTHER_KEY));
}

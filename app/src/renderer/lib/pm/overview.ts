/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE OVERVIEW, READ BY THE EDITOR (`docs/research/notebooks.md` §2–§5, contract C1, C5, C6)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The rules the editor's chrome follows on a learning overview, kept pure so they can be tested
 * without a DOM: which blocks get the action toolbar, which empty paragraph is the learner's
 * note slot, which list is "By the end you can" and which fill each of its items shows, where a
 * section's recommended block is offered, what a citation chip says when the notebook has
 * several sources, and when the doc says the overview is out of date.
 *
 * **The doc is ordinary notes underneath.** The overview is not a new node type: its title, its
 * objectives, its note slots are headings, lists and paragraphs told apart by their provenance
 * `reason` (C6). So every rule here reads a block's attrs and nothing else, and a legacy notes doc
 * (no overview) gets the toolbar and the chips and none of the rest.
 */
import type { Node } from 'prosemirror-model';
import { blockAttrs, isStructuredBlock } from '../../../shared/doc/schema.js';
import {
  NOTE_SLOT_REASON,
  type OverviewMeta,
  type OverviewRecommendation,
  type ProgressFill,
  type ProgressView,
} from '../../../shared/doc/types.js';
import { citationLabel, type NotebookSourceView, type NotebookView } from '../../../shared/notebook.js';
import { taughtObjectives } from '../progressview.js';

/** C6: the title heading's reason. */
export const TITLE_REASON = 'title';
/** C5, C6: the "By the end you can" heading and the list under it. */
export const OBJECTIVES_REASON = 'objectives';

// ── the blocks ──────────────────────────────────────────────────────────────────────────────

/** The learner's own-note slot (C6): a paragraph whose reason is exactly `NOTE_SLOT_REASON`. */
export function isNoteSlot(node: Node): boolean {
  return node.type.name === 'paragraph' && blockAttrs(node).reason === NOTE_SLOT_REASON;
}

/** A slot the learner has not written in yet: it shows the placeholder. */
export function isEmptyNoteSlot(node: Node): boolean {
  return isNoteSlot(node) && node.content.size === 0;
}

/** The "By the end you can" list (C5): an `ordered_list` whose reason is `objectives`. */
export function isObjectivesList(node: Node): boolean {
  return node.type.name === 'ordered_list' && blockAttrs(node).reason === OBJECTIVES_REASON;
}

/** The overview's own scaffolding, which no chip and no toolbar sits on. */
function isScaffold(node: Node): boolean {
  const { reason } = blockAttrs(node);
  return reason === TITLE_REASON || reason === OBJECTIVES_REASON || reason === NOTE_SLOT_REASON;
}

/** Blocks with words in them that Explain, Example, Quiz me and Ask… can be about. */
const ACTIONABLE = new Set(['paragraph', 'bullet_list', 'ordered_list', 'code_block', 'math_block']);

/**
 * **Does this top-level block get the action toolbar** (`notebooks.md` §4.1)? A block of prose,
 * a list, code or maths with an id and some text. Not the title, the objectives, a note slot, a
 * heading (a section is not one idea), a Q block (it already is Max's question), a figure, or a
 * structured block (a table, a diagram, flashcards, a quiz, an infographic: each has its own
 * controls). An empty block has nothing to explain.
 */
export function hasToolbar(node: Node): boolean {
  if (!ACTIONABLE.has(node.type.name) || isStructuredBlock(node)) return false;
  if (!blockAttrs(node).blockId || isScaffold(node)) return false;
  return node.textContent.trim().length > 0;
}

/** Does this block get a provenance chip? Every block with an id, except the overview's scaffolding. */
export function showsChip(node: Node): boolean {
  return Boolean(blockAttrs(node).blockId) && !isScaffold(node);
}

/** The block's text as the doc shows it: the quote a block action or Ask… carries. */
export function blockQuote(node: Node): string {
  return node.textBetween(0, node.content.size, '\n', ' ').replace(/[ \t]+/g, ' ').trim();
}

// ── the chip's words (C1) ───────────────────────────────────────────────────────────────────

type CiteSource = Pick<NotebookSourceView, 'name' | 'kind' | 'pageBase' | 'pageCount'>;

/**
 * The chip's text. With the notebook's sources at hand, the pages are notebook pages and read
 * through `citationLabel` (`Lecture p. 17 · Notes §3`, or `p. 17` in a notebook of one PDF);
 * `fallback` is `provenanceLabel`, used for a block with no pages (its reason) and when no
 * notebook is open.
 */
export function chipLabel(
  pages: readonly number[],
  sources: readonly CiteSource[] | null | undefined,
  fallback: () => string,
): string {
  const clean = pages.filter((p) => Number.isInteger(p) && p > 0);
  if (clean.length === 0 || !sources || sources.length === 0) return fallback();
  return citationLabel(sources, clean);
}

// ── the objectives' fills (C5) ──────────────────────────────────────────────────────────────

export interface ObjectiveFillView {
  objectiveId: string;
  title: string;
  fill: ProgressFill;
}

/** The fills the list is decorated from: the taught objectives, in tree order (`progressview.ts`). */
export function objectiveFills(view: ProgressView | null): ObjectiveFillView[] {
  return taughtObjectives(view).map((o) => ({ objectiveId: o.objectiveId, title: o.title, fill: o.fill }));
}

function norm(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Which objective each list item shows. The list is written **in tree order** (C5), so item `i`
 * is objective `i`; but the learner can edit the list, so an item whose text is an objective's
 * title is matched by title first, and the rest take the objectives left over in order. An item
 * with no objective left gets none: a line the learner added has nothing to fill.
 */
export function fillsForItems(items: readonly string[], objectives: readonly ObjectiveFillView[]): (ObjectiveFillView | null)[] {
  const out: (ObjectiveFillView | null)[] = items.map(() => null);
  const used = new Set<number>();
  items.forEach((text, i) => {
    const at = objectives.findIndex((o, j) => !used.has(j) && norm(o.title) === norm(text) && norm(text) !== '');
    if (at >= 0) {
      out[i] = objectives[at]!;
      used.add(at);
    }
  });
  let next = 0;
  items.forEach((_, i) => {
    if (out[i]) return;
    while (next < objectives.length && used.has(next)) next++;
    if (next < objectives.length) {
      out[i] = objectives[next]!;
      used.add(next);
      next++;
    }
  });
  return out;
}

/** The fill in words, next to the bar, so the bar is never the only signal. */
export function fillMark(fill: ProgressFill): string {
  if (fill === 1) return 'done';
  if (fill === 0.5) return 'half';
  return '';
}

// ── sections and their recommended block (§5.3) ─────────────────────────────────────────────

/** One section of the overview: an H2 (or an H1 with no H2 under it) and the blocks to the next. */
export interface SectionSpan {
  headingBlockId: string;
  /** The last top-level block in the section with an id: where a recommended block is added. */
  lastBlockId: string;
  /** The document position just after that block: where the card is drawn. */
  end: number;
}

/**
 * The sections, each from a level-2 heading up to the next heading of level 2 or above. The
 * overview's sections are H2 (C6); a heading the learner typed at H3 stays inside its section.
 */
export function sectionSpans(doc: Node): SectionSpan[] {
  const out: SectionSpan[] = [];
  let current: SectionSpan | null = null;
  doc.forEach((node, offset) => {
    const isSectionHead = node.type.name === 'heading' && (node.attrs.level as number) <= 2;
    const { blockId } = blockAttrs(node);
    if (isSectionHead) {
      current = (node.attrs.level as number) === 2 && blockId
        ? { headingBlockId: blockId, lastBlockId: blockId, end: offset + node.nodeSize }
        : null;
      if (current) out.push(current);
      return;
    }
    if (current && blockId) {
      current.lastBlockId = blockId;
      current.end = offset + node.nodeSize;
    }
  });
  return out;
}

export interface RecommendationPlacement {
  recommendation: OverviewRecommendation;
  section: SectionSpan;
}

/**
 * The offered recommendations, each at the end of its section. A recommendation whose heading is
 * gone (the learner deleted the section, or an Update rewrote it) is not shown: it would have
 * nowhere to go.
 */
export function placeRecommendations(doc: Node, overview: OverviewMeta | null): RecommendationPlacement[] {
  if (!overview) return [];
  const spans = new Map(sectionSpans(doc).map((s) => [s.headingBlockId, s]));
  const out: RecommendationPlacement[] = [];
  for (const recommendation of overview.recommendations) {
    if (recommendation.status !== 'offered') continue;
    const section = spans.get(recommendation.headingBlockId);
    if (section) out.push({ recommendation, section });
  }
  return out;
}

/** The type's name on the card: "Recommended · Flashcards". */
export const BLOCK_KIND_NAME: Record<OverviewRecommendation['kind'], string> = {
  table: 'Table',
  diagram: 'Diagram',
  flashcards: 'Flashcards',
  quiz: 'Quiz',
  infographic: 'Infographic',
};

// ── the out-of-date banner (§2) ─────────────────────────────────────────────────────────────

export type OverviewBanner =
  | { kind: 'stale'; text: string; fingerprint: string }
  | { kind: 'legacy'; text: string; fingerprint: string };

function entries(fingerprint: string): string[] {
  return fingerprint.split(',').filter(Boolean);
}

/**
 * What the banner over the doc says, or null for none (`notebooks.md` §2: "Adding, ticking or
 * unticking a source never rewrites the overview silently").
 *
 *  - **Out of date**: the ticked, ready sources (`contextFingerprint`) are not the ones the
 *    overview was written from. Sources only added: *N new sources added. The overview doesn't
 *    cover them yet.* Anything else (one unticked or removed): *Sources changed since the
 *    overview was written.*
 *  - **Legacy**: a doc from before the overview (its notes were imported as they were): *These
 *    are your earlier notes. Make a short overview from them?*
 *
 * Nothing while the doc is not ready (it is being written), while nothing is ticked (there would
 * be nothing to write from), or once the learner said **Not now** to this very fingerprint.
 */
export function overviewBanner(input: {
  ready: boolean;
  hasDoc: boolean;
  overview: OverviewMeta | null;
  notebook: Pick<NotebookView, 'contextFingerprint'> | null;
  dismissed: string | null;
}): OverviewBanner | null {
  const { notebook, overview } = input;
  if (!notebook || !input.ready || !input.hasDoc) return null;
  const now = notebook.contextFingerprint;
  if (entries(now).length === 0) return null;
  if (!overview) {
    const key = `legacy:${now}`;
    if (input.dismissed === key) return null;
    return { kind: 'legacy', text: 'These are your earlier notes. Make a short overview from them?', fingerprint: key };
  }
  if (now === overview.fingerprint || input.dismissed === now) return null;
  const was = new Set(entries(overview.fingerprint));
  const is = entries(now);
  const added = is.filter((e) => !was.has(e)).length;
  const dropped = [...was].filter((e) => !is.includes(e)).length;
  const text =
    added > 0 && dropped === 0
      ? added === 1
        ? "1 new source added. The overview doesn't cover it yet."
        : `${String(added)} new sources added. The overview doesn't cover them yet.`
      : 'Sources changed since the overview was written.';
  return { kind: 'stale', text, fingerprint: now };
}

/** Which ticked sources an Update overview has not seen: their page images are sent first. */
export function unseenSources(fingerprint: string | null, sources: readonly Pick<NotebookSourceView, 'fileId' | 'pageBase'>[]): Set<string> {
  const was = new Set(entries(fingerprint ?? ''));
  return new Set(sources.filter((s) => !was.has(`${s.fileId}@${String(s.pageBase)}`)).map((s) => s.fileId));
}

// ── the empty notebook (brief §1) ───────────────────────────────────────────────────────────

export type NotebookEmpty =
  /** No sources at all. */
  | { kind: 'no_sources'; title: string; line: string }
  /** Sources, but none ticked and ready, and some still being read. */
  | { kind: 'reading'; title: string; line: string }
  /** Sources, all ready or failed, none ticked. */
  | { kind: 'none_ticked'; title: string; line: string }
  /** Every source failed. */
  | { kind: 'failed'; title: string; line: string };

/**
 * What the doc column says before there is an overview to show, or null when the overview can be
 * written (a ticked source is ready). Read only while the notebook has no doc yet.
 */
export function notebookEmpty(view: Pick<NotebookView, 'sources'> | null): NotebookEmpty | null {
  if (!view) return null;
  const { sources } = view;
  if (sources.length === 0) {
    return { kind: 'no_sources', title: 'Add a source to start', line: 'Drop slides, notes or readings here, or press Add sources.' };
  }
  if (sources.some((s) => s.enabled && s.status === 'ready')) return null;
  if (sources.some((s) => s.status === 'reading')) {
    return { kind: 'reading', title: 'Reading your sources…', line: 'The overview is written as soon as one is ready.' };
  }
  if (sources.every((s) => s.status === 'failed')) {
    return { kind: 'failed', title: 'None of these sources could be read', line: 'Add another source, or remove these and try again.' };
  }
  return { kind: 'none_ticked', title: 'Tick a source to start', line: 'The overview is written from the ticked sources.' };
}

/** "from 2 sources · about 4 min to read", for the doc's header. Empty without an overview. */
export function overviewMeta(overview: OverviewMeta | null): string {
  if (!overview) return '';
  const count = entries(overview.fingerprint).length;
  const minutes = Math.max(1, Math.round(overview.words / 200));
  const from = count === 1 ? 'from 1 source' : count > 1 ? `from ${String(count)} sources` : '';
  return [from, `about ${String(minutes)} min to read`].filter(Boolean).join(' · ');
}

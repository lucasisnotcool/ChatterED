/**
 * **The map of the notes** (#48, `docs/research/collab-doc.md` §3 and §6), pure and tested.
 *
 * An outline of the open file's lecture notes by idea — one entry per heading — with each entry
 * carrying how far the learner has got on the objectives its section covers. It is a **view over
 * what already exists**: the headings are the document's, the fills are the ledger's as they
 * arrive on the `ProgressView`, and nothing here generates anything or asks a model anything.
 *
 * Two things are decided in this file and nowhere else:
 *
 *  - **What a section is.** The blocks from a heading up to the next heading of the same or a
 *    higher level, so a `##` holds its `###`s and the deck's title holds the whole document. A
 *    parent's state is therefore the state of everything under it, which is what a learner reading
 *    an outline expects of one.
 *  - **Which objectives a section covers.** See `mapEntries`.
 *
 * Like `progressview.ts`, it computes no fill of its own. A section's state is only ever a
 * summary of fills the main process sent (§6: only the learner's own words move the bar), so the
 * map cannot disagree with the bar beside it.
 */
import type { ProgressFill, ProgressView } from '../../shared/doc/types.js';
import { taughtObjectives } from './progressview.js';

/**
 * One block of the notes, as much of it as the map needs. `level` is the heading's level, or
 * `null` for everything that is not a heading.
 */
export interface MapBlock {
  blockId: string;
  level: number | null;
  text: string;
  /** 1-based deck pages (the block's provenance, §2). */
  pages: number[];
}

/**
 * `unmapped` is not `none`. A section no objective covers (an agenda, a recap, a heading the
 * learner typed) has nothing to be behind on, and drawing it as "not started" would be the map
 * inventing a debt.
 */
export type MapFill = 'none' | 'partial' | 'complete' | 'unmapped';

export interface MapEntry {
  /** The heading's own block: where a click scrolls to. */
  blockId: string;
  level: number;
  title: string;
  /** The pages of every block in the section, deduplicated, ascending. */
  pages: number[];
  fill: MapFill;
  /** The taught objectives the section covers, in deck order. */
  objectiveIds: string[];
}

/** A heading the learner has emptied still opens a section, and still needs a name to click. */
const UNTITLED = 'Untitled section';

/**
 * A section's state from the fills of the objectives mapped to it: complete when every one is
 * at 1, none when every one is at 0, partial otherwise — so one half-answer, or one complete
 * objective beside an untouched one, both read as "partly".
 */
export function sectionFill(fills: readonly ProgressFill[]): MapFill {
  if (fills.length === 0) return 'unmapped';
  if (fills.every((fill) => fill === 1)) return 'complete';
  if (fills.every((fill) => fill === 0)) return 'none';
  return 'partial';
}

/**
 * The entries, one per heading, in document order.
 *
 * **How a section maps to an objective.** Two ways, and either is enough:
 *
 *  1. one of the objective's `blockIds` is in the section. That list is the main process's own
 *     objective-to-block mapping (`blockIdsForObjective`: the page intersection, cached, and the
 *     same one a lesson card's **Start** scrolls by), so the map and Start agree on where an
 *     objective lives;
 *  2. the objective's pages overlap the section's pages. `blockIds` is a snapshot taken when the
 *     view was built, and the document moves after it: an ingest window lands, an agent writes a
 *     block in, the learner retitles a heading. The overlap is the same rule applied to the
 *     document as it is now, so a section that arrived after the view is not left unmapped until
 *     the next `progress.updated`.
 *
 * Objectives the deck assumes rather than teaches are not counted (`taughtObjectives`), for the
 * bar's reason: they are not what this lecture is teaching.
 *
 * A heading whose `blockId` has not been minted yet gets no entry — there is nothing to scroll
 * to — but it still closes the sections above it.
 */
export function mapEntries(blocks: readonly MapBlock[], view: ProgressView | null): MapEntry[] {
  const objectives = taughtObjectives(view);
  const entries: MapEntry[] = [];

  blocks.forEach((heading, at) => {
    if (heading.level === null || !heading.blockId) return;

    const ids = new Set<string>();
    const pages = new Set<number>();
    for (let i = at; i < blocks.length; i++) {
      const block = blocks[i]!;
      if (i > at && block.level !== null && block.level <= heading.level) break;
      if (block.blockId) ids.add(block.blockId);
      for (const page of block.pages) if (Number.isInteger(page) && page >= 1) pages.add(page);
    }

    const mapped = objectives.filter(
      (o) => o.blockIds.some((id) => ids.has(id)) || o.pages.some((page) => pages.has(page)),
    );

    entries.push({
      blockId: heading.blockId,
      level: heading.level,
      title: heading.text.replace(/\s+/g, ' ').trim() || UNTITLED,
      pages: [...pages].sort((a, b) => a - b),
      fill: sectionFill(mapped.map((o) => o.fill)),
      objectiveIds: mapped.map((o) => o.objectiveId),
    });
  });

  return entries;
}

/** The state in words — for the entry's accessible label, where the colour cannot be read. */
export function fillWords(fill: MapFill): string {
  if (fill === 'complete') return 'complete';
  if (fill === 'partial') return 'partly done';
  if (fill === 'none') return 'not started';
  return 'no objective here';
}

/** `Wizard of Oz, partly done, 2 objectives` — one sentence, the title first. */
export function entryLabel(entry: MapEntry): string {
  const n = entry.objectiveIds.length;
  if (n === 0) return `${entry.title}, ${fillWords(entry.fill)}`;
  return `${entry.title}, ${fillWords(entry.fill)}, ${n} ${n === 1 ? 'objective' : 'objectives'}`;
}

/**
 * How far an entry is indented: by its level **relative to the shallowest heading in the
 * document**, so notes that happen to start at `##` do not sit one step in from the edge.
 */
export function entryDepths(entries: readonly MapEntry[]): number[] {
  const top = entries.reduce((min, e) => Math.min(min, e.level), Number.POSITIVE_INFINITY);
  return entries.map((e) => e.level - top);
}

/**
 * The section being read: the last heading at or above a line near the top of the pane, given
 * each heading's position in document order. `null` above the first heading.
 */
export function currentEntry(tops: readonly { blockId: string; top: number }[], line: number): string | null {
  let current: string | null = null;
  for (const heading of tops) {
    if (heading.top > line) break;
    current = heading.blockId;
  }
  return current;
}

// ── reading the blocks off the rendered document ────────────────────────────────────────────

/** `h1`–`h3` → 1–3, anything else → `null`. Case-insensitive: `tagName` is upper case in HTML. */
export function headingLevel(tag: string): number | null {
  const match = /^h([1-3])$/i.exec(tag);
  return match ? Number(match[1]) : null;
}

/** The inverse of the schema's `data-pages` (`12,15,16`). Anything that is not a page is dropped. */
export function pagesFromAttr(raw: string | null | undefined): number[] {
  return (raw ?? '')
    .split(',')
    .map((part) => Number.parseInt(part, 10))
    .filter((page) => Number.isInteger(page) && page >= 1);
}

/**
 * Two readings of the document that would draw the same map. The reader runs on every change to
 * the document, which is every keystroke, and the map must not be rebuilt for a sentence typed
 * into a paragraph.
 */
export function sameBlocks(a: readonly MapBlock[], b: readonly MapBlock[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((block, i) => {
    const other = b[i]!;
    return (
      block.blockId === other.blockId &&
      block.level === other.level &&
      block.text === other.text &&
      block.pages.length === other.pages.length &&
      block.pages.every((page, j) => page === other.pages[j])
    );
  });
}

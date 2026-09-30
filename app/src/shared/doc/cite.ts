/**
 * **Where on the slide a block came from, and what on a figure can be pointed at** (#48, §3).
 *
 * Two pure functions over one input, the page's own text with its boxes (`notes:pageLines`):
 *
 *  - **`bestRegion`** finds the slide lines a block of the notes was written from, so the
 *    provenance chip can show that region instead of a whole page. The notes are a rewrite, so
 *    the match is on shared *content words*, not on a verbatim string.
 *  - **`hotspotsIn`** turns the text items inside a figure's crop into labels a learner can
 *    click. The boxes are the PDF's own, so a hotspot sits exactly on its label.
 *
 * **No model, and no guess.** A region is only returned when the overlap clears the thresholds
 * below; under them the answer is `null` and the caller shows the whole page. An outline around
 * the wrong lines is worse than none, because the chip exists so the learner can check the notes
 * against the slide, and a wrong outline sends them to check against the wrong words.
 */

/** A box in normalised page coordinates: 0 to 1, y down from the page top. */
export interface LineRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One piece of slide text and where it sits. */
export interface PageLine {
  text: string;
  rect: LineRect;
}

/** What `notes:pageLines` returns for one page. */
export interface PageLinesView {
  /** 1-based, the source PDF's own page number. */
  page: number;
  /** The page box in points. Both 0 when the page has no geometry (a damaged or merged page). */
  width: number;
  height: number;
  /** Whole lines in reading order, as the ingest's pass 1 rebuilds them. `bestRegion` reads these. */
  lines: PageLine[];
  /**
   * The text layer's own items, before they are joined into lines. `hotspotsIn` reads these: a
   * rebuilt line spans the whole page width, so two labels on one baseline of a diagram would
   * come out as one label with a box across both.
   */
  items: PageLine[];
}

/** A matched region of a slide. */
export interface CiteRegion {
  rect: LineRect;
  /** The slide's own words for the region, one line per `\n`, at most `MAX_QUOTE_LINES`. */
  quote: string;
  /** The F1 that won, 0 to 1. For tests and the log, not for display. */
  score: number;
}

/** A clickable label on a figure. `rect` is relative to the crop, 0 to 1. */
export interface Hotspot {
  label: string;
  rect: LineRect;
}

// ── the line matcher ────────────────────────────────────────────────────────────────────────

/** The longest run of adjacent lines tried as one region. */
export const MAX_RUN_LINES = 8;
/** Lines of the slide's words shown in the preview. A longer region ends in an ellipsis. */
export const MAX_QUOTE_LINES = 3;
/** The run's F1 against the block must reach this. */
export const MIN_SCORE = 0.3;
/** At least this share of the run's content words must be in the block. */
export const MIN_PRECISION = 0.5;
/** And at least this many distinct content words must be shared. */
export const MIN_SHARED = 2;

const STOP_WORDS = new Set(
  (
    'a an and are as at be been being but by can could did do does for from had has have he her his how i if in ' +
    'into is it its may might more most must no nor not of on one or our out over per she should so some such ' +
    'than that the their them then there these they this those to too under up us was we were what when where ' +
    'which while who whom why will with would you your also about each other any all both only very just via ' +
    'eg ie etc vs'
  ).split(' '),
);

/**
 * The content words of a piece of text, as a set.
 *
 * Lower-cased, possessives and a plural `s` dropped (so `heuristics` meets `heuristic`), stop
 * words and single characters removed. Deliberately no real stemmer: a wrong conflation is a
 * false match, and a false match here draws an outline.
 */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  const cleaned = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’]s\b/g, '');
  for (const raw of cleaned.split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || STOP_WORDS.has(raw)) continue;
    const word = raw.length > 3 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw;
    out.add(word);
  }
  return out;
}

function union(a: LineRect, b: LineRect): LineRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/**
 * The slide region a block was drawn from, or `null` when no region matches well enough.
 *
 * Every run of up to `MAX_RUN_LINES` adjacent lines is scored by the **F1 of its content words
 * against the block's**: precision is the share of the run's words the block uses, recall the
 * share of the block's words the run supplies. F1 is what makes the extent come out right
 * without a rule for it: adding a line the block does not use costs precision, and stopping
 * short of a line it does use costs recall. Ties go to the shorter run.
 */
export function bestRegion(blockText: string, lines: readonly PageLine[]): CiteRegion | null {
  const block = contentWords(blockText);
  if (block.size === 0 || lines.length === 0) return null;
  const words = lines.map((line) => contentWords(line.text));

  let best: { from: number; to: number; score: number } | null = null;
  for (let from = 0; from < lines.length; from++) {
    const run = new Set<string>();
    for (let to = from; to < Math.min(lines.length, from + MAX_RUN_LINES); to++) {
      for (const word of words[to]!) run.add(word);
      if (run.size === 0) continue;
      let shared = 0;
      for (const word of run) if (block.has(word)) shared++;
      if (shared < MIN_SHARED) continue;
      const precision = shared / run.size;
      if (precision < MIN_PRECISION) continue;
      const recall = shared / block.size;
      const score = (2 * precision * recall) / (precision + recall);
      // Strictly greater: an equal score on a longer run does not displace the shorter one.
      if (score >= MIN_SCORE && (best === null || score > best.score)) best = { from, to, score };
    }
  }
  if (best === null) return null;

  const picked = lines.slice(best.from, best.to + 1);
  const rect = picked.map((line) => line.rect).reduce(union);
  const shown = picked.slice(0, MAX_QUOTE_LINES).map((line) => line.text.trim());
  const quote = shown.join('\n') + (picked.length > MAX_QUOTE_LINES ? ' …' : '');
  return { rect, quote, score: best.score };
}

// ── the hotspot builder ─────────────────────────────────────────────────────────────────────

/** Two items closer than this many box heights, on one baseline, are one label. */
const LABEL_GAP = 0.8;
/** A gap wider than this many box heights is a space between two words. */
const SPACE_GAP = 0.12;
/** Two items are on one baseline when their centres are within this share of the taller box. */
const BASELINE_TOL = 0.5;
/** Longer than this is a sentence of body text, not a label on a diagram. */
export const MAX_LABEL_CHARS = 80;

/**
 * A label worth a hotspot: at least two characters and at least one letter, so a bullet glyph,
 * an axis tick, a slide number and a lone `x` are all left alone.
 */
export function isLabel(text: string): boolean {
  const label = text.trim();
  if (label.length > MAX_LABEL_CHARS) return false;
  if ([...label.replace(/\s+/g, '')].length < 2) return false;
  return /\p{L}/u.test(label);
}

/**
 * The labels inside a crop, as hotspots relative to it.
 *
 * `items` are the page's text items (`PageLinesView.items`), `crop` the figure's rect in page
 * coordinates (`null` for a whole page), and `aspect` the page's width over its height, which is
 * what lets a horizontal gap be compared with a line height when both are normalised.
 *
 * An item belongs to the crop when its centre is inside it. Items on one baseline that nearly
 * touch are one label ("Working" "memory" is `Working memory`); a wider gap is two labels, which
 * is the difference between two boxes of a diagram and two words in one of them.
 */
export function hotspotsIn(items: readonly PageLine[], crop: LineRect | null, aspect = 16 / 9): Hotspot[] {
  const box = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  if (!(box.w > 0) || !(box.h > 0)) return [];
  const ratio = aspect > 0 && Number.isFinite(aspect) ? aspect : 16 / 9;

  const inside = items
    .filter((item) => {
      if (item.text.trim() === '' || !(item.rect.w > 0) || !(item.rect.h > 0)) return false;
      const cx = item.rect.x + item.rect.w / 2;
      const cy = item.rect.y + item.rect.h / 2;
      return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
    })
    .sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y);

  // Left to right, so a label only ever grows rightwards from its first item.
  const groups: { text: string; rect: LineRect; last: LineRect; trailing: boolean }[] = [];
  for (const item of inside) {
    const r = item.rect;
    const host = groups.find((group) => {
      const tall = Math.max(group.last.h, r.h);
      const sameLine = Math.abs(group.last.y + group.last.h / 2 - (r.y + r.h / 2)) <= tall * BASELINE_TOL;
      // The gap in the same unit as the height: page heights.
      const gap = (r.x - (group.last.x + group.last.w)) * ratio;
      return sameLine && gap <= tall * LABEL_GAP && gap >= -tall;
    });
    if (!host) {
      groups.push({ text: item.text.trim(), rect: { ...r }, last: r, trailing: /\s$/.test(item.text) });
      continue;
    }
    const gap = (r.x - (host.last.x + host.last.w)) * ratio;
    // A run that ends in a space carries the space inside its own box, so the gap reads as zero.
    const spaced = gap > Math.max(host.last.h, r.h) * SPACE_GAP || host.trailing || /^\s/.test(item.text);
    host.text = `${host.text}${spaced ? ' ' : ''}${item.text.trim()}`;
    host.rect = union(host.rect, r);
    host.last = r;
    host.trailing = /\s$/.test(item.text);
  }

  const clamp = (v: number): number => Math.max(0, Math.min(1, v));
  return groups
    .map((group) => ({ label: group.text.replace(/\s+/g, ' ').trim(), rect: group.rect }))
    .filter((group) => isLabel(group.label))
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
    .map(({ label, rect }) => {
      const x0 = clamp((rect.x - box.x) / box.w);
      const y0 = clamp((rect.y - box.y) / box.h);
      const x1 = clamp((rect.x + rect.w - box.x) / box.w);
      const y1 = clamp((rect.y + rect.h - box.y) / box.h);
      return { label, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
    });
}

/** The question a hotspot's "Ask Ellie about this" sends. */
export function hotspotQuestion(label: string, page: number): string {
  return `What is "${label}" in this figure on p. ${String(page)}?`;
}

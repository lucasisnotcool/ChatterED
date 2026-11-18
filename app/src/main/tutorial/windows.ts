/**
 * **Reading a long sheet in page windows** (field study, 2026-11-18).
 *
 * The read asks for a faithful copy of the sheet and a key per part in one answer. A tutorial of
 * four pages took 8,177 output tokens for 18 parts; a 35-page exam paper (39 questions) does not
 * fit in any one answer the app may ask for, and on the API it ran out at 18,000 tokens and was
 * reported as "no questions". So a long sheet is read a few pages at a time, and the windows are
 * joined in page order:
 *
 *  - **Who copies what.** A window owns the parts and blocks that *start* on its pages. It also
 *    sees the next page, only to finish a part that starts on its last page and runs on, and the
 *    whole page before, as context for a part whose stem is there.
 *  - **The join never invents or loses a part.** Keys pair with their blocks by occurrence (the
 *    second `P1` block gets the second `P1` key), and every part gets a unique id here, its key
 *    with it. Only a true copy goes: the same part copied by both windows of a boundary (same id
 *    or label, near-identical words; the fuller copy stays), a tail re-copied after a boundary
 *    (its words inside the part it ends), or a short answer-grid entry that repeats a question's
 *    id. A page number off the window (printed numbering, a cover page) is mapped back onto the
 *    window, never a reason to drop.
 *  - **A cut-off answer is not an empty sheet.** A window whose answer ran out of tokens, or came
 *    back without its `blocks` and `parts`, is halved (a short one is cut into single pages) and
 *    read again, within a budget per read. A page that still does not fit, or that the model
 *    declines, becomes a notice in the sheet and the rest lands. Only a failure of the transport
 *    (after its retries) or the credit stops the read, and finished windows are kept by the caller.
 *
 * Pure but for the reader it is given: no model, clock or storage here.
 */

/** A sheet shorter than both of these is read in one call, exactly as before windows existed. */
export const SINGLE_CALL_PAGES = 6;
export const SINGLE_CALL_CHARS = 12_000;
/** A window's pages and text, at most. A tutorial page ran ~2,000 output tokens; an exam page fewer. */
export const WINDOW_PAGES = 5;
export const WINDOW_CHARS = 8_000;
/** How many windows are read at once. The CLI serialises its children anyway. */
export const WINDOW_CONCURRENCY = 2;
/**
 * How many cut-off answers one read may pay for before the windows still cut off become notices.
 * A cut-off answer is a full 18,000-token answer on the API (about $0.18 on Sonnet 5.5): a page
 * that never fits costs at most three, and the read at most four.
 */
export const MAX_TRUNCATIONS = 4;
/** The most pages a read covers. A longer file is read to here and the sheet says so. */
export const MAX_SHEET_PAGES = 60;

export interface SheetWindow {
  /** The sheet pages this window owns, 1-based, inclusive. */
  from: number;
  to: number;
  /** The page after `to`, shown only to finish a part; null on the last window or a whole sheet. */
  ahead: number | null;
  /** How many times this window's range has been cut. */
  depth: number;
}

/** The one window a short sheet is: its whole range, no look-ahead. */
export function wholeSheet(pageCount: number): SheetWindow {
  return { from: 1, to: Math.max(1, pageCount), ahead: null, depth: 0 };
}

/**
 * The windows for a sheet, from each page's text length (`chars[k-1]` is page k's). A short sheet
 * is one window; a long one is cut into runs of at most `WINDOW_PAGES` pages and `WINDOW_CHARS`
 * characters, never less than a page.
 */
export function planWindows(chars: readonly number[]): SheetWindow[] {
  const pageCount = Math.max(1, chars.length);
  const total = chars.reduce((n, c) => n + c, 0);
  if (pageCount <= SINGLE_CALL_PAGES && total <= SINGLE_CALL_CHARS) return [wholeSheet(pageCount)];
  const windows: SheetWindow[] = [];
  let from = 1;
  let size = 0;
  for (let page = 1; page <= pageCount; page += 1) {
    const c = chars[page - 1] ?? 0;
    const pages = page - from;
    if (pages > 0 && (pages >= WINDOW_PAGES || size + c > WINDOW_CHARS)) {
      windows.push({ from, to: page - 1, ahead: page, depth: 0 });
      from = page;
      size = 0;
    }
    size += c;
  }
  windows.push({ from, to: pageCount, ahead: null, depth: 0 });
  return windows;
}

/**
 * A window cut smaller: four or more pages are halved, the first half looking into the second;
 * two or three are cut into single pages, which is where a halving would end up anyway, one call
 * sooner. A single page cannot be cut.
 */
export function splitWindow(w: SheetWindow): SheetWindow[] | null {
  const pages = w.to - w.from + 1;
  if (pages <= 1) return null;
  const cuts = pages <= 3 ? Array.from({ length: pages }, (_, i) => w.from + i) : [w.from, Math.floor((w.from + w.to) / 2) + 1];
  return cuts.map((start, i) => {
    const end = i + 1 < cuts.length ? cuts[i + 1]! - 1 : w.to;
    return { from: start, to: end, ahead: end < w.to ? end + 1 : w.ahead, depth: w.depth + 1 };
  });
}

/** The reply did not hold a whole answer: cut off by the output limit, or without its arrays. */
export class WindowTruncated extends Error {
  constructor(readonly reason: 'max_tokens' | 'malformed') {
    super(reason === 'max_tokens' ? 'the answer was cut off by the output limit' : 'the answer was not a whole sheet');
    this.name = 'WindowTruncated';
  }
}

/** The model declined these pages (`stop_reason: "refusal"`): a notice, not a failed read. */
export class WindowDeclined extends Error {
  constructor() {
    super('the model declined to read these pages');
    this.name = 'WindowDeclined';
  }
}

/** Pages the read could not cover, said in the sheet where they would have been. */
export interface WindowNotice {
  from: number;
  to: number;
  reason: 'too_long' | 'incomplete' | 'declined' | 'beyond_limit';
}

/** The sentence a notice puts in the sheet. Plain: the learner can do nothing about the cause. */
export function noticeText(n: WindowNotice, pageCount: number): string {
  const pages = n.from === n.to ? `page ${n.from}` : `pages ${n.from}–${n.to}`;
  switch (n.reason) {
    case 'too_long':
      return `*Max could not read ${pages} of this sheet: ${n.from === n.to ? 'it holds' : 'they hold'} more than one answer can carry. Work from the PDF for ${n.from === n.to ? 'that page' : 'those pages'}.*`;
    case 'declined':
      return `*Max could not read ${pages} of this sheet: Claude declined to work on ${n.from === n.to ? 'it' : 'them'}. Work from the PDF for ${n.from === n.to ? 'that page' : 'those pages'}.*`;
    case 'incomplete':
      return `*Max's reading of ${pages} came back incomplete, so ${n.from === n.to ? 'it is' : 'they are'} not here. Read the sheet again to try once more.*`;
    case 'beyond_limit':
      return `*This file has ${pageCount} pages; Max read the first ${n.from - 1}. To work through ${pages}, add them as a sheet of their own.*`;
  }
}

export interface WindowRead {
  window: SheetWindow;
  raw: Record<string, unknown>;
}

export interface ReadOutcome {
  reads: WindowRead[];
  notices: WindowNotice[];
  /** Windows that were cut off and cut smaller. */
  splits: number;
}

/** Whether a parsed answer is a whole read: an object with its `blocks` and `parts` arrays. */
export function wholeAnswer(raw: unknown): raw is Record<string, unknown> {
  const r = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  return r !== null && Array.isArray(r.blocks) && Array.isArray(r.parts);
}

/**
 * **Read every window**, `concurrency` at a time. A window cut off is cut smaller while the
 * read's truncation budget lasts; a page that still does not fit, or that the model declines,
 * becomes a notice. Any other error stops new windows, lets the ones in flight finish (the caller
 * keeps them), and is thrown. `progress` is told the windows done (notices count) over the
 * windows there are now.
 */
export async function readWindows(
  plan: readonly SheetWindow[],
  read: (w: SheetWindow) => Promise<Record<string, unknown>>,
  hooks: { progress?(done: number, total: number): void; split?(w: SheetWindow, reason: WindowTruncated['reason']): void } = {},
  concurrency = WINDOW_CONCURRENCY,
): Promise<ReadOutcome> {
  const reads: WindowRead[] = [];
  const notices: WindowNotice[] = [];
  const queue = [...plan];
  let total = plan.length;
  let done = 0;
  let splits = 0;
  let truncations = 0;
  let failed: { err: unknown } | null = null;

  const settle = (): void => {
    done += 1;
    hooks.progress?.(done, total);
  };
  const one = async (w: SheetWindow): Promise<void> => {
    try {
      reads.push({ window: w, raw: await read(w) });
      settle();
    } catch (err) {
      if (err instanceof WindowDeclined) {
        notices.push({ from: w.from, to: w.to, reason: 'declined' });
        settle();
        return;
      }
      if (!(err instanceof WindowTruncated)) {
        failed ??= { err };
        return;
      }
      truncations += 1;
      const parts = truncations <= MAX_TRUNCATIONS ? splitWindow(w) : null;
      if (!parts) {
        notices.push({ from: w.from, to: w.to, reason: err.reason === 'max_tokens' ? 'too_long' : 'incomplete' });
        settle();
        return;
      }
      splits += 1;
      total += parts.length - 1;
      hooks.split?.(w, err.reason);
      hooks.progress?.(done, total);
      queue.unshift(...parts);
    }
  };
  const running = new Set<Promise<void>>();
  const fill = (): void => {
    while (failed === null && running.size < Math.max(1, concurrency) && queue.length > 0) {
      const p: Promise<void> = one(queue.shift()!).finally(() => running.delete(p));
      running.add(p);
    }
  };
  fill();
  while (running.size > 0) {
    await Promise.race(running);
    fill();
  }
  if (failed !== null) throw (failed as { err: unknown }).err;
  reads.sort((a, b) => a.window.from - b.window.from);
  notices.sort((a, b) => a.from - b.from);
  return { reads, notices, splits };
}

/** `fn` over `items`, at most `limit` at once, results in the items' order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return out;
}

/** `items` in runs of `size`. */
export function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += Math.max(1, size)) out.push(items.slice(i, i + Math.max(1, size)));
  return out;
}

// ── joining the windows ─────────────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
/** Words only, lower case: for telling two copies of the same text apart from two texts. */
const norm = (s: string): string => s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();

/** All the words a block carries, its prompt's and its options' included. */
function blockText(b: Rec): string {
  const own = [str(b.text), str(b.tex), str(b.caption), ...(Array.isArray(b.items) ? b.items.map(str) : [])];
  const prompt = Array.isArray(b.prompt) ? b.prompt.map((p) => (rec(p) ? blockText(rec(p)!) : '')) : [];
  const options = Array.isArray(rec(b.answer)?.options) ? (rec(b.answer)!.options as unknown[]).map((o) => str(rec(o)?.text)) : [];
  return [...own, ...prompt, ...options].filter(Boolean).join(' ');
}

/** Dice similarity of two texts' word multisets: 1 for the same words, 0 for none shared. */
export function similarity(a: string, b: string): number {
  const wa = a.split(' ').filter(Boolean);
  const wb = b.split(' ').filter(Boolean);
  if (wa.length === 0 || wb.length === 0) return wa.length === wb.length ? 1 : 0;
  const counts = new Map<string, number>();
  for (const w of wa) counts.set(w, (counts.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of wb) {
    const n = counts.get(w) ?? 0;
    if (n > 0) {
      shared += 1;
      counts.set(w, n - 1);
    }
  }
  return (2 * shared) / (wa.length + wb.length);
}

/** Near-identical: the same part copied twice, not two parts that share a stem. */
const SAME_PART = 0.9;
/**
 * An answer-grid entry: what is left of its words once option letters, numbers and the words
 * "question" and "answer" are gone. A real question, however short, says more than this.
 */
const GRID_CHARS = 12;

export interface MergeStats {
  /** Parts or blocks both sides of a boundary copied, kept once. */
  duplicatesDropped: number;
  /** Tails a window re-copied from a part begun before it. */
  tailsDropped: number;
  /** Short answer-grid entries repeating an id. */
  gridDropped: number;
  /** Part ids used twice for different parts, given a suffix. */
  idsRenamed: number;
  /** Blocks whose page was off their window, mapped back onto it. */
  pagesMapped: number;
  /** Windows that came back with nothing in them. */
  emptyWindows: number;
}

interface Item {
  block: Rec;
  key: Rec | null;
  window: number;
  words: string;
  isPart: boolean;
  /** The id and label the model gave, normalised, for recognising the same part twice. */
  id: string;
  label: string;
  /** Copied from the window's look-ahead page. */
  ahead: boolean;
  dropped: boolean;
}

/** Shift a block's page, and its prompt's, by `d`, then clamp it to `[lo, hi]`. */
function placeBlock(b: Rec, d: number, lo: number, hi: number): Rec {
  const at = (v: unknown): unknown => (typeof v === 'number' && Number.isInteger(v) ? Math.min(hi, Math.max(lo, v - d)) : v);
  const prompt = Array.isArray(b.prompt) ? b.prompt.map((p) => (rec(p) ? { ...rec(p)!, page: at(rec(p)!.page) } : p)) : b.prompt;
  return { ...b, page: at(b.page), ...(Array.isArray(b.prompt) ? { prompt } : {}) };
}

/**
 * **One answer from the windows**, in page order, for `validateTutorial` to check as it checks a
 * whole-sheet answer. Every part leaves with a unique id and its own key (`Item`); see the
 * module comment for what counts as a copy. One clean window comes out as it went in.
 */
export function mergeWindowReads(
  reads: readonly WindowRead[],
  notices: readonly WindowNotice[] = [],
  pageCount = 0,
): { raw: Rec; stats: MergeStats } {
  const stats: MergeStats = { duplicatesDropped: 0, tailsDropped: 0, gridDropped: 0, idsRenamed: 0, pagesMapped: 0, emptyWindows: 0 };
  const items: Item[] = [];
  let title = '';

  reads.forEach(({ window: w, raw }, index) => {
    if (!title) title = str(raw.title);
    const blocks = (Array.isArray(raw.blocks) ? raw.blocks : []).map(rec).filter((b): b is Rec => b !== null);
    if (blocks.length === 0) stats.emptyWindows += 1;
    // Keys by the id the model gave, in order: the nth block with an id gets the nth key with it.
    const keys = new Map<string, Rec[]>();
    for (const k of (Array.isArray(raw.parts) ? raw.parts : []).map(rec)) {
      if (!k) continue;
      const id = str(k.partId);
      keys.set(id, [...(keys.get(id) ?? []), k]);
    }
    // Pages off the window: a consistent offset (printed numbering) is taken back off; a stray
    // page is clamped onto the window.
    const lo = w.from;
    const hi = w.ahead ?? w.to;
    const pages = blocks.map((b) => b.page).filter((p): p is number => typeof p === 'number' && Number.isInteger(p));
    const outside = pages.filter((p) => p < lo || p > hi).length;
    const d = pages.length > 0 && outside * 2 > pages.length ? Math.min(...pages) - lo : 0;
    for (const original of blocks) {
      const b = placeBlock(original, d, lo, hi);
      if (b.page !== original.page) stats.pagesMapped += 1;
      const isPart = b.type === 'part';
      const id = isPart ? str(b.id) : '';
      const key = isPart ? (keys.get(id)?.shift() ?? null) : null;
      items.push({
        block: b,
        key,
        window: index,
        words: norm(blockText(b)),
        isPart,
        id: id.toLowerCase(),
        label: norm(str(b.label)),
        ahead: w.ahead !== null && b.page === w.ahead,
        dropped: false,
      });
    }
  });

  const kept = (i: Item) => !i.dropped;
  for (let n = 0; n < items.length; n += 1) {
    const item = items[n]!;
    if (item.window === 0) continue;
    const earlier = items.slice(0, n).filter(kept);
    const previous = earlier.filter((e) => e.window === item.window - 1);
    const firstOfWindow = items.findIndex((x) => x.window === item.window && x.isPart);
    const beforeOwnParts = firstOfWindow === -1 || n <= firstOfWindow;
    // The running title, copied again by a later window.
    if (!item.isPart && item.block.type === 'heading' && title && norm(str(item.block.text)) === norm(title)) {
      item.dropped = true;
      stats.duplicatesDropped += 1;
      continue;
    }
    // The same part or block copied by both windows of a boundary: the fuller copy stays.
    const twin = previous.find(
      (e) =>
        e.isPart === item.isPart &&
        (item.isPart ? (e.id !== '' && e.id === item.id) || (e.label !== '' && e.label === item.label) : item.words.length >= 12 && (e.ahead || beforeOwnParts)) &&
        item.words.length > 0 &&
        similarity(e.words, item.words) >= SAME_PART,
    );
    if (twin) {
      const loser = twin.words.length >= item.words.length && !twin.ahead ? item : twin;
      loser.dropped = true;
      stats.duplicatesDropped += 1;
      continue;
    }
    // A tail re-copied: what opens this window, its words inside the part the window before ended on.
    if (beforeOwnParts && item.words.length >= 12 && previous.some((e) => e.isPart && e.words.includes(item.words))) {
      if (!item.isPart || previous.some((e) => e.isPart && ((e.id !== '' && e.id === item.id) || (e.label !== '' && e.label === item.label)))) {
        item.dropped = true;
        stats.tailsDropped += 1;
        continue;
      }
    }
  }
  // An answer grid's entry: a short "part" whose id or label an earlier part has.
  for (let n = 0; n < items.length; n += 1) {
    const item = items[n]!;
    if (!item.isPart || item.dropped) continue;
    const residue = item.words.replace(/\b(?:[a-hx]|\d+|question|answer|q)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (residue.length >= GRID_CHARS) continue;
    const repeats = items.slice(0, n).some((e) => kept(e) && e.isPart && ((e.id !== '' && e.id === item.id) || (e.label !== '' && e.label === item.label)));
    if (repeats) {
      item.dropped = true;
      stats.gridDropped += 1;
    }
  }

  // Unique ids, each key with its block.
  const used = new Set<string>();
  const blocks: unknown[] = [];
  const parts: unknown[] = [];
  const noticesLeft = [...notices];
  const placeNotices = (beforePage: number): void => {
    while (noticesLeft.length > 0 && noticesLeft[0]!.from <= beforePage) {
      const n = noticesLeft.shift()!;
      blocks.push({ type: 'paragraph', page: n.from, text: noticeText(n, pageCount), admin: true });
    }
  };
  for (const item of items.filter(kept)) {
    const page = typeof item.block.page === 'number' ? item.block.page : 0;
    placeNotices(page);
    if (!item.isPart) {
      blocks.push(item.block);
      continue;
    }
    const base = str(item.block.id) || 'P';
    let id = base;
    if (used.has(id)) {
      let k = 2;
      while (used.has(`${base}-${k}`)) k += 1;
      id = `${base}-${k}`;
      stats.idsRenamed += 1;
    }
    used.add(id);
    blocks.push(id === item.block.id ? item.block : { ...item.block, id });
    if (item.key) parts.push(item.key.partId === id ? item.key : { ...item.key, partId: id });
  }
  placeNotices(Number.POSITIVE_INFINITY);
  // One clean window, as it was: the short sheet's answer goes to validation untouched.
  if (reads.length === 1 && notices.length === 0 && stats.idsRenamed + stats.gridDropped + stats.pagesMapped === 0) return { raw: reads[0]!.raw, stats };
  return { raw: { title, blocks, parts }, stats };
}

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
 *    end of the page before, only to recognise a continuation it must skip. What a window copied
 *    from its look-ahead page is dropped here; a part both sides of a boundary copied anyway is
 *    kept once; a part id two windows both used for different parts is given a suffix.
 *  - **A cut-off answer is not an empty sheet.** A window whose answer ran out of tokens, or came
 *    back without its `blocks` and `parts`, is split in two and both halves read again, at most
 *    `MAX_SPLITS` deep; a single page that still does not fit is a failure that says so.
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
/** How many times a window that would not fit may be halved: a full window down to one page. */
export const MAX_SPLITS = 3;

export interface SheetWindow {
  /** The sheet pages this window owns, 1-based, inclusive. */
  from: number;
  to: number;
  /** The page after `to`, shown only to finish a part; null on the last window or a whole sheet. */
  ahead: number | null;
  /** How many times this window's range has been halved. */
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

/** A window halved: the first half looks ahead into the second, the second keeps the look-ahead. */
export function splitWindow(w: SheetWindow): [SheetWindow, SheetWindow] | null {
  if (w.to <= w.from) return null;
  const mid = Math.floor((w.from + w.to) / 2);
  return [
    { from: w.from, to: mid, ahead: mid + 1, depth: w.depth + 1 },
    { from: mid + 1, to: w.to, ahead: w.ahead, depth: w.depth + 1 },
  ];
}

/** The reply did not hold a whole answer: cut off by the output limit, or without its arrays. */
export class WindowTruncated extends Error {
  constructor(readonly reason: 'max_tokens' | 'malformed') {
    super(reason === 'max_tokens' ? 'the answer was cut off by the output limit' : 'the answer was not a whole sheet');
    this.name = 'WindowTruncated';
  }
}

/** Pages that still did not fit once halved as far as allowed. The message is the learner's. */
export class SheetTooLong extends Error {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly reason: WindowTruncated['reason'],
  ) {
    const pages = from === to ? `page ${from}` : `pages ${from}–${to}`;
    super(
      reason === 'max_tokens'
        ? `Couldn't read this sheet: ${pages} ${from === to ? 'holds' : 'hold'} more than Max can write out in one go. Retry, or split the PDF into shorter sheets.`
        : `Couldn't read this sheet: Max's reading of ${pages} came back incomplete. Retry to try again.`,
    );
    this.name = 'SheetTooLong';
  }
}

export interface WindowRead {
  window: SheetWindow;
  raw: Record<string, unknown>;
}

export interface ReadOutcome {
  reads: WindowRead[];
  /** Windows that were cut off and halved. */
  splits: number;
}

/** Whether a parsed answer is a whole read: an object with its `blocks` and `parts` arrays. */
export function wholeAnswer(raw: unknown): raw is Record<string, unknown> {
  const r = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  return r !== null && Array.isArray(r.blocks) && Array.isArray(r.parts);
}

/**
 * **Read every window**, `WINDOW_CONCURRENCY` at a time, halving one that came back cut off.
 * `read` throws `WindowTruncated` for a cut-off answer; any other error ends the read as it is.
 * `progress` is told the windows done and the windows there now are (a split adds one).
 */
export async function readWindows(
  plan: readonly SheetWindow[],
  read: (w: SheetWindow) => Promise<Record<string, unknown>>,
  hooks: { progress?(done: number, total: number): void; split?(w: SheetWindow, reason: WindowTruncated['reason']): void } = {},
  concurrency = WINDOW_CONCURRENCY,
): Promise<ReadOutcome> {
  const reads: WindowRead[] = [];
  const queue = [...plan];
  let total = plan.length;
  let done = 0;
  let splits = 0;
  let failed: unknown = null;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (failed !== null) return;
      const w = queue.shift();
      if (!w) return;
      try {
        const raw = await read(w);
        reads.push({ window: w, raw });
        done += 1;
        hooks.progress?.(done, total);
      } catch (err) {
        if (!(err instanceof WindowTruncated)) {
          failed ??= err;
          return;
        }
        const halves = w.depth < MAX_SPLITS ? splitWindow(w) : null;
        if (!halves) {
          failed ??= new SheetTooLong(w.from, w.to, err.reason);
          return;
        }
        splits += 1;
        total += 1;
        hooks.split?.(w, err.reason);
        hooks.progress?.(done, total);
        queue.unshift(...halves);
      }
    }
  };
  // A worker returns when the queue is empty, but a split may refill it while others still run:
  // keep starting workers until nothing is queued and nothing is in flight.
  const running = new Set<Promise<void>>();
  const fill = (): void => {
    while (failed === null && running.size < Math.max(1, concurrency) && queue.length > 0) {
      const p: Promise<void> = worker().finally(() => running.delete(p));
      running.add(p);
    }
  };
  fill();
  while (running.size > 0) {
    await Promise.race(running);
    fill();
  }
  if (failed !== null) throw failed;
  reads.sort((a, b) => a.window.from - b.window.from);
  return { reads, splits };
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

const rec = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
/** Words only, lower case: for telling two copies of the same text apart from two texts. */
const norm = (s: string): string => s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();

function pageOf(b: Record<string, unknown>): number | null {
  return typeof b.page === 'number' && Number.isInteger(b.page) ? b.page : null;
}

/** All the words a block carries, its prompt's included. */
function blockText(b: Record<string, unknown>): string {
  const own = [str(b.text), str(b.tex), str(b.caption), str(b.label), ...(Array.isArray(b.items) ? b.items.map(str) : [])];
  const prompt = Array.isArray(b.prompt) ? b.prompt.map((p) => (rec(p) ? blockText(rec(p)!) : '')) : [];
  return [...own, ...prompt].filter(Boolean).join(' ');
}

export interface MergeStats {
  /** Blocks and parts a window copied from its look-ahead page. */
  aheadDropped: number;
  /** Parts or blocks both sides of a boundary copied, kept once. */
  duplicatesDropped: number;
  /** Part ids two windows used for different parts, given a suffix. */
  idsRenamed: number;
}

/**
 * **One answer from the windows**, in page order, for `validateTutorial` to check as it checks a
 * whole-sheet answer. A window's blocks on its look-ahead page go (the next window owns them); a
 * part whose id an earlier window used goes when its words are the same part's (a boundary copied
 * twice), else is renamed `id-wN`; its key follows it. The title is the first window's.
 */
export function mergeWindowReads(reads: readonly WindowRead[]): { raw: Record<string, unknown>; stats: MergeStats } {
  const stats: MergeStats = { aheadDropped: 0, duplicatesDropped: 0, idsRenamed: 0 };
  if (reads.length === 1) return { raw: reads[0]!.raw, stats };
  const blocks: unknown[] = [];
  const parts: unknown[] = [];
  /** Part id → the normalised words of the part that has it, and the window that copied it. */
  const seenParts = new Map<string, { words: string; window: number }>();
  /** Normalised words of every block kept so far, for a continuation copied twice. */
  const keptText: string[] = [];
  let title = '';

  reads.forEach(({ window: w, raw }, index) => {
    if (!title) title = str(raw.title);
    const rename = new Map<string, string | null>();
    let beforeFirstPart = true;
    for (const item of Array.isArray(raw.blocks) ? raw.blocks : []) {
      const b = rec(item);
      if (!b) continue;
      const page = pageOf(b);
      if (w.ahead !== null && page !== null && page > w.to) {
        stats.aheadDropped += 1;
        if (b.type === 'part' && str(b.id)) rename.set(str(b.id), null);
        continue;
      }
      const words = norm(blockText(b));
      if (b.type === 'part') {
        beforeFirstPart = false;
        const id = str(b.id);
        const earlier = id ? seenParts.get(id) : undefined;
        if (earlier !== undefined && earlier.window < index) {
          if (sameWords(earlier.words, words)) {
            stats.duplicatesDropped += 1;
            rename.set(id, null);
            continue;
          }
          let n = index + 1;
          let fresh = `${id}-w${n}`;
          while (seenParts.has(fresh)) fresh = `${id}-w${(n += 1)}`;
          rename.set(id, fresh);
          stats.idsRenamed += 1;
          seenParts.set(fresh, { words, window: index });
          blocks.push({ ...b, id: fresh });
          continue;
        }
        if (id && !seenParts.has(id)) seenParts.set(id, { words, window: index });
        blocks.push(b);
        continue;
      }
      // A later window's copy of the running title, or of the end of a part the window before
      // finished on this window's first page, is not new text.
      if (index > 0 && b.type === 'heading' && title && norm(str(b.text)) === norm(title)) {
        stats.duplicatesDropped += 1;
        continue;
      }
      if (index > 0 && beforeFirstPart && page === w.from && words.length >= 12 && keptText.some((t) => t.includes(words))) {
        stats.duplicatesDropped += 1;
        continue;
      }
      blocks.push(b);
      if (words) keptText.push(words);
    }
    // Remember the parts' words too, so a continuation is recognised inside the part it ends.
    for (const item of Array.isArray(raw.blocks) ? raw.blocks : []) {
      const b = rec(item);
      if (b?.type === 'part' && rename.get(str(b.id)) !== null) keptText.push(norm(blockText(b)));
    }
    for (const item of Array.isArray(raw.parts) ? raw.parts : []) {
      const k = rec(item);
      if (!k) continue;
      const id = str(k.partId);
      if (!rename.has(id)) {
        parts.push(k);
        continue;
      }
      const to = rename.get(id);
      if (to) parts.push({ ...k, partId: to });
    }
  });
  return { raw: { title, blocks, parts }, stats };
}

/** The same part copied twice: one's words open the other's, or the first 80 characters agree. */
function sameWords(a: string, b: string): boolean {
  if (!a || !b) return a === b;
  const head = (s: string) => s.slice(0, 80);
  return head(a) === head(b) || a.startsWith(head(b)) || b.startsWith(head(a));
}

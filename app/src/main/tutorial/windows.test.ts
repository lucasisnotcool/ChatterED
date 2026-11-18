/**
 * A long sheet read in page windows (`windows.ts`; field study, 2026-11-18): the plan, the halving
 * of a cut-off window, the join across boundaries, and the failure that says what happened.
 */
import { describe, expect, it } from 'vitest';
import {
  batches,
  mapLimit,
  MAX_SPLITS,
  mergeWindowReads,
  planWindows,
  readWindows,
  SheetTooLong,
  splitWindow,
  wholeAnswer,
  WINDOW_CHARS,
  WINDOW_PAGES,
  WindowTruncated,
  type SheetWindow,
} from './windows.js';
import { validateTutorial } from './validate.js';

/** The participant's paper: 35 pages, 33,525 characters, page by page (pdftotext). */
const EXAM_PAGES = [
  822, 547, 1592, 584, 695, 828, 1114, 880, 785, 546, 428, 554, 503, 634, 437, 635, 1122, 311, 696, 599, 1175, 1811, 1002, 558,
  568, 705, 842, 270, 465, 719, 744, 568, 742, 713, 603,
];

describe('planning the windows', () => {
  it('reads a short sheet in one call, as before', () => {
    expect(planWindows([2_000, 2_500, 1_800, 2_200])).toEqual([{ from: 1, to: 4, ahead: null, depth: 0 }]);
    expect(planWindows([])).toEqual([{ from: 1, to: 1, ahead: null, depth: 0 }]);
  });

  it('cuts the 35-page exam into windows that cover every page once, each looking one page ahead', () => {
    const plan = planWindows(EXAM_PAGES);
    expect(plan.length).toBeGreaterThan(5);
    expect(plan[0]!.from).toBe(1);
    expect(plan.at(-1)!.to).toBe(35);
    expect(plan.at(-1)!.ahead).toBeNull();
    for (let i = 1; i < plan.length; i += 1) {
      expect(plan[i]!.from).toBe(plan[i - 1]!.to + 1);
      expect(plan[i - 1]!.ahead).toBe(plan[i]!.from);
    }
    for (const w of plan) {
      expect(w.to - w.from + 1).toBeLessThanOrEqual(WINDOW_PAGES);
      const chars = EXAM_PAGES.slice(w.from - 1, w.to).reduce((n, c) => n + c, 0);
      expect(chars <= WINDOW_CHARS || w.from === w.to).toBe(true);
    }
  });

  it('gives a page denser than a window its own window', () => {
    const plan = planWindows([500, 500, 20_000, 500, 500, 500, 500]);
    expect(plan.find((w) => w.from === 3)).toMatchObject({ from: 3, to: 3 });
  });

  it('halves a window, the first half looking into the second', () => {
    expect(splitWindow({ from: 6, to: 10, ahead: 11, depth: 0 })).toEqual([
      { from: 6, to: 8, ahead: 9, depth: 1 },
      { from: 9, to: 10, ahead: 11, depth: 1 },
    ]);
    expect(splitWindow({ from: 4, to: 4, ahead: 5, depth: 0 })).toBeNull();
  });
});

describe('reading the windows', () => {
  const ok = (w: SheetWindow) => ({ title: 'T', blocks: [{ type: 'part', id: `Q${w.from}`, page: w.from }], parts: [{ partId: `Q${w.from}`, answer: 'a' }] });

  it('reads every window and returns them in page order, telling progress', async () => {
    const seen: [number, number][] = [];
    const plan = planWindows(EXAM_PAGES);
    const out = await readWindows(plan, async (w) => ok(w), { progress: (d, t) => seen.push([d, t]) }, 3);
    expect(out.reads.map((r) => r.window.from)).toEqual(plan.map((w) => w.from));
    expect(out.splits).toBe(0);
    expect(seen.at(-1)).toEqual([plan.length, plan.length]);
  });

  it('halves a window that came back cut off, and reads both halves', async () => {
    const plan: SheetWindow[] = [{ from: 1, to: 4, ahead: 5, depth: 0 }, { from: 5, to: 6, ahead: null, depth: 0 }];
    const asked: string[] = [];
    const splitAt: string[] = [];
    let last: [number, number] = [0, 0];
    const out = await readWindows(
      plan,
      async (w) => {
        asked.push(`${w.from}-${w.to}`);
        if (w.to - w.from >= 2) throw new WindowTruncated('max_tokens');
        return ok(w);
      },
      { split: (w) => splitAt.push(`${w.from}-${w.to}`), progress: (d, t) => (last = [d, t]) },
      1,
    );
    expect(splitAt).toEqual(['1-4']);
    expect(asked).toEqual(['1-4', '1-2', '3-4', '5-6']);
    expect(out.reads.map((r) => `${r.window.from}-${r.window.to}`)).toEqual(['1-2', '3-4', '5-6']);
    expect(out.splits).toBe(1);
    expect(last).toEqual([3, 3]);
  });

  it('fails truthfully when one page still does not fit, never as an empty sheet', async () => {
    const run = readWindows([{ from: 1, to: 1, ahead: 2, depth: 0 }, { from: 2, to: 3, ahead: null, depth: 0 }], async (w) => {
      if (w.from === 1) throw new WindowTruncated('max_tokens');
      return ok(w);
    });
    await expect(run).rejects.toBeInstanceOf(SheetTooLong);
    await expect(run).rejects.toThrow(/page 1 holds more than Max can write out in one go/);
  });

  it(`halves at most ${MAX_SPLITS} times`, async () => {
    let calls = 0;
    const run = readWindows([{ from: 1, to: 8, ahead: null, depth: 0 }], async () => {
      calls += 1;
      throw new WindowTruncated('malformed');
    }, {}, 1);
    const err = await run.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SheetTooLong);
    expect((err as SheetTooLong).reason).toBe('malformed');
    // 1–8, then 1–4, then 1–2, then 1, which may not be halved again.
    expect(calls).toBe(MAX_SPLITS + 1);
  });

  it('ends the read on any other error, as it was', async () => {
    const boom = new Error('The Claude CLI exited 1: usage limit');
    await expect(readWindows([{ from: 1, to: 2, ahead: 3, depth: 0 }, { from: 3, to: 3, ahead: null, depth: 0 }], async (w) => {
      if (w.from === 3) throw boom;
      return ok(w);
    })).rejects.toBe(boom);
  });

  it('knows a whole answer from a fragment', () => {
    expect(wholeAnswer({ title: 'x', blocks: [], parts: [] })).toBe(true);
    // The logged failure's 77 characters: an inner block of the cut-off JSON.
    expect(wholeAnswer({ type: 'heading', page: 1, text: 'Expressions and function calls' })).toBe(false);
    expect(wholeAnswer(null)).toBe(false);
  });
});

describe('joining the windows', () => {
  const part = (id: string, page: number, words: string, extra: Record<string, unknown> = {}) => ({
    type: 'part',
    id,
    label: id,
    page,
    prompt: [{ type: 'paragraph', page, text: words }],
    answer: { kind: 'text' },
    ...extra,
  });
  const key = (partId: string, answer: string) => ({ partId, answer, blanks: [], correct: [], steps: [], mistakes: [], prerequisites: [], formalCheck: null, notesBlockIds: [], pages: [], objectiveIds: [] });

  it('passes one window through untouched', () => {
    const raw = { title: 'T', blocks: [part('Q1', 1, 'x')], parts: [key('Q1', 'a')] };
    expect(mergeWindowReads([{ window: { from: 1, to: 3, ahead: null, depth: 0 }, raw }]).raw).toBe(raw);
  });

  it('drops what a window copied from its look-ahead page, keeps a part that runs onto it, and dedupes', () => {
    const w1 = { from: 1, to: 2, ahead: 3, depth: 0 };
    const w2 = { from: 3, to: 4, ahead: null, depth: 0 };
    const tail = 'and then print the value of the variable x after the loop has ended';
    const { raw, stats } = mergeWindowReads([
      {
        window: w1,
        raw: {
          title: 'Finals Practice',
          blocks: [
            { type: 'heading', page: 1, level: 2, text: 'Loops' },
            part('Q1', 1, 'What does f print?'),
            // Starts on page 2, runs onto page 3: it is window 1's.
            { ...part('Q2', 2, 'Trace the loop'), prompt: [{ type: 'paragraph', page: 2, text: 'Trace the loop' }, { type: 'paragraph', page: 3, text: tail }] },
            // Starts on page 3: window 2's, though window 1 copied it.
            part('Q3', 3, 'Write a function'),
          ],
          parts: [key('Q1', 'a1'), key('Q2', 'a2'), key('Q3', 'from window 1')],
        },
      },
      {
        window: w2,
        raw: {
          title: 'Finals Practice',
          blocks: [
            // The running title, and the continuation of Q2 the window should have skipped.
            { type: 'heading', page: 3, level: 2, text: 'Finals Practice' },
            { type: 'paragraph', page: 3, text: tail },
            part('Q3', 3, 'Write a function'),
            // A different question the sheet also numbers 1 (a second section).
            part('Q1', 4, 'Section B: what is a pointer?'),
          ],
          parts: [key('Q3', 'from window 2'), key('Q1', 'b1')],
        },
      },
    ]);
    const blocks = raw.blocks as { type: string; id?: string; text?: string }[];
    expect(blocks.filter((b) => b.type === 'part').map((b) => b.id)).toEqual(['Q1', 'Q2', 'Q3', 'Q1-w2']);
    expect(blocks.some((b) => b.type === 'paragraph' && b.text === tail)).toBe(false);
    expect(blocks.filter((b) => b.type === 'heading').map((b) => b.text)).toEqual(['Loops']);
    const keys = raw.parts as { partId: string; answer: string }[];
    expect(keys.map((k) => `${k.partId}=${k.answer}`)).toEqual(['Q1=a1', 'Q2=a2', 'Q3=from window 2', 'Q1-w2=b1']);
    expect(stats).toEqual({ aheadDropped: 1, duplicatesDropped: 2, idsRenamed: 1 });

    // And the joined answer validates as a whole sheet would: unique ids, a key for each part.
    const checked = validateTutorial(raw, {
      pageCount: 4,
      fallbackTitle: 'x',
      notesBlockIds: [],
      isLecturePage: () => false,
      objectiveIds: new Set(),
    })!;
    expect(checked.parts.map((p) => p.partId)).toEqual(['Q1', 'Q2', 'Q3', 'Q1-w2']);
    expect(checked.repairs.keysMissing).toBe(0);
    expect(new Set(checked.parts.map((p) => p.partId)).size).toBe(4);
  });

  it('keeps one copy of a part both sides of a boundary copied, even when its page was given wrong', () => {
    const { raw, stats } = mergeWindowReads([
      { window: { from: 1, to: 1, ahead: 2, depth: 0 }, raw: { title: 'T', blocks: [part('Q5', 1, 'Explain why the invariant holds at the start')], parts: [key('Q5', 'x')] } },
      { window: { from: 2, to: 2, ahead: null, depth: 0 }, raw: { title: 'T', blocks: [part('Q5', 2, 'Explain why the invariant holds at the start of every iteration')], parts: [key('Q5', 'y')] } },
    ]);
    expect((raw.blocks as unknown[]).length).toBe(1);
    expect((raw.parts as { answer: string }[]).map((k) => k.answer)).toEqual(['x']);
    expect(stats.duplicatesDropped).toBe(1);
  });
});

describe('batching', () => {
  it('runs in order with a limit', async () => {
    let running = 0;
    let most = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(most).toBe(2);
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

/**
 * A long sheet read in page windows (`windows.ts`; field study and its red team, 2026-11-18): the
 * plan, cutting a cut-off window smaller, notices in place of a failed read, and the join, which
 * must never invent, lose or mis-key a part. The merge cases are the red team's (`merge.ts`).
 */
import { describe, expect, it } from 'vitest';
import {
  batches,
  mapLimit,
  MAX_TRUNCATIONS,
  mergeWindowReads,
  noticeText,
  planWindows,
  readWindows,
  similarity,
  splitWindow,
  wholeAnswer,
  WINDOW_CHARS,
  WINDOW_PAGES,
  WindowDeclined,
  WindowEmpty,
  WindowTruncated,
  type SheetWindow,
  type WindowRead,
} from './windows.js';
import { validateTutorial } from './validate.js';

/** The participant's paper: 35 pages, 33,525 characters, page by page (pdftotext). */
const EXAM_PAGES = [
  822, 547, 1592, 584, 695, 828, 1114, 880, 785, 546, 428, 554, 503, 634, 437, 635, 1122, 311, 696, 599, 1175, 1811, 1002, 558,
  568, 705, 842, 270, 465, 719, 744, 568, 742, 713, 603,
];

const VALIDATION = { fallbackTitle: 'x', notesBlockIds: [], isLecturePage: () => false, objectiveIds: new Set<string>() };

describe('planning the windows', () => {
  it('reads a short sheet in one call, as before', () => {
    expect(planWindows([2_000, 2_500, 1_800, 2_200])).toEqual([{ from: 1, to: 4, ahead: null, depth: 0 }]);
    expect(planWindows([])).toEqual([{ from: 1, to: 1, ahead: null, depth: 0 }]);
  });

  it('cuts the 35-page exam into windows that cover every page once, each looking one page ahead', () => {
    const plan = planWindows(EXAM_PAGES);
    expect(plan).toHaveLength(7);
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

  it('halves a long window, the first half looking into the second, and cuts a short one into pages', () => {
    expect(splitWindow({ from: 6, to: 10, ahead: 11, depth: 0 })).toEqual([
      { from: 6, to: 8, ahead: 9, depth: 1 },
      { from: 9, to: 10, ahead: 11, depth: 1 },
    ]);
    expect(splitWindow({ from: 6, to: 8, ahead: 9, depth: 1 })).toEqual([
      { from: 6, to: 6, ahead: 7, depth: 2 },
      { from: 7, to: 7, ahead: 8, depth: 2 },
      { from: 8, to: 8, ahead: 9, depth: 2 },
    ]);
    expect(splitWindow({ from: 4, to: 4, ahead: 5, depth: 0 })).toBeNull();
  });
});

describe('reading the windows', () => {
  const ok = (w: SheetWindow) => ({ title: 'T', blocks: [{ type: 'part', id: `P${w.from}`, page: w.from }], parts: [{ partId: `P${w.from}`, answer: 'a' }] });

  it('reads every window and returns them in page order, telling progress', async () => {
    const seen: [number, number][] = [];
    const plan = planWindows(EXAM_PAGES);
    const out = await readWindows(plan, async (w) => ok(w), { progress: (d, t) => seen.push([d, t]) }, 3);
    expect(out.reads.map((r) => r.window.from)).toEqual(plan.map((w) => w.from));
    expect(out.splits).toBe(0);
    expect(out.notices).toEqual([]);
    // Progress is in pages, so it ends at the sheet's 35.
    expect(seen.at(-1)).toEqual([35, 35]);
  });

  it('cuts a window that came back cut off smaller, and reads the pieces', async () => {
    const plan: SheetWindow[] = [{ from: 1, to: 4, ahead: 5, depth: 0 }, { from: 5, to: 6, ahead: null, depth: 0 }];
    const asked: string[] = [];
    let last: [number, number] = [0, 0];
    const out = await readWindows(
      plan,
      async (w) => {
        asked.push(`${w.from}-${w.to}`);
        if (w.to - w.from >= 2) throw new WindowTruncated('max_tokens');
        return ok(w);
      },
      { progress: (d, t) => (last = [d, t]) },
      1,
    );
    expect(asked).toEqual(['1-4', '1-2', '3-4', '5-6']);
    expect(out.reads.map((r) => `${r.window.from}-${r.window.to}`)).toEqual(['1-2', '3-4', '5-6']);
    expect(out.splits).toBe(1);
    expect(last).toEqual([6, 6]);
  });

  it('makes a page that never fits a notice, lands the rest, and pays at most three answers for it', async () => {
    let calls = 0;
    const out = await readWindows([{ from: 1, to: 5, ahead: 6, depth: 0 }, { from: 6, to: 7, ahead: null, depth: 0 }], async (w) => {
      calls += 1;
      if (w.from <= 3 && 3 <= w.to) throw new WindowTruncated('max_tokens');
      return ok(w);
    }, {}, 1);
    expect(out.notices).toEqual([{ from: 3, to: 3, reason: 'too_long' }]);
    expect(out.reads.map((r) => r.window.from)).toEqual([1, 2, 4, 6]);
    // 1–5, then 1–3, then 3 alone: three cut-off answers for page 3; 1, 2, 4–5, 6–7 read once.
    expect(calls).toBe(7);
    expect(noticeText(out.notices[0]!, 7)).not.toMatch(/split/i);
  });

  it(`stops cutting after ${MAX_TRUNCATIONS} cut-off answers in one read`, async () => {
    let calls = 0;
    const out = await readWindows([{ from: 1, to: 8, ahead: null, depth: 0 }], async () => {
      calls += 1;
      throw new WindowTruncated('max_tokens');
    }, {}, 1);
    // 1–8, 1–4, 1–2 and 1 are cut off: the budget is spent, and nothing more is asked.
    expect(calls).toBe(MAX_TRUNCATIONS);
    expect(out.notices.map((n) => `${n.from}-${n.to}:${n.reason}`)).toEqual(['1-1:too_long', '2-2:not_read', '3-4:not_read', '5-8:not_read']);
    expect(MAX_TRUNCATIONS).toBe(4);
  });

  it('never pays for more than four cut-off answers, even two at a time on a sheet that never fits', async () => {
    let calls = 0;
    let cut = 0;
    const plan = planWindows(Array(12).fill(1_800));
    const seen: number[] = [];
    const out = await readWindows(plan, async () => {
      calls += 1;
      cut += 1;
      throw new WindowTruncated('max_tokens');
    }, { progress: (d) => seen.push(d) }, 2);
    expect(cut).toBeLessThanOrEqual(4);
    expect(calls).toBeLessThanOrEqual(plan.length + 4);
    // Every page is in a notice, and progress never went back.
    const covered = out.notices.flatMap((n) => Array.from({ length: n.to - n.from + 1 }, (_, i) => n.from + i)).sort((a, b) => a - b);
    expect(covered).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it('makes a window empty twice a notice', async () => {
    const out = await readWindows([{ from: 1, to: 2, ahead: 3, depth: 0 }, { from: 3, to: 4, ahead: null, depth: 0 }], async (w) => {
      if (w.from === 3) throw new WindowEmpty();
      return ok(w);
    });
    expect(out.notices).toEqual([{ from: 3, to: 4, reason: 'empty' }]);
  });

  it('makes a declined window a notice', async () => {
    const out = await readWindows([{ from: 1, to: 2, ahead: 3, depth: 0 }, { from: 3, to: 4, ahead: null, depth: 0 }], async (w) => {
      if (w.from === 3) throw new WindowDeclined();
      return ok(w);
    });
    expect(out.notices).toEqual([{ from: 3, to: 4, reason: 'declined' }]);
    expect(out.reads).toHaveLength(1);
  });

  it('stops on a transport failure, but lets the windows in flight finish', async () => {
    const boom = Object.assign(new Error('529 overloaded'), { status: 529 });
    const finished: number[] = [];
    const run = readWindows(
      [{ from: 1, to: 2, ahead: 3, depth: 0 }, { from: 3, to: 4, ahead: 5, depth: 0 }, { from: 5, to: 6, ahead: null, depth: 0 }],
      async (w) => {
        if (w.from === 1) throw boom;
        await new Promise((r) => setTimeout(r, 5));
        finished.push(w.from);
        return ok(w);
      },
      {},
      2,
    );
    await expect(run).rejects.toBe(boom);
    // Window 3–4 was in flight and finished (the caller keeps it); 5–6 was never started.
    expect(finished).toEqual([3]);
  });

  it('knows a whole answer from a fragment', () => {
    expect(wholeAnswer({ title: 'x', blocks: [], parts: [] })).toBe(true);
    // The logged failure's 77 characters: an inner block of the cut-off JSON.
    expect(wholeAnswer({ type: 'heading', page: 1, text: 'Expressions and function calls', level: 2 })).toBe(false);
    expect(wholeAnswer(null)).toBe(false);
  });
});

describe('joining the windows (the red team cases)', () => {
  const part = (id: string, page: number | null, words: string, label = id) => ({
    type: 'part',
    id,
    label,
    page,
    prompt: [{ type: 'paragraph', page, text: words }],
    answer: { kind: 'text' },
  });
  const key = (partId: string, answer: string) => ({ partId, answer });
  const w1: SheetWindow = { from: 1, to: 5, ahead: 6, depth: 0 };
  const w2: SheetWindow = { from: 6, to: 10, ahead: null, depth: 0 };
  const join = (reads: WindowRead[]) => {
    const { raw, stats } = mergeWindowReads(reads);
    const checked = validateTutorial(raw, { ...VALIDATION, pageCount: 10 })!;
    const keyOf = new Map(checked.parts.map((p) => [p.partId, p.key.answer]));
    return { raw, stats, checked, ids: checked.parts.map((p) => p.partId), keyOf };
  };

  it('passes one clean window through untouched', () => {
    const raw = { title: 'T', blocks: [part('P1', 1, 'x')], parts: [key('P1', 'a')] };
    expect(mergeWindowReads([{ window: { from: 1, to: 3, ahead: null, depth: 0 }, raw }]).raw).toBe(raw);
  });

  it('A: drops a tail the next window re-copied, and keeps the part with its code', () => {
    const { ids, keyOf, stats } = join([
      { window: w1, raw: { title: 'T', blocks: [part('P9', 5, 'Consider moo below. long moo(long a[], long n) { ... } Trace the loop and give every row at Line Z until it returns.')], parts: [key('P9', 'K9 from w1')] } },
      { window: w2, raw: { title: 'T', blocks: [part('P9', 5, 'Trace the loop and give every row at Line Z until it returns.'), part('P10', 6, 'Given an array a of length n')], parts: [key('P9', 'K9 from w2'), key('P10', 'K10')] } },
    ]);
    expect(ids).toEqual(['P9', 'P10']);
    expect(keyOf.get('P9')).toBe('K9 from w1');
    expect(stats.tailsDropped).toBe(1);
  });

  it('B: two parts the model called P1 in a later window each keep their own key', () => {
    const { ids, keyOf } = join([
      { window: w1, raw: { title: 'T', blocks: [part('P1', 1, 'Section A question one about loops', 'Question 1')], parts: [key('P1', 'A1')] } },
      { window: w2, raw: { title: 'T', blocks: [part('P1', 6, 'Section B question one about pointers', 'Question 1'), part('P1', 7, 'Section C question one about recursion', 'Question 1')], parts: [key('P1', 'B1 key'), key('P1', 'C1 key')] } },
    ]);
    expect(ids).toEqual(['P1', 'P1-2', 'P1-3']);
    expect([keyOf.get('P1'), keyOf.get('P1-2'), keyOf.get('P1-3')]).toEqual(['A1', 'B1 key', 'C1 key']);
  });

  it('B, one window: numbering that restarts inside a whole-sheet answer keeps each key with its part', () => {
    const checked = validateTutorial(
      { title: 'T', blocks: [part('P1', 1, 'Section A one'), part('P2', 1, 'Section A two'), part('P1', 2, 'Section B one'), part('P2', 2, 'Section B two')], parts: [key('P1', 'a1'), key('P2', 'a2'), key('P1', 'b1'), key('P2', 'b2')] },
      { ...VALIDATION, pageCount: 2 },
    )!;
    expect(checked.parts.map((p) => `${p.partId}=${p.key.answer}`)).toEqual(['P1=a1', 'P2=a2', 'P1-2=b1', 'P2-2=b2']);
    expect(checked.repairs.keysMissing).toBe(0);
  });

  it('C: printed page numbers ahead of the PDF page lose nothing', () => {
    const { ids, stats } = join([
      { window: w1, raw: { title: 'T', blocks: [part('P1', 13, 'q one'), part('P2', 15, 'q two')], parts: [key('P1', 'a'), key('P2', 'b')] } },
      { window: w2, raw: { title: 'T', blocks: [part('P3', 18, 'q three')], parts: [key('P3', 'c')] } },
    ]);
    expect(ids).toEqual(['P1', 'P2', 'P3']);
    expect(stats.pagesMapped).toBe(3);
  });

  it('D: two questions that share an opening sentence are both kept', () => {
    const stem = 'Write C for a compile error or UB for undefined behavior or non-termination. Consider the following code and write exactly what is printed';
    const { ids } = join([
      { window: w1, raw: { title: 'T', blocks: [part('P1', 2, `${stem} int x = 1; for (x = 1; x < 10; x *= 2) printf x`, 'Question 1')], parts: [key('P1', 'a')] } },
      { window: w2, raw: { title: 'T', blocks: [part('P1', 7, `${stem} long *p = 0; long q = *p; printf q twice then return`, 'Question 1')], parts: [key('P1', 'b')] } },
    ]);
    expect(ids).toEqual(['P1', 'P1-2']);
    expect(similarity('a b c', 'a b c')).toBe(1);
  });

  it('E: a look-ahead copy with no page and its owner\'s copy land once, with the owner\'s key', () => {
    const { ids, keyOf } = join([
      { window: w1, raw: { title: 'T', blocks: [part('P5', 5, 'five'), part('P6', null, 'six is about arrays and their bounds')], parts: [key('P5', 'a'), key('P6', 'six from w1')] } },
      { window: w2, raw: { title: 'T', blocks: [part('P6', 6, 'six is about arrays and their bounds'), part('P7', 7, 'seven')], parts: [key('P6', 'six from w2'), key('P7', 'c')] } },
    ]);
    expect(ids).toEqual(['P5', 'P6', 'P7']);
    expect(keyOf.get('P6')).toBe('six from w1');
  });

  it('E2: a part copied from the look-ahead page yields to the window that owns the page', () => {
    const { ids, keyOf } = join([
      { window: w1, raw: { title: 'T', blocks: [part('P5', 5, 'five'), part('P6', 6, 'six is about arrays and their bounds')], parts: [key('P5', 'a'), key('P6', 'six from w1')] } },
      { window: w2, raw: { title: 'T', blocks: [part('P6', 6, 'six is about arrays and their bounds'), part('P7', 7, 'seven')], parts: [key('P6', 'six from w2'), key('P7', 'c')] } },
    ]);
    expect(ids).toEqual(['P5', 'P6', 'P7']);
    expect(keyOf.get('P6')).toBe('six from w2');
  });

  it('F: an empty window is counted, and its notice lands where its pages were', () => {
    const { raw, stats } = mergeWindowReads(
      [
        { window: w1, raw: { title: 'T', blocks: [part('P1', 1, 'one')], parts: [key('P1', 'a')] } },
        { window: w2, raw: { title: 'T', blocks: [], parts: [] } },
        { window: { from: 11, to: 12, ahead: null, depth: 0 }, raw: { title: 'T', blocks: [part('P2', 11, 'two')], parts: [key('P2', 'b')] } },
      ],
      [{ from: 13, to: 13, reason: 'too_long' }],
      13,
    );
    expect(stats.emptyWindows).toBe(1);
    const blocks = raw.blocks as { type: string; text?: string; admin?: boolean }[];
    expect(blocks.map((b) => b.type)).toEqual(['part', 'part', 'paragraph']);
    expect(blocks[2]!.text).toMatch(/^\*Max could not read page 13 of this sheet/);
    // Not housekeeping: a notice is never folded under "Course admin".
    expect(blocks[2]!.admin).toBeUndefined();
  });

  it('drops an answer grid that repeats the questions, and keeps every question', () => {
    const questions = [1, 2, 3, 4, 5, 6].map((n) => part(`P${n}`, n, `Question ${n} asks what the following loop prints when n is ${n * 3}`, `Question ${n}`));
    const grid = [1, 2, 3, 4, 5, 6].map((n) => ({ ...part(`P${n}`, 7, 'A B C D E'), label: `Question ${n}` }));
    const { ids, stats } = join([
      { window: w1, raw: { title: 'T', blocks: questions.slice(0, 5), parts: [1, 2, 3, 4, 5].map((n) => key(`P${n}`, `k${n}`)) } },
      { window: w2, raw: { title: 'T', blocks: [questions[5]!, ...grid], parts: [key('P6', 'k6'), ...grid.map((g) => key(g.id, 'grid'))] } },
    ]);
    expect(ids).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
    expect(stats.gridDropped).toBe(6);
  });

  it('keeps one copy of the running title and of a continuation copied twice', () => {
    const tail = 'and then print the value of the variable x after the loop has ended';
    const { raw, ids } = join([
      { window: w1, raw: { title: 'Finals Practice', blocks: [{ type: 'heading', page: 1, level: 2, text: 'Loops' }, { ...part('P2', 5, 'Trace the loop'), prompt: [{ type: 'paragraph', page: 5, text: 'Trace the loop' }, { type: 'paragraph', page: 6, text: tail }] }], parts: [key('P2', 'a2')] } },
      { window: w2, raw: { title: 'Finals Practice', blocks: [{ type: 'heading', page: 6, level: 2, text: 'Finals Practice' }, { type: 'paragraph', page: 6, text: tail }, part('P3', 6, 'Write a function')], parts: [key('P3', 'a3')] } },
    ]);
    expect(ids).toEqual(['P2', 'P3']);
    const texts = (raw.blocks as { type: string; text?: string }[]).filter((b) => b.type !== 'part').map((b) => b.text);
    expect(texts).toEqual(['Loops']);
  });
});

describe('joining the windows (the acceptance test cases, 2026-11-19)', () => {
  const part = (id: string, label: string, page: number, text: string) => ({ type: 'part', id, label, page, prompt: [{ type: 'paragraph', page, text }], answer: { kind: 'text' } });
  const key = (id: string, answer: string) => ({ partId: id, answer });
  const W = (from: number, to: number, ahead: number | null) => ({ from, to, ahead, depth: 0 });
  const ids = (raw: Record<string, unknown>, pageCount: number) =>
    validateTutorial(raw, { ...VALIDATION, pageCount })!.parts.map((p) => `${p.partId}=${p.key.answer}`);

  it('M1: a single window keeps short sub-parts that share a label with an earlier part', () => {
    const raw = { title: 'T', blocks: [part('P9a', '(a)', 1, 'Trace the loop and show i at each step of the six iterations.'), part('P9b', '(b)', 1, 'What is the content of array a when moo returns at the end?'),
      { type: 'paragraph', page: 2, text: 'Question 13. Each statement is tested separately.' },
      part('P13a', '(a)', 2, 'p = a + 1;'), part('P13b', '(b)', 2, "p[0] = 'b';"), part('P13c', '(c)', 2, 'Why?')],
      parts: [key('P9a', '1 2 3'), key('P9b', '{7,8,9}'), key('P13a', 'Valid'), key('P13b', 'Compile error'), key('P13c', 'because')] };
    expect(ids(mergeWindowReads([{ window: W(1, 2, null), raw }], [], 2).raw, 2)).toEqual(['P9a=1 2 3', 'P9b={7,8,9}', 'P13a=Valid', 'P13b=Compile error', 'P13c=because']);
  });

  it('M2: parallel sub-parts in adjacent windows that differ only in their names are two parts', () => {
    const a = { title: 'T', blocks: [part('P10a', '(a)', 5, 'Write the values of c and m at Line M for each iteration of the loop in the answer sheet with n = 5.')], parts: [key('P10a', 'trace A')] };
    const b = { title: 'T', blocks: [part('P11a', '(a)', 6, 'Write the values of i and j at Line M for each iteration of the loop in the answer sheet with n = 5.')], parts: [key('P11a', 'trace B')] };
    expect(ids(mergeWindowReads([{ window: W(1, 5, 6), raw: a }, { window: W(6, 10, null), raw: b }], [], 10).raw, 10)).toEqual(['P10a=trace A', 'P11a=trace B']);
  });

  it('M2b: the same label and nearly the same words, but different names, on the shared page', () => {
    const a = { title: 'T', blocks: [part('', '(a)', 5, 'Write the values of c and m at Line M for each iteration of the loop with n = 5.')], parts: [] };
    const b = { title: 'T', blocks: [part('', '(a)', 6, 'Write the values of i and j at Line M for each iteration of the loop with n = 5.')], parts: [] };
    expect((mergeWindowReads([{ window: W(1, 5, 6), raw: a }, { window: W(6, 10, null), raw: b }], [], 10).raw.blocks as unknown[]).length).toBe(2);
  });

  it('M3: numbering that restarts, across and within windows, keeps every short question and its key', () => {
    const a = { title: 'T', blocks: [part('P1', 'Question 1', 1, 'Compute 3 + 4.'), part('P2', 'Question 2', 2, 'Compute 5 + 6.'), part('P1', 'Question 1', 4, 'Compute 20 - 1.')], parts: [key('P1', '7'), key('P2', '11'), key('P1', '19')] };
    const b = { title: 'T', blocks: [part('P2', 'Question 2', 6, 'Compute 30 - 2.'), part('P3', 'Question 3', 7, 'Compute 40 - 3.')], parts: [key('P2', '28'), key('P3', '37')] };
    expect(ids(mergeWindowReads([{ window: W(1, 5, 6), raw: a }, { window: W(6, 8, null), raw: b }], [], 8).raw, 8)).toEqual(['P1=7', 'P2=11', 'P1-2=19', 'P2-2=28', 'P3=37']);
  });

  it('M6: identical boilerplate questions with their own ids in adjacent windows are both kept', () => {
    const stem = 'Write C for a compile error or UB for undefined behavior or non-termination. Write exactly what is printed, or C/UB as specified.';
    const a = { title: 'T', blocks: [part('P5', 'Question', 5, stem)], parts: [key('P5', '1 2 4 8 16')] };
    const b = { title: 'T', blocks: [part('P6', 'Question', 6, stem)], parts: [key('P6', 'ABCDFEG')] };
    expect(ids(mergeWindowReads([{ window: W(1, 5, 6), raw: a }, { window: W(6, 10, null), raw: b }], [], 10).raw, 10)).toEqual(['P5=1 2 4 8 16', 'P6=ABCDFEG']);
  });

  it('says one sentence for many pages of one kind', () => {
    const { raw } = mergeWindowReads(
      [{ window: W(1, 2, 3), raw: { title: 'T', blocks: [part('P1', 'Q1', 1, 'one')], parts: [] } }],
      [{ from: 3, to: 3, reason: 'too_long' }, { from: 5, to: 5, reason: 'too_long' }, { from: 9, to: 10, reason: 'too_long' }],
      10,
    );
    const notes = (raw.blocks as { type: string; text?: string }[]).filter((b) => b.type === 'paragraph');
    expect(notes.map((b) => b.text)).toEqual(['*Max could not read pages 3, 5 and 9–10 of this sheet: each holds more than one answer can carry. Work from the PDF for those pages.*']);
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

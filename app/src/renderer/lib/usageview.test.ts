import { describe, expect, it } from 'vitest';
import {
  BACKEND_LABEL,
  FILTER_EMPTY_NOTE,
  LEDGER_EMPTY_NOTE,
  OUTCOME_GLYPH,
  OUTCOME_NOTE,
  PANEL_EMPTY,
  SURFACE_GAP,
  axisTicks,
  backendWord,
  barColumn,
  barPath,
  cacheSplit,
  callsWord,
  columnLayout,
  columnPath,
  dayAxisStep,
  dayLabel,
  docBars,
  emptyNote,
  fitText,
  isLedgerEmpty,
  msLabel,
  niceStep,
  outcomeHeadline,
  pct,
  queryFor,
  rateCardNote,
  reportedLine,
  reportedParts,
  scopeWord,
  sinceFor,
  sliceBars,
} from './usageview.js';
import {
  emptyTokens,
  totalTokens,
  type CostAnalytics,
  type CostCacheStats,
  type CostDayRow,
  type CostDocumentRow,
  type CostSlice,
  type CostTokens,
} from '../../shared/cost.js';

function tokens(over: Partial<CostTokens> = {}): CostTokens {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, ...over };
}

function doc(fileId: string, ingest: number, talk: number, over: Partial<CostDocumentRow> = {}): CostDocumentRow {
  return {
    fileId,
    title: fileId,
    calls: 10,
    tokens: tokens({ input: ingest + talk }),
    estimatedUsd: 0,
    reportedUsd: null,
    ingest: { calls: 2, tokens: tokens({ input: ingest }), estimatedUsd: 0 },
    conversation: { calls: 8, tokens: tokens({ input: talk }), estimatedUsd: 0 },
    firstCallAt: null,
    lastCallAt: null,
    ...over,
  };
}

function slice(key: string, n: number, calls = 1): CostSlice {
  return { key, calls, tokens: tokens({ input: n }), estimatedUsd: 0, reportedUsd: null };
}

function day(date: string, n: number, calls = 1): CostDayRow {
  return { day: date, calls, tokens: tokens({ input: n }), estimatedUsd: 0 };
}

// ── the filter row ──────────────────────────────────────────────────────────

describe('the time range builds its own `since`', () => {
  const now = new Date('2026-09-20T10:30:00.000Z');

  it('asks for everything by omitting `since` entirely', () => {
    expect(sinceFor('all', now)).toBeNull();
    expect(queryFor({ range: 'all', fileId: null, backend: null }, now)).toEqual({});
  });

  it('sends the sentinel for this session rather than guessing when the app launched', () => {
    // Only the main process knows its own start time, and a renderer's guess is wrong across a
    // relaunch — `shared/cost.ts` CostSummaryQuery.since.
    expect(sinceFor('session', now)).toBe('session');
  });

  it('counts back exactly seven and thirty days, in UTC', () => {
    expect(sinceFor('7d', now)).toBe('2026-09-13T10:30:00.000Z');
    expect(sinceFor('30d', now)).toBe('2026-08-21T10:30:00.000Z');
  });

  it('carries the document and backend filters through untouched', () => {
    expect(queryFor({ range: '7d', fileId: 'file_btw', backend: 'claude-cli' }, now)).toEqual({
      since: '2026-09-13T10:30:00.000Z',
      fileId: 'file_btw',
      backend: 'claude-cli',
    });
  });

  it('never sends an empty document or backend as a filter', () => {
    expect(queryFor({ range: 'all', fileId: '', backend: null }, now)).toEqual({});
  });

  it('names backends the way Settings names them in the menu, shorter in a chart row', () => {
    expect(BACKEND_LABEL['claude-cli']).toBe('Claude Code on this Mac');
    expect(backendWord('claude-cli')).toBe('Claude Code');
    // A label column that cannot hold the long form would print "Claude Code on th…".
    expect(backendWord('claude-cli').length).toBeLessThan(BACKEND_LABEL['claude-cli'].length);
    expect(backendWord('something-else')).toBe('something-else');
  });

  it('never shows a raw scope key', () => {
    expect(scopeWord('notes')).toBe('Lecture notes');
    expect(scopeWord('ingest')).toBe('Setup');
    expect(scopeWord('objectives')).toBe('Objectives');
  });
});

// ── scales ──────────────────────────────────────────────────────────────────

describe('the axis lands on numbers a person reads', () => {
  it('snaps a raw step onto the 1 / 2 / 5 ladder', () => {
    expect(niceStep(1)).toBe(1);
    expect(niceStep(1.4)).toBe(2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(57_203)).toBe(100_000);
    expect(niceStep(0.03)).toBe(0.05);
  });

  it('rounds the top of the scale up, so the tallest bar is never taller than the axis', () => {
    const axis = axisTicks(228_813);
    expect(axis.max).toBe(300_000);
    expect(axis.values).toEqual([0, 100_000, 200_000, 300_000]);
    expect(axis.max).toBeGreaterThanOrEqual(228_813);
  });

  it('gives an all-zero series a real axis rather than dividing by zero', () => {
    expect(axisTicks(0)).toEqual({ values: [0], max: 1 });
    expect(axisTicks(Number.NaN)).toEqual({ values: [0], max: 1 });
  });

  it('survives a non-positive step request', () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-4)).toBe(1);
  });
});

describe('mark paths', () => {
  it('draws a column square at the baseline and rounded on the cap', () => {
    const d = columnPath(10, 20, 12, 40, 4);
    // Starts at the baseline corner (bottom-left), closes along the baseline: no rounding there.
    expect(d.startsWith('M10,60')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).toContain('Q');
  });

  it('draws nothing at all for a zero-height column, rather than a sliver or a NaN', () => {
    expect(columnPath(10, 20, 12, 0)).toBe('');
    expect(columnPath(10, 20, 0, 40)).toBe('');
  });

  it('never rounds a bar by more than it is long', () => {
    const d = barPath(0, 0, 2, 10, 4);
    expect(d).not.toContain('NaN');
    expect(d.length).toBeGreaterThan(0);
    expect(barPath(0, 0, 0, 10)).toBe('');
  });
});

describe('a label that will not fit is shortened, never clipped', () => {
  it('leaves a label that fits exactly as it is', () => {
    expect(fitText('Setup', 200)).toBe('Setup');
  });

  it('ellipsizes rather than running into the next column', () => {
    const out = fitText('CS3249 Lecture 4 — convexity.pdf', 60);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThan('CS3249 Lecture 4 — convexity.pdf'.length);
  });

  it('degrades to a single ellipsis, and to nothing, rather than overflowing', () => {
    expect(fitText('anything', 8)).toBe('…');
    expect(fitText('anything', 0)).toBe('');
  });
});

// ── the ranked documents ────────────────────────────────────────────────────

describe('the ranked documents, split into the one-off and the ongoing', () => {
  const rows = [doc('small', 96_000, 3_400), doc('big', 340_000, 210_000), doc('mid', 288_000, 24_000)];

  it('ranks by total tokens, biggest first', () => {
    const bars = docBars(rows, 400);
    expect(bars.rows.map((r) => r.fileId)).toEqual(['big', 'mid', 'small']);
    expect(bars.max).toBe(550_000);
  });

  it('scales every bar against the largest row, so the rows compare with each other', () => {
    const bars = docBars(rows, 400);
    const [big, mid] = bars.rows;
    const bigTotal = big!.segments.reduce((n, s) => n + s.w, 0) + SURFACE_GAP;
    const midTotal = mid!.segments.reduce((n, s) => n + s.w, 0) + SURFACE_GAP;
    expect(bigTotal).toBeCloseTo(400, 5);
    expect(midTotal).toBeCloseTo((312_000 / 550_000) * 400, 5);
  });

  it('takes the surface gap out of the bar rather than adding it on the end', () => {
    // Otherwise every stacked row overstates its own total by 2px, which on a short bar is real.
    const bars = docBars(rows, 400);
    const big = bars.rows[0]!;
    const drawn = big.segments[1]!.x + big.segments[1]!.w;
    expect(drawn).toBeCloseTo(400, 5);
    expect(big.segments[1]!.x - big.segments[0]!.w).toBe(SURFACE_GAP);
  });

  it('reports the ingest share the same way the bar draws it', () => {
    const bars = docBars(rows, 400);
    const big = bars.rows[0]!;
    expect(big.ingestShare).toBeCloseTo(340_000 / 550_000, 6);
    expect(big.summary).toContain('62%');
    expect(big.summary).toContain('setup');
  });

  it('rounds only the outer end of a stack, so an interior boundary is not a notch', () => {
    const bars = docBars(rows, 400);
    expect(bars.rows[0]!.segments.map((s) => s.round)).toEqual([false, true]);
  });

  it('opens no gap when one side of the split is empty', () => {
    const bars = docBars([doc('ingest only', 100_000, 0)], 300);
    const row = bars.rows[0]!;
    expect(row.segments).toHaveLength(1);
    expect(row.segments[0]!.w).toBeCloseTo(300, 5);
  });

  it('folds the tail into a line rather than bars nobody can read', () => {
    const many = Array.from({ length: 9 }, (_, i) => doc(`f${i}`, 1_000 * (9 - i), 0));
    const bars = docBars(many, 300, 6);
    expect(bars.rows).toHaveLength(6);
    expect(bars.hidden).toEqual({ count: 3, tokens: 1_000 + 2_000 + 3_000 });
  });

  it('draws nothing and divides by nothing when every document is empty', () => {
    const bars = docBars([doc('a', 0, 0)], 300);
    expect(bars.max).toBe(0);
    expect(bars.rows[0]!.segments.every((s) => s.w === 0)).toBe(true);
    expect(bars.rows[0]!.ingestShare).toBe(0);
    expect(bars.hidden).toBeNull();
  });

  it('is empty, not broken, with no documents at all', () => {
    expect(docBars([], 300)).toEqual({ rows: [], hidden: null, max: 0 });
  });
});

// ── the ranked slices ───────────────────────────────────────────────────────

describe('the by-scope / by-model bars', () => {
  const slices = [slice('group', 200, 12), slice('notes', 500, 6), slice('ledger', 100, 4)];

  it('ranks by tokens and gives each row its share of the whole', () => {
    const bars = sliceBars(slices, 200, scopeWord);
    expect(bars.rows.map((r) => r.label)).toEqual(['Lecture notes', 'Agent turns', 'Ledger']);
    expect(bars.total).toBe(800);
    expect(bars.rows[0]!.share).toBeCloseTo(500 / 800, 6);
    expect(bars.rows[0]!.w).toBe(200);
    expect(bars.rows[1]!.w).toBeCloseTo((200 / 500) * 200, 6);
  });

  it('writes a summary that carries the value without the bar', () => {
    const bars = sliceBars(slices, 200, scopeWord);
    expect(bars.rows[0]!.summary).toBe('Lecture notes — 500 tokens (63%), 6 calls');
  });

  it('folds past the limit instead of growing the list', () => {
    const many = Array.from({ length: 11 }, (_, i) => slice(`s${i}`, 11 - i));
    const bars = sliceBars(many, 100, (k) => k, 8);
    expect(bars.rows).toHaveLength(8);
    expect(bars.folded).toEqual({ count: 3, tokens: 3 + 2 + 1 });
  });

  it('draws zero-width bars rather than NaN when nothing was spent', () => {
    const bars = sliceBars([slice('group', 0)], 200);
    expect(bars.rows[0]!.w).toBe(0);
    expect(bars.rows[0]!.share).toBe(0);
    expect(bars.total).toBe(0);
  });

  it('has no rows at all on an empty slice list', () => {
    expect(sliceBars([], 200).rows).toEqual([]);
  });

  it('gives the bar whatever the label and value columns did not take, and never less than nothing', () => {
    expect(barColumn(400, 112, 86, 20)).toBe(182);
    // A panel narrower than its own chrome must not hand a path a negative width.
    expect(barColumn(120)).toBe(0);
    expect(barColumn(0)).toBe(0);
  });
});

// ── over time ───────────────────────────────────────────────────────────────

describe('the day columns', () => {
  const rows: CostDayRow[] = [day('2026-09-14', 100), day('2026-09-15', 200), day('2026-09-16', 50)];

  it('keeps the date band inside the height it asks for, so the card cannot clip it', () => {
    const chart = columnLayout(rows, 600, 118);
    expect(chart.height).toBeGreaterThan(chart.plot.y + chart.plot.h);
    expect(chart.plot.x + chart.plot.w).toBeLessThanOrEqual(chart.width);
  });

  it('puts the tallest bar on the axis top and the rest in proportion to it', () => {
    const chart = columnLayout(rows, 600, 100);
    expect(chart.max).toBe(200);
    const tall = chart.bars[1]!;
    const short = chart.bars[2]!;
    expect(tall.h).toBeCloseTo(100, 5);
    expect(short.h).toBeCloseTo(25, 5);
    expect(tall.y).toBeCloseTo(chart.plot.y, 5);
  });

  it('caps the mark thickness rather than filling the slot', () => {
    const chart = columnLayout(rows, 900, 100);
    expect(chart.bars[0]!.w).toBeLessThanOrEqual(24);
  });

  it('keeps oldest left', () => {
    const chart = columnLayout(rows, 600, 100);
    expect(chart.bars.map((b) => b.key)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16']);
    expect(chart.bars[0]!.x).toBeLessThan(chart.bars[2]!.x);
  });

  it('says the dates are UTC in the text alternative', () => {
    const chart = columnLayout(rows, 600, 100);
    expect(chart.bars[0]!.summary).toBe('Sep 14 (UTC) — 100 tokens, 1 call');
  });

  it('draws flat bars and a real axis when every day is zero', () => {
    const chart = columnLayout([day('2026-09-14', 0), day('2026-09-15', 0)], 600, 100);
    expect(chart.max).toBe(1);
    expect(chart.bars.every((b) => b.h === 0)).toBe(true);
    expect(chart.ticks.every((t) => Number.isFinite(t.y))).toBe(true);
  });

  it('is a bare plot with no bars when there are no days', () => {
    const chart = columnLayout([], 600, 100);
    expect(chart.bars).toEqual([]);
    expect(chart.dayLabels).toEqual([]);
    expect(chart.plot.w).toBeGreaterThan(0);
  });

  it('thins the date labels so they cannot collide, and always dates the newest bar', () => {
    const fortnight = Array.from({ length: 14 }, (_, i) => day(`2026-09-${String(i + 7).padStart(2, '0')}`, 10));
    const chart = columnLayout(fortnight, 520, 100);
    const step = dayAxisStep(14, chart.plot.w);
    expect(step).toBeGreaterThan(1);
    expect(chart.dayLabels.at(-1)!.text).toBe('Sep 20');
    expect(chart.dayLabels.length).toBeLessThan(14);
  });

  it('labels every bar when there is room for it', () => {
    expect(dayAxisStep(3, 600)).toBe(1);
    expect(dayAxisStep(1, 600)).toBe(1);
    expect(dayAxisStep(0, 600)).toBe(1);
  });

  it('dates a UTC day without running it through the local calendar', () => {
    expect(dayLabel('2026-01-01')).toBe('Jan 1');
    expect(dayLabel('2026-12-31')).toBe('Dec 31');
    expect(dayLabel('not-a-day')).toBe('not-a-day');
  });
});

// ── the cache split ─────────────────────────────────────────────────────────

describe('the cache split', () => {
  const cache: CostCacheStats = { freshInput: 86, cacheRead: 288_291, cacheWrite: 41_000, hitShare: 288_291 / 288_377 };

  it('draws against the same denominator the percentage is printed from', () => {
    const split = cacheSplit(cache, 400);
    const drawn = split.segments.at(-1)!.x + split.segments.at(-1)!.w;
    expect(drawn).toBeCloseTo(400, 5);
    expect(split.total).toBe(288_377);
    expect(split.hitShare).toBe(cache.hitShare);
  });

  it('keeps cache writes out of the ratio — they are priced apart', () => {
    const split = cacheSplit(cache, 400);
    expect(split.segments.map((s) => s.key)).toEqual(['cacheRead', 'freshInput']);
    expect(split.segments.map((s) => s.round)).toEqual([false, true]);
    expect(split.cacheWrite).toBe(41_000);
    expect(split.total).toBe(cache.cacheRead + cache.freshInput);
  });

  it('says the whole thing in one sentence for a reader who cannot see the bar', () => {
    const split = cacheSplit(cache, 400);
    expect(split.summary).toContain('100%');
    expect(split.summary).toContain('cache reads');
  });

  it('has no segments and no NaN on an install that has sent nothing', () => {
    const split = cacheSplit({ freshInput: 0, cacheRead: 0, cacheWrite: 0, hitShare: 0 }, 400);
    expect(split.total).toBe(0);
    expect(split.segments.every((s) => s.w === 0)).toBe(true);
  });
});

// ── outcomes ────────────────────────────────────────────────────────────────

describe('outcomes: a stop is not a failure', () => {
  it('counts pre-empted and stopped apart from failed', () => {
    const line = outcomeHeadline([
      { outcome: 'ok', calls: 180 },
      { outcome: 'error', calls: 2 },
      { outcome: 'aborted', calls: 1 },
      { outcome: 'preempted', calls: 4 },
    ]);
    expect(line).toBe('2 failed · 4 pre-empted and re-queued · 1 stopped by you.');
    // The word "failed" never reaches the stopped count.
    expect(line.indexOf('failed')).toBeLessThan(line.indexOf('stopped'));
  });

  it('says so plainly when nothing went wrong', () => {
    expect(outcomeHeadline([{ outcome: 'ok', calls: 12 }])).toBe('Nothing failed, was stopped or was re-queued.');
    expect(outcomeHeadline([])).toBe('Nothing failed, was stopped or was re-queued.');
  });

  it('explains pre-emption in one clause and never calls a stop a failure', () => {
    expect(OUTCOME_NOTE.preempted).toContain('re-queued');
    expect(OUTCOME_NOTE.aborted).toContain('Not a failure');
    // Identity is a glyph, not a colour: nothing on this panel relies on hue.
    expect(new Set(Object.values(OUTCOME_GLYPH)).size).toBe(4);
  });
});

// ── words ───────────────────────────────────────────────────────────────────

describe('the percentages and the counts', () => {
  it('rounds a share, and refuses to round a real share down to zero', () => {
    expect(pct(0.8271)).toBe('83%');
    expect(pct(1)).toBe('100%');
    expect(pct(0)).toBe('0%');
    expect(pct(0.0004)).toBe('<1%');
    expect(pct(Number.NaN)).toBe('0%');
  });

  it('pluralises and groups the call counts', () => {
    expect(callsWord(1)).toBe('1 call');
    expect(callsWord(0)).toBe('0 calls');
    expect(callsWord(1_234)).toBe('1,234 calls');
  });

  it('prints a duration at a precision that does not pretend', () => {
    expect(msLabel(940)).toBe('940 ms');
    expect(msLabel(42_000)).toBe('42.0 s');
    expect(msLabel(null)).toBe('—');
  });
});

describe('the CLI-reported figure sits beside the estimate and is never added to it', () => {
  it('names itself, and says how many calls it covers', () => {
    expect(reportedLine(0.212, 152, 186)).toBe('CLI-reported $0.212 over 152 of 186 calls');
  });

  it('splits into a tile without hedging somebody else’s number as if it were ours', () => {
    expect(reportedParts(0.212, 152, 186)).toEqual({
      label: 'CLI-reported',
      figure: '$0.212',
      over: 'over 152 of 186 calls',
    });
  });

  it('says nothing at all when no call reported one', () => {
    expect(reportedLine(null, 0, 186)).toBeNull();
    expect(reportedParts(null, 0, 186)).toBeNull();
  });

  it('never presents a dollar figure as money spent', () => {
    expect(rateCardNote('2026-06-24')).toContain('not money anybody was charged');
    expect(rateCardNote('2026-06-24')).toContain('2026-06-24');
  });
});

// ── the empty cases ─────────────────────────────────────────────────────────

describe('an empty page is calm, not blank and not NaN', () => {
  it('tells a panel with no rows what to say, and a panel with rows to say nothing', () => {
    expect(emptyNote('documents', false)).toBe(PANEL_EMPTY.documents);
    expect(emptyNote('documents', true)).toBeNull();
  });

  it('says something different for each panel, so nine greyed boxes are not one message', () => {
    expect(PANEL_EMPTY.perMessage).not.toBe(PANEL_EMPTY.cache);
    expect(PANEL_EMPTY.documents).not.toBe(PANEL_EMPTY.days);
  });

  it('knows an empty ledger from a filter that matched nothing', () => {
    const base = {
      windowStart: null,
      windowEnd: null,
      fileId: null,
      backend: null,
      total: { calls: 0, tokens: emptyTokens(), estimatedUsd: 0, reportedUsd: null, reportedCalls: 0 },
      session: { calls: 0, tokens: emptyTokens(), estimatedUsd: 0 },
      documents: [],
      byScope: [],
      byModel: [],
      byBackend: [],
      byDay: [],
      outcomes: [],
      cache: { freshInput: 0, cacheRead: 0, cacheWrite: 0, hitShare: 0 },
      perMessage: {
        learnerMessages: 0,
        agentMessages: 0,
        meanUsdPerLearnerMessage: 0,
        medianUsdPerAgentMessage: 0,
        meanTokensPerLearnerMessage: 0,
        medianTokensPerAgentMessage: 0,
      },
      slowest: [],
      priciest: [],
      cliWindow: null,
      mode: 'none',
      rateCardDate: '2026-06-24',
      knownFiles: [],
      generatedAt: '2026-09-20T00:00:00.000Z',
    } satisfies CostAnalytics;

    expect(isLedgerEmpty(null)).toBe(true);
    expect(isLedgerEmpty(base)).toBe(true);
    // A deck the ledger knows about means the filter is the reason, not the install.
    expect(isLedgerEmpty({ ...base, knownFiles: [{ fileId: 'f', title: 'A deck' }] })).toBe(false);
    expect(LEDGER_EMPTY_NOTE).not.toBe(FILTER_EMPTY_NOTE);
  });
});

describe('the tokens a panel totals are the tokens the wire sent', () => {
  it('counts cache reads and writes in, exactly as `totalTokens` does', () => {
    const row = doc('x', 0, 0, { tokens: { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 } });
    const bars = docBars([row], 100);
    expect(bars.rows[0]!.tokens).toBe(totalTokens(row.tokens));
    expect(bars.rows[0]!.tokens).toBe(10);
  });
});

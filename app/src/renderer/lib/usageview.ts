/**
 * **The arithmetic behind the Usage page** (issue #42 item D).
 *
 * `shared/cost.ts` owns the wire shapes and the rules about what a number may be *called*;
 * `renderer/lib/cost.ts` owns the sentences a counter prints. This file owns the third thing a
 * page of charts needs and the other two deliberately do not have: **geometry, ranking and the
 * empty cases**.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE MATHS IS HERE AND NOT IN THE COMPONENTS
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A chart is a claim about proportion. `width = value / max * plotWidth` is the whole claim, and
 * it is exactly the kind of line that is wrong by a `Math.max` for a month before anybody notices
 * — because a bar that is 8 % too long still looks like a bar. Every one of those lines lives in
 * this file with a test beside it, so a component is left holding nothing but `x`, `y`, `w`, `h`.
 *
 * The three that actually bite, and are pinned by tests:
 *
 * 1. **A zero maximum.** An install with nothing in the ledger, or a filter that matches nothing,
 *    divides by zero on every bar. Every layout here returns zero-width marks and a `0` axis
 *    rather than `NaN`, because `NaN` in an SVG path silently draws nothing at all and looks
 *    exactly like "no data" — which is how a broken chart ships.
 * 2. **The 2 px surface gap inside a stacked bar** (dataviz: white does the separating, never a
 *    stroke). The gap has to come out of the bar's own length or the stack overstates its total
 *    by 2 px on every row, which is a real misstatement on a short bar.
 * 3. **Truncation.** SVG text does not ellipsize. A document title is a filename the learner
 *    chose and some of them are very long, so the fit is measured here, against one assumed
 *    character width, rather than discovered in a screenshot.
 *
 * Nothing in this file reads a message body, and nothing in it can: it takes `CostAnalytics`,
 * which has no column that carries words beyond a document title.
 */
import {
  COST_SCOPE_LABEL,
  REPORTED_USD_LABEL,
  SESSION_WINDOW,
  formatUsd,
  totalTokens,
  type CostAnalytics,
  type CostAnalyticsQuery,
  type CostBackend,
  type CostCacheStats,
  type CostDayRow,
  type CostDocumentRow,
  type CostOutcome,
  type CostScope,
  type CostSlice,
} from '../../shared/cost.js';
import { tokensLabel } from './cost.js';

// ── the filter row ──────────────────────────────────────────────────────────

export type RangeValue = 'all' | 'session' | '7d' | '30d';

/** Presets as rows, newest-reaching-back, because nobody fights a calendar for "last 7 days". */
export const TIME_RANGES: { value: RangeValue; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'session', label: 'This session' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

/**
 * The `since` a range asks for.
 *
 * `'session'` is **not** computed here: the renderer does not know when this launch started and
 * a guess would be wrong across a relaunch, so it sends the `SESSION_WINDOW` sentinel and the
 * main process substitutes its own start time (`shared/cost.ts` `CostSummaryQuery.since`).
 */
export function sinceFor(range: RangeValue, now: Date = new Date()): string | null {
  switch (range) {
    case 'all':
      return null;
    case 'session':
      return SESSION_WINDOW;
    case '7d':
      return isoDaysAgo(now, 7);
    case '30d':
      return isoDaysAgo(now, 30);
  }
}

function isoDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/** The whole filter row, as the one query every panel below it is drawn from. */
export function queryFor(
  filters: { range: RangeValue; fileId: string | null; backend: CostBackend | null },
  now: Date = new Date(),
): CostAnalyticsQuery {
  const query: CostAnalyticsQuery = {};
  const since = sinceFor(filters.range, now);
  if (since !== null) query.since = since;
  if (filters.fileId) query.fileId = filters.fileId;
  if (filters.backend) query.backend = filters.backend;
  return query;
}

/** The backends, in the words Settings uses for the same things. For the filter menu. */
export const BACKEND_LABEL: Record<CostBackend, string> = {
  'claude-cli': 'Claude Code on this Mac',
  anthropic: 'Anthropic API key',
  openai: 'OpenAI API key',
  gemini: 'Gemini API key',
  'openai-compatible': 'OpenAI-compatible endpoint',
  scripted: 'Scripted demo',
};

/**
 * The same backends, short enough for a chart row.
 *
 * A menu has the width to say "Claude Code on this Mac"; a bar chart's label column does not, and
 * `Claude Code on th…` is a label that has stopped being one. Two spellings of the same thing is
 * the lesser evil — the long one is never shown where the short one is, so they cannot be read as
 * two different backends.
 */
export const BACKEND_SHORT: Record<CostBackend, string> = {
  'claude-cli': 'Claude Code',
  anthropic: 'Anthropic API',
  openai: 'OpenAI API',
  gemini: 'Gemini API',
  'openai-compatible': 'Compatible API',
  scripted: 'Scripted demo',
};

export function backendWord(key: string): string {
  return BACKEND_SHORT[key as CostBackend] ?? key;
}

/** Never the raw key: `COST_SCOPE_LABEL` is the one place a scope is given words. */
export function scopeWord(key: string): string {
  return COST_SCOPE_LABEL[key as CostScope] ?? key;
}

// ── scales and axes ─────────────────────────────────────────────────────────

/** The 1 / 2 / 5 × 10ⁿ ladder. A tick at 137,000 is a tick nobody reads off a chart. */
export function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

export interface Axis {
  /** The tick values, `0` first, `max` last. */
  values: number[];
  /** The top of the scale — a rounded-up multiple of the step, never the raw maximum. */
  max: number;
}

/**
 * Ticks for a value axis. An all-zero series gets `[0]` and a max of 1, so every bar is drawn at
 * zero height against a real axis rather than dividing by zero.
 */
export function axisTicks(max: number, target = 4): Axis {
  if (!Number.isFinite(max) || max <= 0) return { values: [0], max: 1 };
  const step = niceStep(max / Math.max(1, target));
  const top = Math.ceil(max / step) * step;
  const values: number[] = [];
  for (let v = 0; v <= top + step / 1_000; v += step) values.push(Math.round(v * 1_000) / 1_000);
  return { values, max: top };
}

// ── mark geometry ───────────────────────────────────────────────────────────

/** Bar ≤ 24 px thick, 4 px rounded data-end, square at the baseline (dataviz mark specs). */
export const BAR_THICK = 10;
export const BAR_RADIUS = 4;
/** White does the separating. One consistent width, everywhere two fills touch. */
export const SURFACE_GAP = 2;

/** A column: square on the baseline, rounded on the cap. Degenerate heights stay drawable. */
export function columnPath(x: number, y: number, w: number, h: number, r = BAR_RADIUS): string {
  const height = Math.max(0, h);
  const radius = Math.max(0, Math.min(r, w / 2, height));
  if (height === 0 || w <= 0) return '';
  return [
    `M${round2(x)},${round2(y + height)}`,
    `V${round2(y + radius)}`,
    `Q${round2(x)},${round2(y)} ${round2(x + radius)},${round2(y)}`,
    `H${round2(x + w - radius)}`,
    `Q${round2(x + w)},${round2(y)} ${round2(x + w)},${round2(y + radius)}`,
    `V${round2(y + height)}`,
    'Z',
  ].join(' ');
}

/** A horizontal bar: square at the baseline on the left, rounded at the data-end on the right. */
export function barPath(x: number, y: number, w: number, h: number, r = BAR_RADIUS): string {
  const width = Math.max(0, w);
  const radius = Math.max(0, Math.min(r, width, h / 2));
  if (width === 0 || h <= 0) return '';
  return [
    `M${round2(x)},${round2(y)}`,
    `H${round2(x + width - radius)}`,
    `Q${round2(x + width)},${round2(y)} ${round2(x + width)},${round2(y + radius)}`,
    `V${round2(y + h - radius)}`,
    `Q${round2(x + width)},${round2(y + h)} ${round2(x + width - radius)},${round2(y + h)}`,
    `H${round2(x)}`,
    'Z',
  ].join(' ');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * **What fits.** SVG `<text>` has no ellipsis and no `overflow`, so a label that is too long
 * simply runs across the next column. Measured against one assumed character width rather than
 * the real font: the error is a character either way, and the alternative is a canvas measurement
 * in a module that must stay pure and testable.
 */
export function fitText(text: string, maxPx: number, charPx = 6.1): string {
  if (maxPx <= 0) return '';
  const max = Math.floor(maxPx / charPx);
  if (text.length <= max) return text;
  if (max <= 1) return '…';
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

// ── the ranked documents (stacked, horizontal) ──────────────────────────────

export interface DocSegment {
  key: 'ingest' | 'conversation';
  label: string;
  tokens: number;
  x: number;
  w: number;
  /**
   * Only the **outer** end of a stack is a data-end. An interior boundary rounded on one side and
   * square on the other reads as a notch; the 2 px surface gap is what separates the segments.
   */
  round: boolean;
}

export interface DocBar {
  fileId: string;
  title: string;
  calls: number;
  tokens: number;
  ingestTokens: number;
  conversationTokens: number;
  /** `ingest / total`, `0` when the row has no tokens at all. */
  ingestShare: number;
  segments: DocSegment[];
  /** The whole row, for a `<title>` and for the visually-hidden table. */
  summary: string;
}

export interface DocBars {
  rows: DocBar[];
  /** Rows past the cut, folded into one quiet line rather than a bar nobody can read. */
  hidden: { count: number; tokens: number } | null;
  /** The longest row's tokens — every bar is a fraction of this, so the rows compare. */
  max: number;
}

export const DOC_SEGMENT_LABEL = { ingest: 'Setup', conversation: 'Conversation' } as const;

/**
 * **Which documents cost the most, and how much of that was the one-off.**
 *
 * Ranked by total tokens, stacked into the split `CostDocumentRow` already carries, and scaled
 * against the **largest row**, not against each row's own total: a 100 %-wide bar on every row
 * would answer "what fraction was setup" and lose "which deck cost the most", which is the
 * question the panel is for. The share is printed as a number beside the bar instead.
 */
export function docBars(rows: readonly CostDocumentRow[], plotWidth: number, limit = 6): DocBars {
  const sorted = [...rows].sort(
    (a, b) => totalTokens(b.tokens) - totalTokens(a.tokens) || a.title.localeCompare(b.title),
  );
  const shown = sorted.slice(0, limit);
  const tail = sorted.slice(limit);
  const max = Math.max(0, ...sorted.map((r) => totalTokens(r.tokens)));
  const plot = Math.max(0, plotWidth);

  return {
    max,
    hidden:
      tail.length === 0
        ? null
        : { count: tail.length, tokens: tail.reduce((n, r) => n + totalTokens(r.tokens), 0) },
    rows: shown.map((row) => {
      const tokens = totalTokens(row.tokens);
      const ingest = Math.max(0, totalTokens(row.ingest.tokens));
      const conversation = Math.max(0, tokens - ingest);
      const full = max > 0 ? (tokens / max) * plot : 0;
      // The gap comes out of the bar's own length, or a stack overstates its total on every row.
      const gap = full > SURFACE_GAP * 2 && ingest > 0 && conversation > 0 ? SURFACE_GAP : 0;
      const usable = Math.max(0, full - gap);
      const ingestW = tokens > 0 ? (ingest / tokens) * usable : 0;
      const conversationW = Math.max(0, usable - ingestW);
      const segments = [
        { key: 'ingest' as const, label: DOC_SEGMENT_LABEL.ingest, tokens: ingest, x: 0, w: ingestW, round: false },
        {
          key: 'conversation' as const,
          label: DOC_SEGMENT_LABEL.conversation,
          tokens: conversation,
          x: ingestW + gap,
          w: conversationW,
          round: false,
        },
      ].filter((s) => s.tokens > 0 || tokens === 0);
      const last = segments.at(-1);
      if (last) last.round = true;
      return {
        fileId: row.fileId,
        title: row.title,
        calls: row.calls,
        tokens,
        ingestTokens: ingest,
        conversationTokens: conversation,
        ingestShare: tokens > 0 ? ingest / tokens : 0,
        segments,
        summary: `${row.title} — ${tokensLabel(tokens)} tokens, ${callsWord(row.calls)}: setup ${tokensLabel(
          ingest,
        )} (${pct(tokens > 0 ? ingest / tokens : 0)}), conversation ${tokensLabel(conversation)}`,
      };
    }),
  };
}

// ── a plain ranked bar list (by scope, by model, by backend) ────────────────

export interface SliceBar {
  key: string;
  label: string;
  tokens: number;
  calls: number;
  share: number;
  /** Bar length in px, a fraction of the longest row. */
  w: number;
  summary: string;
}

export interface SliceBars {
  rows: SliceBar[];
  folded: { count: number; tokens: number } | null;
  total: number;
}

/**
 * One hue for every bar, because these categories are **nominal** — a scope is not more or less
 * than another scope, it is a different one. Colouring them by size would spend the identity
 * channel re-encoding what the bar length already shows (dataviz anti-patterns).
 */
export function sliceBars(
  slices: readonly CostSlice[],
  plotWidth: number,
  word: (key: string) => string = (k) => k,
  limit = 8,
): SliceBars {
  const sorted = [...slices].sort(
    (a, b) => totalTokens(b.tokens) - totalTokens(a.tokens) || a.key.localeCompare(b.key),
  );
  const total = sorted.reduce((n, s) => n + totalTokens(s.tokens), 0);
  const shown = sorted.slice(0, limit);
  const tail = sorted.slice(limit);
  const max = Math.max(0, ...sorted.map((s) => totalTokens(s.tokens)));
  const plot = Math.max(0, plotWidth);
  return {
    total,
    folded: tail.length === 0 ? null : { count: tail.length, tokens: tail.reduce((n, s) => n + totalTokens(s.tokens), 0) },
    rows: shown.map((slice) => {
      const tokens = totalTokens(slice.tokens);
      const label = word(slice.key);
      const share = total > 0 ? tokens / total : 0;
      return {
        key: slice.key,
        label,
        tokens,
        calls: slice.calls,
        share,
        w: max > 0 ? (tokens / max) * plot : 0,
        summary: `${label} — ${tokensLabel(tokens)} tokens (${pct(share)}), ${callsWord(slice.calls)}`,
      };
    }),
  };
}

/** The label and value columns a bar list reserves; the bar gets whatever is left. */
export const SLICE_LABEL_W = 112;
export const SLICE_VALUE_W = 86;

/**
 * How wide the bar column is inside a measured container.
 *
 * Measured rather than percentage-based because the bar is an SVG with real pixel coordinates:
 * a `width="100%"` SVG with a `viewBox` scales its own text, so the same chart would print 11 px
 * labels at one window size and 9 px at another. The container is measured once and the marks
 * are drawn at true size — which is also why this can never go negative and hand a path a
 * negative width.
 */
export function barColumn(containerWidth: number, labelPx = SLICE_LABEL_W, valuePx = SLICE_VALUE_W, gapPx = 20): number {
  return Math.max(0, Math.round(containerWidth - labelPx - valuePx - gapPx));
}

// ── over time (columns) ─────────────────────────────────────────────────────

export interface ColumnChart {
  width: number;
  height: number;
  plot: { x: number; y: number; w: number; h: number };
  ticks: { value: number; y: number; label: string }[];
  bars: { key: string; x: number; y: number; w: number; h: number; tokens: number; summary: string }[];
  dayLabels: { x: number; text: string }[];
  max: number;
}

/** Left gutter for the value ticks, bottom band for the dates. Sized so nothing is cropped. */
const COL_GUTTER = 42;
const COL_BOTTOM = 18;
const COL_RIGHT = 6;

/**
 * **`byDay`, oldest left.**
 *
 * The bottom band is part of the height the container is asked for, not an overlay: a card whose
 * fixed height excludes the axis band is a card that grows a 14 px nested scrollbar (dataviz
 * anti-patterns), and it is the single easiest way to ship a chart that clips.
 */
export function columnLayout(rows: readonly CostDayRow[], width: number, plotHeight = 118): ColumnChart {
  const w = Math.max(COL_GUTTER + COL_RIGHT + 20, Math.round(width));
  const plot = { x: COL_GUTTER, y: 4, w: w - COL_GUTTER - COL_RIGHT, h: plotHeight };
  const values = rows.map((r) => totalTokens(r.tokens));
  const axis = axisTicks(Math.max(0, ...values));
  const band = rows.length > 0 ? plot.w / rows.length : plot.w;
  const barW = Math.max(2, Math.min(24, band - 6));
  const labelStep = dayAxisStep(rows.length, plot.w);

  return {
    width: w,
    height: plot.y + plot.h + COL_BOTTOM,
    plot,
    max: axis.max,
    ticks: axis.values.map((value) => ({
      value,
      y: plot.y + plot.h - (value / axis.max) * plot.h,
      label: tokensLabel(value),
    })),
    bars: rows.map((row, i) => {
      const tokens = totalTokens(row.tokens);
      const h = axis.max > 0 ? (tokens / axis.max) * plot.h : 0;
      return {
        key: row.day,
        x: plot.x + band * i + (band - barW) / 2,
        y: plot.y + plot.h - h,
        w: barW,
        h,
        tokens,
        summary: `${dayLabel(row.day)} (UTC) — ${tokensLabel(tokens)} tokens, ${callsWord(row.calls)}`,
      };
    }),
    dayLabels: rows
      .map((row, i) => ({ row, i }))
      // Anchored on the newest day, not the oldest: the right-hand end is the one a reader dates
      // first, and an axis whose last bar is unlabelled is an axis that stops short.
      .filter(({ i }) => (rows.length - 1 - i) % labelStep === 0)
      .map(({ row, i }) => ({ x: plot.x + band * i + band / 2, text: dayLabel(row.day) })),
  };
}

/** How many days between labels, so `Sep 14` never sits on top of `Sep 15`. */
export function dayAxisStep(count: number, plotWidth: number, labelPx = 46): number {
  if (count <= 1) return 1;
  const band = plotWidth / count;
  return Math.max(1, Math.ceil(labelPx / Math.max(1, band)));
}

/**
 * `2026-09-14` → `Sep 14`. Sliced out of the string rather than parsed into a `Date`: these are
 * UTC days (`main/cost/analytics.ts` groups on `substr(created_at, 1, 10)`) and running them
 * through the local calendar is exactly the shift the SQL avoided.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayLabel(day: string): string {
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  if (!Number.isFinite(month) || month < 1 || month > 12 || !Number.isFinite(date)) return day;
  return `${MONTHS[month - 1]} ${date}`;
}

// ── the cache split ─────────────────────────────────────────────────────────

export interface CacheSegment {
  key: 'cacheRead' | 'freshInput';
  label: string;
  tokens: number;
  x: number;
  w: number;
  /** As in `DocSegment`: only the outer end of the stack is a data-end. */
  round: boolean;
}

export interface CacheSplit {
  segments: CacheSegment[];
  hitShare: number;
  /** Cache writes are priced separately and are not part of the hit ratio — shown, not stacked. */
  cacheWrite: number;
  total: number;
  summary: string;
}

/**
 * **Cache reads against fresh input.** The denominator is deliberately those two and not "all
 * tokens": `hitShare` is `cacheRead / (cacheRead + freshInput)` on the wire, and a bar drawn
 * against a different denominator than the percentage printed beside it is a chart that argues
 * with its own caption.
 */
export function cacheSplit(cache: CostCacheStats, plotWidth: number): CacheSplit {
  const total = Math.max(0, cache.cacheRead) + Math.max(0, cache.freshInput);
  const plot = Math.max(0, plotWidth);
  const gap = total > 0 && cache.cacheRead > 0 && cache.freshInput > 0 ? SURFACE_GAP : 0;
  // No input at all means no bar at all — not one segment silently taking the whole track.
  const usable = total > 0 ? Math.max(0, plot - gap) : 0;
  const readW = total > 0 ? (cache.cacheRead / total) * usable : 0;
  const segments = (
    [
      { key: 'cacheRead', label: 'Cache reads', tokens: cache.cacheRead, x: 0, w: readW, round: false },
      {
        key: 'freshInput',
        label: 'Fresh input',
        tokens: cache.freshInput,
        x: readW + gap,
        w: Math.max(0, usable - readW),
        round: false,
      },
    ] as CacheSegment[]
  ).filter((s) => s.tokens > 0 || total === 0);
  const last = segments.at(-1);
  if (last) last.round = true;
  return {
    total,
    hitShare: cache.hitShare,
    cacheWrite: cache.cacheWrite,
    segments,
    summary: `${tokensLabel(cache.cacheRead)} cache reads and ${tokensLabel(cache.freshInput)} fresh input — ${pct(
      cache.hitShare,
    )} of input tokens came from the cache`,
  };
}

// ── outcomes ────────────────────────────────────────────────────────────────

/**
 * A glyph rather than a colour, on purpose. `'aborted'` is the learner pressing Stop and is
 * **not** a failure (`shared/cost.ts` `CostOutcome`), and a red dot beside it would say it was
 * whatever the label next to it said. Colour is never the only signal on this page, and here it
 * is not a signal at all.
 */
export const OUTCOME_GLYPH: Record<CostOutcome, string> = {
  ok: '✓',
  error: '✕',
  aborted: '⏹',
  preempted: '↻',
};

/** One clause each. `'preempted'` is the one nobody can guess, so it gets the longest. */
export const OUTCOME_NOTE: Record<CostOutcome, string> = {
  ok: 'Returned an answer.',
  error: 'Threw before answering — on the CLI path usually with no tokens reported at all.',
  aborted: 'You pressed Stop. Not a failure.',
  preempted: 'The notes lane was killed so your click could get through, and the work was re-queued.',
};

/** Only `'error'` is called failed here. Pre-empted work was re-queued and is counted apart. */
export function outcomeHeadline(rows: readonly { outcome: CostOutcome; calls: number }[]): string {
  const of = (o: CostOutcome): number => rows.find((r) => r.outcome === o)?.calls ?? 0;
  const failed = of('error');
  const preempted = of('preempted');
  const stopped = of('aborted');
  if (failed === 0 && preempted === 0 && stopped === 0) return 'Nothing failed, was stopped or was re-queued.';
  const parts: string[] = [];
  if (failed > 0) parts.push(`${failed} failed`);
  if (preempted > 0) parts.push(`${preempted} pre-empted and re-queued`);
  if (stopped > 0) parts.push(`${stopped} stopped by you`);
  return `${parts.join(' · ')}.`;
}

// ── words ───────────────────────────────────────────────────────────────────

/** `0.8271` → `83%`; a share too small to round to a percent says so rather than saying `0%`. */
export function pct(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return '0%';
  if (share >= 1) return '100%';
  const value = share * 100;
  if (value < 1) return '<1%';
  return `${Math.round(value)}%`;
}

export function callsWord(n: number): string {
  return `${n.toLocaleString('en-US')} call${n === 1 ? '' : 's'}`;
}

/** `940` → `940 ms`; `42000` → `42.0 s`; a call that did not time itself says so. */
export function msLabel(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  return `${(ms / 1_000).toFixed(1)} s`;
}

/**
 * **The CLI's own figure, beside the estimate and never added to it.**
 *
 * The two disagreed by ~1.7× on the one measurement anybody has made
 * (`docs/research/segmentation-cost.md` §UNVERIFIED 6), so a sum of them would be a number that
 * describes nothing. Returns `null` when no call in the window reported one.
 */
export function reportedParts(
  reportedUsd: number | null,
  reportedCalls: number,
  calls: number,
): { label: string; figure: string; over: string } | null {
  if (reportedUsd === null) return null;
  return {
    label: REPORTED_USD_LABEL,
    // No `≈`: unlike the estimate this figure is not this app's arithmetic, it is what the CLI
    // itself printed. Hedging somebody else's number as if it were ours would misattribute it.
    figure: formatUsd(reportedUsd),
    over: `over ${reportedCalls.toLocaleString('en-US')} of ${calls.toLocaleString('en-US')} calls`,
  };
}

export function reportedLine(reportedUsd: number | null, reportedCalls: number, calls: number): string | null {
  const parts = reportedParts(reportedUsd, reportedCalls, calls);
  return parts === null ? null : `${parts.label} ${parts.figure} ${parts.over}`;
}

/** Said quietly under the session figure, because it is the one number the filters do not touch. */
export const SESSION_NOTE = 'Since this app launched — this one ignores the time filter.';

/** Why both a mean and a median, in the one sentence the panel has room for. */
export const PER_MESSAGE_NOTE =
  'Both, because the distribution is skewed: one deck’s setup moves a mean by a factor and leaves a median where it was. A budget built on the mean over-provisions; one built on the median under-provisions.';

// ── the empty cases ─────────────────────────────────────────────────────────

export type PanelKey = 'documents' | 'scope' | 'model' | 'backend' | 'days' | 'perMessage' | 'cache' | 'calls' | 'outcomes';

/**
 * What a panel says when its slice is empty.
 *
 * Not one shared "No data": half of these are empty for a reason the learner can act on (the
 * filter is too narrow) and half for a reason they cannot (nothing has been ingested yet), and a
 * page of nine identical greyed boxes tells them neither.
 */
export const PANEL_EMPTY: Record<PanelKey, string> = {
  documents: 'No document has cost anything in this range.',
  scope: 'No calls in this range.',
  model: 'No calls in this range.',
  backend: 'No calls in this range.',
  days: 'No calls in this range.',
  perMessage: 'No messages have been answered in this range yet.',
  cache: 'No input tokens in this range.',
  calls: 'No calls in this range.',
  outcomes: 'No calls in this range.',
};

export function emptyNote(key: PanelKey, hasRows: boolean): string | null {
  return hasRows ? null : PANEL_EMPTY[key];
}

/** Nothing in the ledger at all — a different thing from a filter that matched nothing. */
export function isLedgerEmpty(analytics: CostAnalytics | null): boolean {
  if (!analytics) return true;
  return analytics.total.calls === 0 && analytics.session.calls === 0 && analytics.knownFiles.length === 0;
}

export const LEDGER_EMPTY_NOTE =
  'Nothing has been recorded yet. Open a document and the setup pass will be the first thing on this page.';

export const FILTER_EMPTY_NOTE = 'Nothing matched these filters. Widen the range, or clear the document.';

/**
 * The footnote. One sentence, and it is the whole labelling rule in plain words: these dollars
 * are arithmetic this app did, against prices it cached on a date it can name.
 */
export function rateCardNote(rateCardDate: string): string {
  return `Prices come from a rate card cached on ${rateCardDate}. Every dollar figure on this page is arithmetic this app did against it — not money anybody was charged.`;
}

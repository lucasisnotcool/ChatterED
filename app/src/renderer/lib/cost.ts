/**
 * **What a counter says** (issue #41 item 4).
 *
 * `src/shared/cost.ts` owns the wire shapes and the primitives — `formatTokens`, `formatUsd`,
 * `usdLabel`, `modeFor`. This file owns the *sentences the renderer prints*, and exists for one
 * reason: there are three counters in three places (a thread footer, the objectives header,
 * Settings ▸ Usage) and they have to be the same sentence at three scales. A second surface that
 * words it differently is a surface a learner will read as a different number.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE TWO RULES IT ENFORCES
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * 1. **Tokens lead; dollars follow with a hedge.** Every dollar figure this app shows is
 *    arithmetic it did itself against a cached rate card, so it is printed with `≈` — the one
 *    exception being a figure already below a cent, which prints as `<$0.01` and does not also
 *    get an "approximately", because "approximately less than" is not a thing.
 *
 * 2. **On the CLI path the dollars are labelled "API-equivalent", always.** The default backend
 *    is the learner's own Claude Code subscription (issue #19): nobody is billed per token, and
 *    an unlabelled `$0.41` in a student-facing app is a false claim that a student owes money.
 *    `usdLabel()` in the shared module returns the exact words; this file is what makes sure they
 *    are never dropped on the way to a label. The CLI's own `total_cost_usd`, when it reported
 *    one, goes in the **tooltip** and is never added to the estimate — they disagreed by ~1.7×
 *    on the one measurement in `segmentation-cost.md` §UNVERIFIED 6 and reconciling them is not
 *    this file's business.
 */
import {
  CLI_WINDOW_HOURS,
  COST_SCOPE_LABEL,
  REPORTED_USD_LABEL,
  addTokens,
  emptyTokens,
  formatTokens,
  formatUsd,
  isApiBackend,
  isIngestScope,
  totalTokens,
  usdLabel,
  type CliWindowBurn,
  type CostCallView,
  type CostLevel,
  type CostMessageCost,
  type CostMode,
  type CostScope,
  type CostSlice,
  type CostSummary,
  type CostTokens,
  type CostUpdate,
} from '../../shared/cost.js';

/** What each level is called on screen. First person, because it is the learner's own usage. */
export const LEVEL_WORD: Record<CostLevel, string> = {
  thread: 'this thread',
  file: 'this file',
  app: 'all time',
};

/**
 * `4200` → `4.2k`, `61000` → `61k`, `1_234_567` → `1.23M`.
 *
 * The shared formatter's `K` is lowercased and its `M` is not, which is not an inconsistency —
 * it is how the units are actually written. An uppercase `K` next to a lowercase `tokens` reads
 * as an abbreviation of something; `4.2k tokens` reads as a quantity.
 */
export function tokensLabel(n: number): string {
  return formatTokens(n).replace(/K$/, 'k');
}

/**
 * A dollar figure with its hedge. `≈ $0.03`; `<$0.01` unhedged; `$0.00` when there is nothing.
 *
 * Returns the number only — the mode's label is `usdSuffix`'s job, so a caller that has room for
 * one and not the other can choose.
 */
export function usdApprox(usd: number): string {
  const text = formatUsd(usd);
  return text.startsWith('<') || text === '$0.00' ? text : `≈ ${text}`;
}

/**
 * The words that must follow a dollar figure, or `''` when none are needed.
 *
 * `'api'` needs none: `≈` already says estimated, and on that path it is an estimate of a real
 * bill. Every other billable mode needs **API-equivalent**, which is the whole of rule 2.
 */
export function usdSuffix(mode: CostMode): string {
  return mode === 'api' || mode === 'none' ? '' : ` ${usdLabel(mode)}`;
}

/**
 * The dollar figure and its label together, and **nothing at all when there is no money in it**.
 *
 * A zero is the case worth naming: the scripted backend records rows with zero tokens on purpose
 * (*"the video path spent nothing"* is a fact worth being able to show), and rendering that as
 * `$0.00 API-equivalent` puts the most careful hedge in the app on the one number that needs no
 * hedging at all. Zero is zero in every billing reality.
 */
export function usdWithLabel(usd: number, mode: CostMode): string {
  if (mode === 'none') return '';
  const figure = usdApprox(usd);
  return figure === '$0.00' ? figure : `${figure}${usdSuffix(mode)}`;
}

/**
 * One counter, whole: `this thread · 4.2k tokens · ≈ $0.03`, or
 * `this file · 61k tokens · ≈ $0.41 API-equivalent` on the CLI path.
 *
 * A summary with no billable call in it prints tokens and stops — `· $0.00 nothing spent` is
 * three words to say what the absence of a figure says better, and a scripted session (the video
 * path) is exactly that case.
 */
export function counterLine(summary: Pick<CostSummary, 'level' | 'tokens' | 'estimatedUsd' | 'mode'>): string {
  const tokens = `${tokensLabel(totalTokens(summary.tokens))} tokens`;
  const head = `${LEVEL_WORD[summary.level]} · ${tokens}`;
  const money = usdWithLabel(summary.estimatedUsd, summary.mode);
  return money.length === 0 ? head : `${head} · ${money}`;
}

/**
 * The tooltip behind a counter: what the rate card is, and — on the CLI path that reported one —
 * the CLI's own figure, named as its own and never added to the estimate.
 */
export function counterTitle(summary: CostSummary): string {
  const parts = [
    `${summary.calls} call${summary.calls === 1 ? '' : 's'}`,
    `rate card ${summary.rateCardDate}`,
  ];
  if (summary.reportedUsd !== null) {
    parts.push(
      `${REPORTED_USD_LABEL} ${formatUsd(summary.reportedUsd)} over ${summary.reportedCalls} of ${summary.calls}`,
    );
  }
  if (summary.backfilledCalls > 0) {
    parts.push(`${summary.backfilledCalls} reconstructed from the logs, not recorded live`);
  }
  return parts.join(' · ');
}

/** `last 5 h · 120k tokens · ≈ $0.80 API-equivalent`. Null when there is no CLI window. */
export function windowLine(burn: CliWindowBurn | null, mode: CostMode): string | null {
  if (!burn) return null;
  const tokens = `${tokensLabel(totalTokens(burn.tokens))} tokens`;
  const money = usdWithLabel(burn.estimatedUsd, mode);
  return money.length === 0 ? `last ${burn.hours || CLI_WINDOW_HOURS} h · ${tokens}` : `last ${burn.hours || CLI_WINDOW_HOURS} h · ${tokens} · ${money}`;
}

/**
 * `this session · 12k tokens · ≈ $0.05 API-equivalent`.
 *
 * Its own sentence rather than `counterLine`'s, and not an oversight: the session summary is a
 * **level `'app'` summary with a window on it** (`loadCost({ level: 'app', since: SESSION_WINDOW })`),
 * so `LEVEL_WORD` would have the title bar call this launch's burn *all time*.
 */
export function sessionLine(session: Pick<CostSummary, 'tokens' | 'estimatedUsd' | 'mode'>): string {
  const tokens = `${tokensLabel(totalTokens(session.tokens))} tokens`;
  const money = usdWithLabel(session.estimatedUsd, session.mode);
  return money.length === 0 ? `this session · ${tokens}` : `this session · ${tokens} · ${money}`;
}

// ── The always-available surfaces (#42 item C) ──────────────────────────────
//
// Four counters that are never *asked for* — under a message, under a thread, in the doc header,
// in the title bar. They are the same sentence at four scales, and everything they say is built
// here rather than in the components, for the reason this file exists at all: a fifth surface
// that words it differently is a fifth number as far as a learner is concerned.
//
// They are shorter than `counterLine`'s, because they live in 10px type next to somebody's
// lecture. `tok` rather than `tokens` is the whole of that abbreviation — the dollar label is
// **never** shortened, because "API-equivalent" is the claim, not the decoration.

/** `12.4k tok`. Tokens are the fact, so this is what a surface with room for one number shows. */
export function compactTokens(tokens: CostTokens): string {
  return `${tokensLabel(totalTokens(tokens))} tok`;
}

/**
 * **The collapsed meter under one agent card**: `12.4k tok · ≈ $0.02 API-equivalent`.
 *
 * The label survives the abbreviation. A meter reading `12.4k tok · ≈ $0.02` under every reply,
 * on a backend where nobody is billed per token, is forty small claims per session that a student
 * owes money — which is the one failure `shared/cost.ts` note 2 exists to prevent.
 */
export function meterLine(cost: Pick<CostMessageCost, 'tokens' | 'estimatedUsd' | 'mode' | 'unpricedCalls'>): string {
  const tokens = compactTokens(cost.tokens);
  const money = unpricedAware(usdWithLabel(cost.estimatedUsd, cost.mode), cost.estimatedUsd, cost.unpricedCalls ?? 0);
  return money.length === 0 ? tokens : `${tokens} · ${money}`;
}

/**
 * A model the rate card has no price for (a BYOK id typed into Settings, anything on an
 * OpenAI-compatible endpoint) is priced at zero **and flagged**. A zero there means "unknown",
 * never "free": `$0.00` under a paid call would be the exact misreading rule 2 exists to prevent.
 */
export function unpricedAware(money: string, usd: number, unpricedCalls: number): string {
  if (unpricedCalls <= 0) return money;
  if (usd <= 0) return 'cost unknown';
  return `${money} + unpriced`;
}

/** `1.4 s`, `940 ms`, or null when not one of the calls timed itself. */
export function msLabel(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  const v = Math.max(0, Math.round(ms));
  return v < 1_000 ? `${v} ms` : `${(v / 1_000).toFixed(1)} s`;
}

/**
 * **A retried turn cost twice**, said in one clause.
 *
 * `'aborted'` is deliberately not in this count — `isFailedOutcome` says so, and a learner who
 * pressed Stop does not need to be told their own decision failed. What they do need to be told
 * is that a call that threw, or one the notes lane pre-empted, was paid for and then paid for
 * again, which is the only reason a number here can be twice what the reply looks worth.
 */
export function failedClause(failedCalls: number): string | null {
  if (!Number.isFinite(failedCalls) || failedCalls <= 0) return null;
  return failedCalls === 1
    ? '1 call failed or was pre-empted — a retried turn costs twice'
    : `${failedCalls} calls failed or were pre-empted — a retried turn costs twice`;
}

/**
 * `CLI-reported $0.01` — the CLI's own `total_cost_usd`, named as its own.
 *
 * It goes **beside** the estimate, never into it. The two disagreed by ~1.7× on the one
 * measurement in `segmentation-cost.md` §UNVERIFIED 6 and reconciling them is nobody's business
 * here; showing one and hiding the other, or adding them, would both be inventions.
 */
export function reportedLine(reportedUsd: number | null): string | null {
  return reportedUsd === null ? null : `${REPORTED_USD_LABEL} ${formatUsd(reportedUsd)}`;
}

/** The tooltip on a collapsed meter: what the expanded panel says, on one line. */
export function meterTitle(cost: CostMessageCost): string {
  const parts = [`${cost.calls} call${cost.calls === 1 ? '' : 's'}`];
  if (cost.models.length > 0) parts.push(cost.models.join(', '));
  const ms = msLabel(cost.ms);
  if (ms !== null) parts.push(ms);
  const reported = reportedLine(cost.reportedUsd);
  if (reported !== null) parts.push(reported);
  const failed = failedClause(cost.failedCalls);
  if (failed !== null) parts.push(failed);
  return parts.join(' · ');
}

/** `4.2k tok · ≈ $0.03 API-equivalent · 6 calls`. One line of a breakdown, at any level. */
export function sliceLine(slice: Pick<CostSlice, 'calls' | 'tokens' | 'estimatedUsd'>, mode: CostMode): string {
  const parts = [compactTokens(slice.tokens)];
  const money = usdWithLabel(slice.estimatedUsd, mode);
  if (money.length > 0) parts.push(money);
  if (slice.calls > 1) parts.push(`${slice.calls} calls`);
  return parts.join(' · ');
}

/** One row of an expanded breakdown, in the scope's own words (`COST_SCOPE_LABEL`). */
export interface CostRow {
  key: string;
  label: string;
  detail: string;
}

export function scopeRows(slices: readonly CostSlice[], mode: CostMode): CostRow[] {
  return slices.map((slice) => ({
    key: slice.key,
    label: COST_SCOPE_LABEL[slice.key as CostScope] ?? slice.key,
    detail: sliceLine(slice, mode),
  }));
}

/** One side of the ingest split. The same three fields every summary and slice carries. */
export interface CostPart {
  calls: number;
  tokens: CostTokens;
  estimatedUsd: number;
}

/**
 * **What building the document cost, against what talking about it cost.**
 *
 * The two-pass notes ingest, the concept pack and the objectives tree are paid once per deck
 * before a word is said, and on a forty-slide lecture they are the largest single cost in the
 * app. A doc-header counter that showed one total would answer *"is this app expensive?"* with a
 * number that is mostly a one-off, and the learner would be right to conclude the wrong thing.
 *
 * Which scopes fall on which side is `isIngestScope` in `shared/cost.ts` — a shared constant
 * precisely so the analytics SQL and this counter cannot come to disagree about `objectives`.
 */
export function ingestSplit(slices: readonly CostSlice[]): { ingest: CostPart; conversation: CostPart } {
  const ingest: CostPart = { calls: 0, tokens: emptyTokens(), estimatedUsd: 0 };
  const conversation: CostPart = { calls: 0, tokens: emptyTokens(), estimatedUsd: 0 };
  for (const slice of slices) {
    const side = isIngestScope(slice.key as CostScope) ? ingest : conversation;
    side.calls += slice.calls;
    side.tokens = addTokens(side.tokens, slice.tokens);
    side.estimatedUsd += slice.estimatedUsd;
  }
  return { ingest, conversation };
}

/** Is there anything on this side of the split? Nothing is drawn for an empty one — not a zero. */
export function partHasCost(part: CostPart): boolean {
  return part.calls > 0 || totalTokens(part.tokens) > 0;
}

/** `session 12k tok` — the title bar's left half. Null before the first call of the launch. */
export function sessionChip(session: Pick<CostSummary, 'tokens' | 'calls'> | null): string | null {
  if (!session || (session.calls === 0 && totalTokens(session.tokens) === 0)) return null;
  return `session ${compactTokens(session.tokens)}`;
}

/**
 * `5 h 120k tok` — the right half, and **null on an install that has no rolling window**.
 *
 * An API-key or scripted install is not inside a five-hour window at all, and a `0` there would
 * be a limit reported against a constraint that does not exist for that learner.
 */
export function windowChip(burn: CliWindowBurn | null): string | null {
  if (!burn) return null;
  return `${burn.hours || CLI_WINDOW_HOURS} h ${compactTokens(burn.tokens)}`;
}

/** Everything the title-bar indicator is far too small to say, one claim per line. */
export function indicatorTitle(app: CostSummary | null, session: CostSummary | null): string {
  const lines: string[] = [];
  if (session) lines.push(sessionLine(session));
  if (app) {
    lines.push(counterLine(app));
    const burn = windowLine(app.cliWindow, app.mode);
    if (burn !== null) lines.push(burn);
    lines.push(counterTitle(app));
  }
  lines.push('Click for the whole picture.');
  return lines.join('\n');
}

/**
 * **Does this `cost.updated` belong to this counter?**
 *
 * `CostUpdate` carries the delta and the call's `fileId` / `anchorId`; a renderer holding three
 * counters adds it to whichever of them the call is inside. The nesting is `thread ⊆ file ⊆ app`
 * and this is where that is decided, once, rather than three times in three components.
 *
 * A call with a null `fileId` is invisible at file level **by construction** — background work
 * that belongs to no document — and that is correct, not a gap (`shared/cost.ts` note 3).
 */
export function updateBelongs(summary: Pick<CostSummary, 'level' | 'fileId' | 'anchorId'>, update: CostUpdate): boolean {
  const call = update.call;
  switch (summary.level) {
    case 'app':
      return true;
    case 'file':
      return summary.fileId !== null && call.fileId === summary.fileId;
    case 'thread':
      return summary.anchorId !== null && call.anchorId === summary.anchorId;
  }
}

/**
 * The counter, ticked.
 *
 * Only the scalars — tokens, calls, dollars, `lastCallAt`, and the mode, which a first
 * `claude-cli` call can move from `'none'` to `'subscription'` and a mixed session to `'mixed'`.
 * The **slices are deliberately not patched**: a by-model table that grows a row from a delta is
 * a table that can silently disagree with the ledger, and the surface that shows slices
 * (Settings ▸ Usage) can afford to re-ask. `cost:summary` stays authoritative; this exists so a
 * thread footer does not have to round-trip on every turn.
 */
export function applyDelta(summary: CostSummary, update: CostUpdate): CostSummary {
  const call = update.call;
  const billable = call.backend !== 'scripted';
  return {
    ...summary,
    tokens: addTokens(summary.tokens, call.tokens),
    calls: summary.calls + 1,
    estimatedUsd: summary.estimatedUsd + call.estimatedUsd,
    reportedUsd:
      call.reportedUsd === null ? summary.reportedUsd : (summary.reportedUsd ?? 0) + call.reportedUsd,
    reportedCalls: summary.reportedCalls + (call.reportedUsd === null ? 0 : 1),
    lastCallAt: call.createdAt,
    firstCallAt: summary.firstCallAt ?? call.createdAt,
    backfilledCalls: summary.backfilledCalls + (call.backfilled ? 1 : 0),
    mode: billable ? nextMode(summary.mode, call.backend) : summary.mode,
  };
}

/** One call's backend, folded into a mode. Mirrors `modeFor` for the incremental case. */
function nextMode(mode: CostMode, backend: CostCallView['backend']): CostMode {
  const arriving: CostMode = backend === 'claude-cli' ? 'subscription' : isApiBackend(backend) ? 'api' : 'none';
  if (arriving === 'none') return mode;
  if (mode === 'none') return arriving;
  if (mode === arriving) return mode;
  return 'mixed';
}

// ── Export ──────────────────────────────────────────────────────────────────

/** The columns, in order. Named so a spreadsheet is readable without this file next to it. */
export const CSV_COLUMNS = [
  'when',
  'scope',
  'model',
  'backend',
  'input',
  'output',
  'cache_write',
  'cache_read',
  'total_tokens',
  'estimated_usd',
  'reported_usd',
  'duration_ms',
  'file_id',
  'anchor_id',
  'turn_id',
  'backfilled',
] as const;

/**
 * One cell, quoted the way RFC 4180 asks and the way a spreadsheet actually reads.
 *
 * The leading-character guard is not decoration: a value beginning `=`, `+`, `-` or `@` is
 * executed as a formula by Excel and Sheets on open, and these rows carry model names and ids
 * that came from outside this app. A research export that can run a formula is a research export
 * that can exfiltrate the sheet it is opened in.
 */
function cell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * **Export CSV.** The rows, not the summary: a summary is one arithmetic away from the rows and
 * a researcher who has the rows can compute a different one. Dollars are written unrounded and
 * unlabelled here — the header says `estimated_usd` and `reported_usd`, which is the labelling
 * rule holding in a file rather than on a screen.
 */
export function toCsv(rows: readonly CostCallView[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.createdAt,
        r.scope,
        r.model,
        r.backend,
        r.tokens.input,
        r.tokens.output,
        r.tokens.cacheWrite,
        r.tokens.cacheRead,
        totalTokens(r.tokens),
        r.estimatedUsd,
        r.reportedUsd,
        r.durationMs,
        r.fileId,
        r.anchorId,
        r.turnId,
        r.backfilled ? 'yes' : 'no',
      ]
        .map(cell)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** `chattered-usage-2026-09-16.csv`. */
export function csvFilename(now = new Date()): string {
  return `chattered-usage-${now.toISOString().slice(0, 10)}.csv`;
}

// ── The debug drawer's rows (item 5) ────────────────────────────────────────

/** `Ask here · claude-haiku-4-5 · 3.1k · 940ms`. One line, no bodies, ever. */
export function callLine(call: CostCallView, scopeWord: string): string {
  const ms = call.durationMs === null ? '—' : `${Math.round(call.durationMs)}ms`;
  return `${scopeWord} · ${call.model} · ${tokensLabel(totalTokens(call.tokens))} · ${ms}`;
}

// ── The rate-card override (item 4c) ────────────────────────────────────────

/**
 * **Is this rate card typed correctly?** — checked here so the learner is told before they save.
 *
 * `src/main/cost/rates.ts` is the authority and merges entry by entry, ignoring the bad ones
 * rather than throwing, so a typo can never blank the panel. That is the right behaviour on the
 * main side and the wrong behaviour in a text box: silently dropping the line somebody just typed
 * is how a setting comes to be believed and not applied. Same rules, stated back.
 *
 * Shape: `{"claude-sonnet-5": {"input": 2, "output": 10}}`, dollars per million tokens.
 * `cacheWrite` / `cacheRead` are optional and derive from `input` when omitted.
 */
export function validateRateCard(json: string): { ok: boolean; errors: string[] } {
  if (json.trim().length === 0) return { ok: true, errors: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { ok: false, errors: [`not JSON: ${(err as Error).message}`] };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, errors: ['expected an object of model id → prices'] };
  }
  const errors: string[] = [];
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) errors.push('no models in it');
  for (const [model, raw] of entries) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      errors.push(`${model}: expected an object`);
      continue;
    }
    const v = raw as Record<string, unknown>;
    for (const key of ['input', 'output'] as const) {
      if (!nonNegative(v[key])) errors.push(`${model}: ${key} is required and must be a number ≥ 0`);
    }
    for (const key of ['cacheWrite', 'cacheWrite1h', 'cacheRead'] as const) {
      if (key in v && !nonNegative(v[key])) errors.push(`${model}: ${key} must be a number ≥ 0`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function nonNegative(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

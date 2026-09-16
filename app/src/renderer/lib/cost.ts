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
  REPORTED_USD_LABEL,
  addTokens,
  formatTokens,
  formatUsd,
  totalTokens,
  usdLabel,
  type CliWindowBurn,
  type CostCallView,
  type CostLevel,
  type CostMode,
  type CostSummary,
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
  if (summary.mode === 'none') return head;
  return `${head} · ${usdApprox(summary.estimatedUsd)}${usdSuffix(summary.mode)}`;
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
  return `last ${burn.hours || CLI_WINDOW_HOURS} h · ${tokens} · ${usdApprox(burn.estimatedUsd)}${usdSuffix(mode)}`;
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
  const arriving: CostMode = backend === 'claude-cli' ? 'subscription' : backend === 'anthropic' ? 'api' : 'none';
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
    for (const key of ['cacheWrite', 'cacheRead'] as const) {
      if (key in v && !nonNegative(v[key])) errors.push(`${model}: ${key} must be a number ≥ 0`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function nonNegative(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * **What the app has spent, in tokens — and what that would have cost on the API.**
 *
 * The contract between the cost ledger in `src/main/cost/` and whatever renders it. Portable
 * and dependency-free like everything else in `src/shared`, because both halves need it: the
 * main process aggregates and the renderer draws counters against these exact shapes.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THREE THINGS THIS FILE IS CAREFUL ABOUT
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * 1. **Tokens are the fact; dollars are a model.** Every row in `llm_usage` carries four token
 *    counts that the provider itself reported. `estimatedUsd` is arithmetic this app did
 *    afterwards against a rate card cached from the `claude-api` skill, and it is *not* money
 *    anybody was charged. `reportedUsd` is the only number that came from outside — the local
 *    `claude` CLI prints `total_cost_usd` on its final `result` message — and even that is the
 *    CLI's own accounting, which on the one measurement in `docs/research/segmentation-cost.md`
 *    §UNVERIFIED 6 came out **~1.7× the rate card** ($0.0057 against $0.0033 for the same image
 *    call), unreconciled. So the two numbers are carried side by side and never added.
 *
 * 2. **On the CLI path nobody is being billed per token at all.** The default backend is the
 *    learner's own logged-in Claude Code subscription (issue #19). Showing "$0.42 spent" there
 *    would be a lie in the only direction that matters — it would make a student think they owe
 *    money. `CostMode` is therefore part of the wire shape: in `'subscription'` mode a renderer
 *    must lead with tokens and label any dollar figure **"API-equivalent"**, and the CLI's own
 *    number, when it reported one, is labelled **"CLI-reported"**. `usdLabel()` below returns
 *    exactly those strings so the two halves cannot disagree about the wording.
 *
 * 3. **The three levels nest, and the arithmetic has to show it.** `thread ≤ file ≤ app`. A
 *    thread is one anchor's calls (plus the REFERENCE and summary calls that served it); a file
 *    is every room on that file plus the background ingest and objectives work done for it; the
 *    app is everything, including calls that belong to no file at all. A call with a null
 *    `fileId` is invisible at file level by construction and that is correct, not a gap.
 *
 * The 5-hour window (`CliWindowBurn`) is on this surface for the same reason: on a subscription
 * the constraint that actually bites is the rolling usage window, not a bill, and that is what
 * fails invisibly on the evening the A1 video is recorded.
 */

// ── the vocabulary ──────────────────────────────────────────────────────────

/**
 * What a call was *for*. A superset of `LlmScope` (`src/room/llm/types.ts`): the port's scopes
 * are about which prompt builder ran, and two of them are too coarse to bill against.
 *
 * - `'objectives'` is the learning-objective tree ingest (issue #38). It travels as
 *   `LlmScope 'ingest'` because it is the same lane, but it is a per-file background cost and a
 *   learner asking "what did this deck cost me" must be able to see it separately from the
 *   concept-pack ingest that made the room.
 * - `'summary'` is reserved for the recap / wrap-up path, which does not exist as its own scope
 *   yet. It is in the union now so a row written later needs no migration and no renderer change.
 */
export type CostScope =
  | 'group'
  | 'reference'
  | 'whisper'
  | 'orchestrator'
  | 'ledger'
  | 'ingest'
  | 'objectives'
  | 'summary';

export const COST_SCOPES: readonly CostScope[] = [
  'group',
  'reference',
  'whisper',
  'orchestrator',
  'ledger',
  'ingest',
  'objectives',
  'summary',
] as const;

/** Human wording for a scope, so a counter and a drawer never label the same row differently. */
export const COST_SCOPE_LABEL: Record<CostScope, string> = {
  group: 'Agent turns',
  reference: 'Ask here',
  whisper: 'Whispers',
  orchestrator: 'Turn decisions',
  ledger: 'Ledger',
  ingest: 'Setup',
  objectives: 'Objectives',
  summary: 'Summaries',
};

/** Mirrors `LlmBackend`. Repeated rather than imported: `src/shared` may not depend on `src/room`. */
export type CostBackend = 'anthropic' | 'claude-cli' | 'scripted';

/** app = everything; file = every room on one document; thread = one anchor. */
export type CostLevel = 'app' | 'file' | 'thread';

/**
 * Which billing reality the numbers in a summary describe.
 *
 * - `'subscription'` — every call in it came from the local CLI. Dollars are **API-equivalent**
 *   and must be labelled as such; the headline is tokens.
 * - `'api'` — every call went to api.anthropic.com on the learner's own key. Dollars are a real
 *   estimate of a real bill (still an estimate: the rate card is cached, not fetched).
 * - `'mixed'` — both, in the same window. Treat it as `'subscription'` for labelling, because
 *   the safe error is under-claiming what was spent.
 * - `'none'` — no billable call at all (an empty window, or a scripted session, which costs
 *   nothing by construction and is why `scripted` rows are recorded with zero tokens rather
 *   than not recorded: "the video path spent nothing" is a fact worth being able to show).
 */
export type CostMode = 'subscription' | 'api' | 'mixed' | 'none';

// ── the numbers ─────────────────────────────────────────────────────────────

/**
 * The four counts every provider reports. Named in the app's own words rather than the wire's
 * (`cache_creation_input_tokens` → `cacheWrite`) because these travel to a renderer.
 *
 * `input` **excludes** cache reads and cache writes, exactly as the Anthropic `usage` object
 * does: they are separately priced and adding them into `input` would double-count. A "total
 * tokens" figure is therefore `input + output + cacheWrite + cacheRead` — `totalTokens()`.
 */
export interface CostTokens {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export function emptyTokens(): CostTokens {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
}

export function addTokens(a: CostTokens, b: CostTokens): CostTokens {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

export function totalTokens(t: CostTokens): number {
  return t.input + t.output + t.cacheWrite + t.cacheRead;
}

/** One slice of a summary: by model, by scope or by backend. `key` is whichever it is. */
export interface CostSlice {
  key: string;
  calls: number;
  tokens: CostTokens;
  estimatedUsd: number;
  /** Null unless at least one call in the slice reported its own figure (the CLI path). */
  reportedUsd: number | null;
}

// ── the summary ─────────────────────────────────────────────────────────────

/** `cost:summary`'s input. `fileId` is required at file level, `anchorId` at thread level. */
export interface CostSummaryQuery {
  level: CostLevel;
  fileId?: string | null;
  anchorId?: string | null;
  /**
   * ISO timestamp. Only calls at or after it are counted.
   *
   * Omit for all time. `SESSION_WINDOW` asks for "since this app launched" without the caller
   * having to know when that was — the main process substitutes its own start time, which is
   * the only place that can answer it honestly across a relaunch.
   */
  since?: string | null;
}

/** Pass as `since` for the since-launch window. A literal so it cannot collide with an ISO date. */
export const SESSION_WINDOW = 'session';

export interface CostSummary {
  level: CostLevel;
  fileId: string | null;
  anchorId: string | null;

  tokens: CostTokens;
  calls: number;
  /** Rate-card arithmetic. In `'subscription'` mode this is the API-equivalent, not money spent. */
  estimatedUsd: number;
  /** The sum of what the CLI reported, over the calls that reported one. Null when none did. */
  reportedUsd: number | null;
  /** How many of `calls` carried a `reportedUsd`, so a renderer can say "of 12 calls, 9 reported". */
  reportedCalls: number;

  byModel: CostSlice[];
  byScope: CostSlice[];
  byBackend: CostSlice[];

  /** ISO start of the counted window; null means all time. */
  windowStart: string | null;
  /** The oldest and newest call actually counted. Both null on an empty summary. */
  firstCallAt: string | null;
  lastCallAt: string | null;

  mode: CostMode;
  /** The date the rate card was cached from the `claude-api` skill. For the footnote. */
  rateCardDate: string;
  /**
   * The rolling 5-hour window, present only when the CLI path is in play — on a subscription
   * that window is the real constraint, and a dollar figure is not (item 4 of the brief).
   */
  cliWindow: CliWindowBurn | null;
  /** How many rows in this summary were reconstructed by the backfill rather than recorded live. */
  backfilledCalls: number;
}

/**
 * The rolling 5-hour usage window on the CLI path.
 *
 * Rolling from *now*, not from a fixed boundary: `windowStart = now − 5 h`. Claude Code's own
 * window resets on a schedule this app cannot see, so a fixed boundary would be a guess
 * presented as a fact, whereas "what you have put through in the last five hours" is something
 * this app knows exactly and is the number that predicts the wall.
 */
export interface CliWindowBurn {
  windowStart: string;
  windowEnd: string;
  hours: number;
  tokens: CostTokens;
  calls: number;
  estimatedUsd: number;
  reportedUsd: number | null;
}

/** One row for the debug drawer. No prompt, no reply, no bodies — sizes and counts only. */
export interface CostCallView {
  id: string;
  createdAt: string;
  scope: CostScope;
  model: string;
  backend: CostBackend;
  tokens: CostTokens;
  estimatedUsd: number;
  reportedUsd: number | null;
  durationMs: number | null;
  roomId: string | null;
  fileId: string | null;
  anchorId: string | null;
  turnId: string | null;
  backfilled: boolean;
}

/**
 * Pushed after every recorded call so a counter can tick without polling.
 *
 * It carries the **delta**, not a new total: a renderer holding three counters (app, this file,
 * this thread) can add the delta to whichever of them the call belongs to, and the `fileId` /
 * `anchorId` here are how it knows which. A renderer that would rather re-ask may, and
 * `cost:summary` is authoritative; this exists so that it does not have to on every turn.
 */
export interface CostUpdate {
  call: CostCallView;
  /** Running totals for the app since launch, so a header counter needs no second call. */
  sessionTotals: { tokens: CostTokens; calls: number; estimatedUsd: number };
}

// ── labelling ───────────────────────────────────────────────────────────────

/**
 * **The words a dollar figure must be shown with.** Not advisory: on the CLI path an unlabelled
 * dollar figure is a false claim that a student owes money.
 */
export function usdLabel(mode: CostMode): string {
  switch (mode) {
    case 'api':
      return 'estimated';
    case 'none':
      return 'nothing spent';
    default:
      return 'API-equivalent';
  }
}

/** What the CLI's own `total_cost_usd` is called wherever it is shown. */
export const REPORTED_USD_LABEL = 'CLI-reported';

/**
 * One line a renderer can print without deciding anything: tokens first, then the dollar figure
 * with its label. Kept here so every surface — Settings, a thread footer, the debug drawer —
 * says it the same way.
 */
export function costLine(input: { tokens: CostTokens; estimatedUsd: number; mode: CostMode }): string {
  const tokens = formatTokens(totalTokens(input.tokens));
  if (input.mode === 'none') return `${tokens} tokens`;
  return `${tokens} tokens · ${formatUsd(input.estimatedUsd)} ${usdLabel(input.mode)}`;
}

/** `1234` → `1.2K`, `1234567` → `1.23M`. Small numbers are printed whole. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const v = Math.max(0, Math.round(n));
  if (v < 1_000) return String(v);
  if (v < 1_000_000) return `${(v / 1_000).toFixed(v < 10_000 ? 1 : 0)}K`;
  return `${(v / 1_000_000).toFixed(2)}M`;
}

/**
 * Money, at a precision that does not pretend. Under a cent shows as `<$0.01` rather than
 * `$0.00`, because "$0.00" reads as "free" and these calls are not free on the API path.
 */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0.00';
  if (n < 0.01) return '<$0.01';
  if (n < 10) return `$${n.toFixed(3).replace(/0$/, '')}`;
  return `$${n.toFixed(2)}`;
}

/** The mode implied by which backends appear in a set of rows. */
export function modeFor(backends: Iterable<CostBackend>): CostMode {
  let cli = false;
  let api = false;
  for (const b of backends) {
    if (b === 'claude-cli') cli = true;
    else if (b === 'anthropic') api = true;
  }
  if (cli && api) return 'mixed';
  if (cli) return 'subscription';
  if (api) return 'api';
  return 'none';
}

/** The rolling window's length, in hours. One constant, both halves (item 4 of the brief). */
export const CLI_WINDOW_HOURS = 5;

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
  | 'summary'
  // collab-doc (#48): the two-pass notes ingest, and the structured doc-edit call after a turn.
  | 'notes'
  | 'docedit';

export const COST_SCOPES: readonly CostScope[] = [
  'group',
  'reference',
  'whisper',
  'orchestrator',
  'ledger',
  'ingest',
  'objectives',
  'summary',
  'notes',
  'docedit',
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
  notes: 'Lecture notes',
  docedit: 'Doc edits',
};

/**
 * **The scopes that build a document rather than talk about one.**
 *
 * The two-pass notes ingest, the concept pack and the objectives tree are paid **once per deck,
 * before a word is said** — six calls and some minutes on a 40-slide lecture, the largest single
 * cost in the app. Everything else is conversation and scales with how long the learner stays.
 *
 * A ranked "which documents cost the most" list that did not split these two would be a list of
 * *which decks were opened*, which is not the question. So the split is a shared constant: the
 * analytics SQL groups on it and the doc header counter prints it as its own line, and the two
 * cannot come to disagree about which side `objectives` falls on.
 */
export const INGEST_SCOPES: readonly CostScope[] = ['notes', 'ingest', 'objectives'] as const;

export function isIngestScope(scope: CostScope): boolean {
  return (INGEST_SCOPES as readonly string[]).includes(scope);
}

/** Mirrors `LlmBackend`. Repeated rather than imported: `src/shared` may not depend on `src/room`. */
export type CostBackend = 'anthropic' | 'claude-cli' | 'scripted' | 'openai' | 'gemini' | 'openai-compatible';

/**
 * The backends that bill the learner's own key per token. Everything except the local CLI (a
 * subscription) and the script (free). An OpenAI-compatible endpoint is counted here even when it
 * is a local Ollama that bills nobody: its dollars are shown as unknown rather than zero (see
 * `rateFor` in `src/main/cost/rates.ts`), and "API" is the safer label than "free".
 */
export function isApiBackend(b: CostBackend | string | null | undefined): boolean {
  return b === 'anthropic' || b === 'openai' || b === 'gemini' || b === 'openai-compatible';
}

/** app = everything; file = every room on one document; thread = one anchor. */
export type CostLevel = 'app' | 'file' | 'thread';

/**
 * Which billing reality the numbers in a summary describe.
 *
 * - `'subscription'` — every call in it came from the local CLI. Dollars are **API-equivalent**
 *   and must be labelled as such; the headline is tokens.
 * - `'api'` — every call went to an API provider on the learner's own key (Anthropic, OpenAI,
 *   Gemini, or an OpenAI-compatible endpoint; see `isApiBackend`). Dollars are a real
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

/**
 * **How a call ended** (migration 021; #42's known gap, closed).
 *
 * Until 2026-09-19 a call that threw recorded nothing, so every total was a floor that got
 * quietly *better* the more a session went wrong. The decorator now records either way.
 *
 * - `'ok'` — returned normally.
 * - `'error'` — threw. The tokens on the row are whatever the backend managed to report first,
 *   which on the CLI path is usually nothing: it kills the child before the `result` message.
 *   A zero-token `error` row is therefore not noise, it is the only trace that a call happened.
 * - `'aborted'` — the learner pressed Stop. **Not a failure** (`LlmAbortedError` says so), but
 *   it is not a completed call either and a panel that mixed the two would mis-describe both.
 * - `'preempted'` — the notes lane was killed so a learner's click could get through
 *   (`CliPreemptedError`), and `notes/ingest.ts` re-queued that window. The row that follows is a
 *   *second* call for the same work; without this one the re-queue looks like cost the ingest
 *   invented.
 */
export type CostOutcome = 'ok' | 'error' | 'aborted' | 'preempted';

export const COST_OUTCOMES: readonly CostOutcome[] = ['ok', 'error', 'aborted', 'preempted'] as const;

export const COST_OUTCOME_LABEL: Record<CostOutcome, string> = {
  ok: 'Completed',
  error: 'Failed',
  aborted: 'Stopped by you',
  preempted: 'Pre-empted and re-queued',
};

/** Did this call produce an answer? `'aborted'` is deliberately *not* a failure (see above). */
export function isFailedOutcome(outcome: CostOutcome): boolean {
  return outcome === 'error' || outcome === 'preempted';
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
  /** Rows written before migration 021 read as `'ok'`, which is what they were. */
  outcome: CostOutcome;
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

// ── per message (#42 item B) ────────────────────────────────────────────────

/**
 * **What one message cost**, which is the level a learner actually asks about.
 *
 * The three levels above are sums over a *filter* — a document, a thread, everything. This one
 * is a sum over a **causal set**: every call made on one reply's behalf. For an agent turn that
 * is the orchestrator's decision, the ledger coding of the learner message it answered, the
 * generation itself (or Ellie's structured cue, which replaces it), and the doc-edit planner
 * that ran beside it. Five calls, one card on screen, one number.
 *
 * The join is `messages.turn_id = llm_usage.turn_id` (migration 021). The actor already filed
 * every call under `PendingTurn.id`; the column that landed with 021 is the other end of it.
 * Private threads join the same way through `whispers.turn_id`.
 *
 * A message with **no** row here is not a message that cost nothing — it is one written by a
 * rule (the hand-off line, a nudge), or one recorded before 021. The renderer shows no meter at
 * all in that case rather than a zero, because `0 tok` on a model-written turn is a lie and on a
 * rule-written one is a distraction.
 */
export interface CostMessageQuery {
  roomId: string;
  /** Narrow to one thread — `'doc'`, a `span_…` anchor, or a private thread id. */
  threadId?: string | null;
}

export interface CostMessageCost {
  /** `messages.id`, or `whispers.id` when `kind` is `'whisper'`. */
  messageId: string;
  kind: 'message' | 'whisper';
  turnId: string;
  anchorId: string | null;
  calls: number;
  tokens: CostTokens;
  estimatedUsd: number;
  reportedUsd: number | null;
  /** Summed `duration_ms` over the calls. Null when not one of them timed itself. */
  ms: number | null;
  /** Which models answered, biggest contributor first. Usually one. */
  models: string[];
  /** turn · decision · ledger · doc edit — the breakdown the expanded meter shows. */
  byScope: CostSlice[];
  mode: CostMode;
  /** Calls that threw or were pre-empted. Shown, because a retried turn cost twice. */
  failedCalls: number;
  /**
   * Calls on a BYOK provider whose model is not on the rate card (`rateFor` → `UNKNOWN_RATE`).
   * Their dollars are **unknown**, not zero, and the meter says so. Optional so an older main
   * process (or a mock) that does not send it reads as "all priced".
   */
  unpricedCalls?: number;
}

// ── the analytics page (#42 item D) ─────────────────────────────────────────

/** Every filter the Usage page offers. All optional; omitting all of them is "everything". */
export interface CostAnalyticsQuery {
  /** ISO, or `SESSION_WINDOW`. Omit for all time. */
  since?: string | null;
  /** ISO. Omit for "up to now". */
  until?: string | null;
  fileId?: string | null;
  backend?: CostBackend | null;
}

/** One document, ranked. The ingest split is the point: it is the big one and it is one-off. */
export interface CostDocumentRow {
  fileId: string;
  title: string;
  calls: number;
  tokens: CostTokens;
  estimatedUsd: number;
  reportedUsd: number | null;
  /**
   * The one-off cost of *making* the document: the two-pass notes ingest, the concept pack, the
   * objectives tree. Paid once per deck, before a word is said.
   */
  ingest: { calls: number; tokens: CostTokens; estimatedUsd: number };
  /** Everything since: turns, decisions, doc edits, ledger, whispers, summaries. */
  conversation: { calls: number; tokens: CostTokens; estimatedUsd: number };
  firstCallAt: string | null;
  lastCallAt: string | null;
}

/** One day's burn, for the bar chart. `day` is `YYYY-MM-DD`, in the machine's own local dates. */
export interface CostDayRow {
  day: string;
  calls: number;
  tokens: CostTokens;
  estimatedUsd: number;
}

/**
 * **The number a course-wide deployment is budgeted from.**
 *
 * Mean *and* median, because the distribution is skewed and saying so is the honest thing: one
 * ingest-adjacent outlier moves a mean by a factor and leaves a median where it was. A budget
 * built on the mean over-provisions; one built on the median under-provisions; both are shown.
 */
export interface CostPerMessageStats {
  /** Learner messages in the window — the denominator a per-student estimate divides by. */
  learnerMessages: number;
  /** Agent replies that a model actually wrote (a rule-written line is not one). */
  agentMessages: number;
  meanUsdPerLearnerMessage: number;
  medianUsdPerAgentMessage: number;
  meanTokensPerLearnerMessage: number;
  medianTokensPerAgentMessage: number;
}

/**
 * **Cache hit share.** On the CLI path this is substantially the whole bill (`rates.ts` note 2:
 * 86 plain input tokens against 288,291 cache reads over 43 calls), so a panel that showed only
 * "input tokens" would be describing a rounding error.
 */
export interface CostCacheStats {
  freshInput: number;
  cacheRead: number;
  cacheWrite: number;
  /** `cacheRead / (cacheRead + freshInput)`, or 0 when there was no input at all. */
  hitShare: number;
}

export interface CostOutcomeRow {
  outcome: CostOutcome;
  calls: number;
  tokens: CostTokens;
  estimatedUsd: number;
}

/** What the Usage page draws. One IPC call; every panel on it is a field here. */
export interface CostAnalytics {
  /** The filters as the main process resolved them — `SESSION_WINDOW` already substituted. */
  windowStart: string | null;
  windowEnd: string | null;
  fileId: string | null;
  backend: CostBackend | null;

  /** Everything inside the filters. */
  total: {
    calls: number;
    tokens: CostTokens;
    estimatedUsd: number;
    reportedUsd: number | null;
    reportedCalls: number;
  };
  /** Since this launch, *ignoring* the time filter — the one number that is always "right now". */
  session: { calls: number; tokens: CostTokens; estimatedUsd: number };

  documents: CostDocumentRow[];
  byScope: CostSlice[];
  byModel: CostSlice[];
  byBackend: CostSlice[];
  byDay: CostDayRow[];
  outcomes: CostOutcomeRow[];
  cache: CostCacheStats;
  perMessage: CostPerMessageStats;
  /** Slowest and most expensive recent calls. Ten each, no bodies, ever. */
  slowest: CostCallView[];
  priciest: CostCallView[];

  cliWindow: CliWindowBurn | null;
  mode: CostMode;
  rateCardDate: string;
  /** Every document the ledger knows about, for the filter menu. Unfiltered by the query. */
  knownFiles: { fileId: string; title: string }[];
  generatedAt: string;
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
    else if (isApiBackend(b)) api = true;
  }
  if (cli && api) return 'mixed';
  if (cli) return 'subscription';
  if (api) return 'api';
  return 'none';
}

/** The rolling window's length, in hours. One constant, both halves (item 4 of the brief). */
export const CLI_WINDOW_HOURS = 5;

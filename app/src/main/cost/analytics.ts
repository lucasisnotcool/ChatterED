/**
 * **Per-message cost, and the page that answers "where is it all going".**
 *
 * `ledger.ts` owns the write path and the three nesting levels (`thread ≤ file ≤ app`). This
 * file owns the two reads those three cannot do:
 *
 *  1. **`cost:messages`** (#42 item B) — a sum over a *causal set* rather than a filter. Every
 *     call made on one reply's behalf: the orchestrator's decision, the ledger coding of the
 *     learner message it answered, the generation (or Ellie's structured cue, which replaces
 *     it), and the doc-edit planner that ran beside it. The join is `turn_id`, which the actor
 *     was already writing on every call and which migration 021 put on the message row.
 *  2. **`cost:analytics`** (#42 item D) — every panel of the Usage page in one query set.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE ARITHMETIC IS IN SQL
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The same reason `ledger.summary()` gives, one size up. The analytics page is an app-level
 * question by default — every call ever made, which on a semester is tens of thousands of rows —
 * and it asks eight of them at once. Eight `GROUP BY`s over an index is one frame; eight passes
 * of `rows.filter().reduce()` over a materialised array is a page that hangs on open and gets
 * worse every week the app is used.
 *
 * It also makes the relationships *checkable*. `SUM(estimated_cost_usd)` grouped by scope and
 * the same sum grouped by model are the same rows counted two ways, and they agree because
 * SQLite made them agree — not because two hand-written reducers were written by the same person
 * on the same afternoon.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT NEVER COMES OUT OF HERE
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * No learner text. `llm_usage` has no body column, so that half is enforced by the schema; the
 * half that is not is the document *title*, which comes from `files.name` and is a filename the
 * learner chose. Titles appear on the ranked-documents panel because a list of `file_a1b2c3…`
 * answers nothing — and nowhere else. Nothing here reads `messages.body`, `whispers.body`, or
 * any other column carrying words.
 */
import {
  CLI_WINDOW_HOURS,
  COST_OUTCOMES,
  COST_SCOPES,
  addTokens,
  emptyTokens,
  isIngestScope,
  modeFor,
  SESSION_WINDOW,
  totalTokens,
  type CliWindowBurn,
  type CostAnalytics,
  type CostAnalyticsQuery,
  type CostBackend,
  type CostCacheStats,
  type CostCallView,
  type CostDayRow,
  type CostDocumentRow,
  type CostMessageCost,
  type CostMessageQuery,
  type CostMode,
  type CostOutcome,
  type CostOutcomeRow,
  type CostPerMessageStats,
  type CostScope,
  type CostSlice,
  type CostTokens,
} from '../../shared/cost.js';
import type { SqlDatabase } from '../db/driver.js';
import { viewOf, type UsageRow } from './ledger.js';
import { RATE_CARD_DATE } from './rates.js';

/** The five aggregate columns every `GROUP BY` in this file selects, so one mapper reads them. */
const AGGREGATES = `
  COUNT(*)                        AS calls,
  SUM(input_tokens)               AS input_tokens,
  SUM(output_tokens)              AS output_tokens,
  SUM(cache_write_tokens)         AS cache_write_tokens,
  SUM(cache_read_tokens)          AS cache_read_tokens,
  SUM(estimated_cost_usd)         AS estimated_usd,
  SUM(reported_cost_usd)          AS reported_usd,
  SUM(reported_cost_usd IS NOT NULL) AS reported_calls
`;

interface AggregateRow {
  calls: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_write_tokens: number | null;
  cache_read_tokens: number | null;
  estimated_usd: number | null;
  reported_usd: number | null;
  reported_calls: number | null;
}

function tokensOf(row: AggregateRow): CostTokens {
  return {
    input: row.input_tokens ?? 0,
    output: row.output_tokens ?? 0,
    cacheWrite: row.cache_write_tokens ?? 0,
    cacheRead: row.cache_read_tokens ?? 0,
  };
}

function sliceOf(key: string, row: AggregateRow): CostSlice {
  return {
    key,
    calls: row.calls ?? 0,
    tokens: tokensOf(row),
    estimatedUsd: round6(row.estimated_usd ?? 0),
    // Null, not zero, when nothing in the slice reported one: the CLI's own figure and the rate
    // card's are never added, and a 0 would read as "the CLI said it was free".
    reportedUsd: (row.reported_calls ?? 0) > 0 ? round6(row.reported_usd ?? 0) : null,
  };
}

export interface AnalyticsDeps {
  db: SqlDatabase;
  /** When this launch started. The `session` figure and the `SESSION_WINDOW` sentinel use it. */
  sessionStart: string;
  now?(): number;
}

// ── per message (#42 item B) ────────────────────────────────────────────────

/**
 * **What each message in a room cost.**
 *
 * One query per surface, because the two surfaces are two tables: the group chat is `messages`,
 * the private threads are `whispers`, and #48 made both of them things a learner reads in the
 * same column. Both join on the same `turn_id` and both are grouped by `(id, scope)` so the
 * expanded meter's breakdown — turn · decision · ledger · doc edit — comes out of SQLite already
 * summed, rather than out of a reducer that would have to agree with the totals by hand.
 *
 * A message with no `turn_id` simply does not appear. That is every learner message, every
 * rule-written line, and every row recorded before migration 021 — and an absent meter on those
 * is the correct rendering, because `0 tok` under a model-written turn is a lie and under a
 * hand-off line is a distraction.
 */
export function messageCosts(deps: AnalyticsDeps, query: CostMessageQuery): CostMessageCost[] {
  const out: CostMessageCost[] = [];
  out.push(...forSurface(deps, query, 'message'));
  out.push(...forSurface(deps, query, 'whisper'));
  // Oldest first, like the thread itself. A stable order matters: the renderer keys on it.
  return out.sort((a, b) => a.messageId.localeCompare(b.messageId));
}

function forSurface(deps: AnalyticsDeps, query: CostMessageQuery, kind: 'message' | 'whisper'): CostMessageCost[] {
  const table = kind === 'message' ? 'messages' : 'whispers';
  const anchorColumn = kind === 'message' ? 'm.anchor_id' : 'm.thread_id';
  const clauses = [`m.room_id = @roomId`, 'm.turn_id IS NOT NULL'];
  const params: Record<string, unknown> = { roomId: query.roomId };
  if (query.threadId) {
    clauses.push(`${anchorColumn} = @threadId`);
    params.threadId = query.threadId;
  }
  /**
   * `sender = 'agent'` on the whisper side: a private exchange carries its turn id on **both**
   * rows (the learner's and the reply's) so the reply can be found from either, and without this
   * the same calls would be reported twice — once under the question and once under the answer.
   * The reply is the row that cost something.
   */
  if (kind === 'whisper') clauses.push("m.sender = 'agent'");

  const rows = deps.db
    .prepare(
      `SELECT m.id                AS message_id,
              ${anchorColumn}     AS anchor_id,
              m.turn_id           AS turn_id,
              u.scope             AS scope,
              u.model             AS model,
              u.backend           AS backend,
              SUM(u.duration_ms)  AS duration_ms,
              SUM(u.outcome IN ('error','preempted')) AS failed_calls,
              SUM(u.rate_exact = 0 AND u.backend IN ('openai','gemini','openai-compatible')) AS unpriced_calls,
              ${AGGREGATES}
         FROM ${table} m
         JOIN llm_usage u ON u.turn_id = m.turn_id
        WHERE ${clauses.join(' AND ')}
        GROUP BY m.id, u.scope, u.model, u.backend`,
    )
    .all<
      AggregateRow & {
        message_id: string;
        anchor_id: string | null;
        turn_id: string;
        scope: string;
        model: string;
        backend: string;
        duration_ms: number | null;
        failed_calls: number | null;
        unpriced_calls: number | null;
      }
    >(params);

  const byMessage = new Map<string, CostMessageCost>();
  const scopesOf = new Map<string, Map<string, CostSlice>>();
  const modelTokens = new Map<string, Map<string, number>>();
  const backendsOf = new Map<string, CostBackend[]>();

  for (const row of rows) {
    const id = row.message_id;
    const existing =
      byMessage.get(id) ??
      ({
        messageId: id,
        kind,
        turnId: row.turn_id,
        anchorId: row.anchor_id,
        calls: 0,
        tokens: emptyTokens(),
        estimatedUsd: 0,
        reportedUsd: null,
        ms: null,
        models: [],
        byScope: [],
        mode: 'none',
        failedCalls: 0,
        unpricedCalls: 0,
      } satisfies CostMessageCost);

    existing.calls += row.calls ?? 0;
    existing.tokens = addTokens(existing.tokens, tokensOf(row));
    existing.estimatedUsd = round6(existing.estimatedUsd + (row.estimated_usd ?? 0));
    if ((row.reported_calls ?? 0) > 0) existing.reportedUsd = round6((existing.reportedUsd ?? 0) + (row.reported_usd ?? 0));
    if (typeof row.duration_ms === 'number') existing.ms = (existing.ms ?? 0) + row.duration_ms;
    existing.failedCalls += row.failed_calls ?? 0;
    existing.unpricedCalls = (existing.unpricedCalls ?? 0) + (row.unpriced_calls ?? 0);
    byMessage.set(id, existing);

    const scopes = scopesOf.get(id) ?? new Map<string, CostSlice>();
    const scopeKey = asScope(row.scope);
    const prior = scopes.get(scopeKey);
    scopes.set(scopeKey, prior ? mergeSlice(prior, sliceOf(scopeKey, row)) : sliceOf(scopeKey, row));
    scopesOf.set(id, scopes);

    const models = modelTokens.get(id) ?? new Map<string, number>();
    models.set(row.model, (models.get(row.model) ?? 0) + totalTokens(tokensOf(row)));
    modelTokens.set(id, models);

    const backends = backendsOf.get(id) ?? [];
    backends.push(row.backend as CostBackend);
    backendsOf.set(id, backends);
  }

  for (const [id, message] of byMessage) {
    message.byScope = [...(scopesOf.get(id)?.values() ?? [])].sort(
      (a, b) => totalTokens(b.tokens) - totalTokens(a.tokens) || a.key.localeCompare(b.key),
    );
    message.models = [...(modelTokens.get(id) ?? new Map())]
      .sort((a, b) => b[1] - a[1])
      .map(([model]) => model);
    message.mode = modeFor(backendsOf.get(id) ?? []);
  }
  return [...byMessage.values()];
}

function mergeSlice(a: CostSlice, b: CostSlice): CostSlice {
  return {
    key: a.key,
    calls: a.calls + b.calls,
    tokens: addTokens(a.tokens, b.tokens),
    estimatedUsd: round6(a.estimatedUsd + b.estimatedUsd),
    reportedUsd: b.reportedUsd === null ? a.reportedUsd : round6((a.reportedUsd ?? 0) + b.reportedUsd),
  };
}

// ── the analytics page (#42 item D) ─────────────────────────────────────────

export function analytics(deps: AnalyticsDeps, query: CostAnalyticsQuery = {}): CostAnalytics {
  const now = deps.now ? deps.now() : Date.now();
  const since = query.since ?? null;
  const windowStart = since === SESSION_WINDOW ? deps.sessionStart : since !== null && since.length > 0 ? since : null;
  const windowEnd = query.until ?? null;

  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (windowStart !== null) {
    clauses.push('created_at >= @since');
    params.since = windowStart;
  }
  if (windowEnd !== null) {
    clauses.push('created_at <= @until');
    params.until = windowEnd;
  }
  if (query.fileId) {
    clauses.push('file_id = @fileId');
    params.fileId = query.fileId;
  }
  if (query.backend) {
    clauses.push('backend = @backend');
    params.backend = query.backend;
  }
  const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;

  const one = (sql: string, p: Record<string, unknown> = params): AggregateRow =>
    deps.db.prepare(sql).get<AggregateRow>(p) ?? emptyAggregate();

  const total = one(`SELECT ${AGGREGATES} FROM llm_usage ${where}`);

  /**
   * **The session figure ignores the time filter, on purpose.**
   *
   * Everything else on the page answers "inside these filters"; this one answers "right now, in
   * this run of the app", and it has to keep answering it while the learner is looking at last
   * week. A session total that went blank when the range was narrowed would be the one number on
   * the page that a learner checks against their own memory, silently disagreeing with it.
   */
  const session = one(`SELECT ${AGGREGATES} FROM llm_usage WHERE created_at >= @start`, { start: deps.sessionStart });

  return {
    windowStart,
    windowEnd,
    fileId: query.fileId ?? null,
    backend: query.backend ?? null,
    total: {
      calls: total.calls ?? 0,
      tokens: tokensOf(total),
      estimatedUsd: round6(total.estimated_usd ?? 0),
      reportedUsd: (total.reported_calls ?? 0) > 0 ? round6(total.reported_usd ?? 0) : null,
      reportedCalls: total.reported_calls ?? 0,
    },
    session: {
      calls: session.calls ?? 0,
      tokens: tokensOf(session),
      estimatedUsd: round6(session.estimated_usd ?? 0),
    },
    documents: documents(deps, where, params),
    byScope: grouped(deps, where, params, 'scope'),
    byModel: grouped(deps, where, params, 'model'),
    byBackend: grouped(deps, where, params, 'backend'),
    byDay: byDay(deps, where, params),
    outcomes: outcomes(deps, where, params),
    cache: cacheStats(total),
    perMessage: perMessage(deps, windowStart, windowEnd, query.fileId ?? null),
    slowest: calls(deps, where, params, 'duration_ms DESC'),
    priciest: calls(deps, where, params, 'estimated_cost_usd DESC'),
    cliWindow: cliWindow(deps, now),
    mode: modeOf(deps, where, params),
    rateCardDate: RATE_CARD_DATE,
    knownFiles: knownFiles(deps),
    generatedAt: new Date(now).toISOString(),
  };
}

/**
 * **Which documents cost the most, split into the one-off and the ongoing.**
 *
 * The split is the whole point of the panel. A deck's notes ingest is six calls and some minutes
 * *before a word is said* — on the measured decks it dwarfs everything the conversation adds —
 * so a ranked list that did not separate them would rank decks by "was this opened", which is
 * not a budgeting question. `isIngestScope` is the shared constant both halves read
 * (`src/shared/cost.ts`), so the header counter and this list cannot disagree about `objectives`.
 *
 * Calls with a null `file_id` are absent by construction: they belong to no document and a row
 * called "(none)" in a ranked list of documents invites the reader to treat it as one.
 */
function documents(deps: AnalyticsDeps, where: string, params: Record<string, unknown>): CostDocumentRow[] {
  const scoped = where.length === 0 ? 'WHERE file_id IS NOT NULL' : `${where} AND file_id IS NOT NULL`;
  const ingestList = COST_SCOPES.filter(isIngestScope)
    .map((s) => `'${s}'`)
    .join(', ');
  const rows = deps.db
    .prepare(
      `SELECT file_id                      AS file_id,
              MIN(created_at)              AS first_call_at,
              MAX(created_at)              AS last_call_at,
              SUM(scope IN (${ingestList}))                                     AS ingest_calls,
              SUM(CASE WHEN scope IN (${ingestList}) THEN input_tokens ELSE 0 END)       AS ingest_input,
              SUM(CASE WHEN scope IN (${ingestList}) THEN output_tokens ELSE 0 END)      AS ingest_output,
              SUM(CASE WHEN scope IN (${ingestList}) THEN cache_write_tokens ELSE 0 END) AS ingest_cache_write,
              SUM(CASE WHEN scope IN (${ingestList}) THEN cache_read_tokens ELSE 0 END)  AS ingest_cache_read,
              SUM(CASE WHEN scope IN (${ingestList}) THEN estimated_cost_usd ELSE 0 END) AS ingest_usd,
              ${AGGREGATES}
         FROM llm_usage
         ${scoped}
        GROUP BY file_id`,
    )
    .all<
      AggregateRow & {
        file_id: string;
        first_call_at: string | null;
        last_call_at: string | null;
        ingest_calls: number | null;
        ingest_input: number | null;
        ingest_output: number | null;
        ingest_cache_write: number | null;
        ingest_cache_read: number | null;
        ingest_usd: number | null;
      }
    >(params);

  const titles = titleMap(deps);
  return rows
    .map((row) => {
      const tokens = tokensOf(row);
      const ingestTokens: CostTokens = {
        input: row.ingest_input ?? 0,
        output: row.ingest_output ?? 0,
        cacheWrite: row.ingest_cache_write ?? 0,
        cacheRead: row.ingest_cache_read ?? 0,
      };
      const ingestCalls = row.ingest_calls ?? 0;
      const ingestUsd = round6(row.ingest_usd ?? 0);
      return {
        fileId: row.file_id,
        title: titles.get(row.file_id) ?? row.file_id,
        calls: row.calls ?? 0,
        tokens,
        estimatedUsd: round6(row.estimated_usd ?? 0),
        reportedUsd: (row.reported_calls ?? 0) > 0 ? round6(row.reported_usd ?? 0) : null,
        ingest: { calls: ingestCalls, tokens: ingestTokens, estimatedUsd: ingestUsd },
        conversation: {
          calls: (row.calls ?? 0) - ingestCalls,
          tokens: {
            input: tokens.input - ingestTokens.input,
            output: tokens.output - ingestTokens.output,
            cacheWrite: tokens.cacheWrite - ingestTokens.cacheWrite,
            cacheRead: tokens.cacheRead - ingestTokens.cacheRead,
          },
          estimatedUsd: round6((row.estimated_usd ?? 0) - ingestUsd),
        },
        firstCallAt: row.first_call_at,
        lastCallAt: row.last_call_at,
      } satisfies CostDocumentRow;
    })
    .sort((a, b) => totalTokens(b.tokens) - totalTokens(a.tokens) || a.title.localeCompare(b.title));
}

function grouped(deps: AnalyticsDeps, where: string, params: Record<string, unknown>, column: 'scope' | 'model' | 'backend'): CostSlice[] {
  const rows = deps.db
    .prepare(`SELECT ${column} AS key, ${AGGREGATES} FROM llm_usage ${where} GROUP BY ${column}`)
    .all<AggregateRow & { key: string }>(params);
  return rows
    .map((row) => sliceOf(row.key, row))
    .sort((a, b) => totalTokens(b.tokens) - totalTokens(a.tokens) || a.key.localeCompare(b.key));
}

/**
 * Per day, oldest first.
 *
 * `substr(created_at, 1, 10)` and not a `date()` conversion: `created_at` is a UTC ISO string,
 * and grouping it by UTC day is the only grouping that cannot shift a row into a neighbouring
 * bucket depending on where the laptop was opened. The bars are labelled as dates, not as "your
 * Tuesday", so the honest bucket is the one the timestamp is already in.
 */
function byDay(deps: AnalyticsDeps, where: string, params: Record<string, unknown>): CostDayRow[] {
  const rows = deps.db
    .prepare(`SELECT substr(created_at, 1, 10) AS day, ${AGGREGATES} FROM llm_usage ${where} GROUP BY day ORDER BY day`)
    .all<AggregateRow & { day: string }>(params);
  return rows.map((row) => ({
    day: row.day,
    calls: row.calls ?? 0,
    tokens: tokensOf(row),
    estimatedUsd: round6(row.estimated_usd ?? 0),
  }));
}

function outcomes(deps: AnalyticsDeps, where: string, params: Record<string, unknown>): CostOutcomeRow[] {
  const rows = deps.db
    .prepare(`SELECT outcome AS key, ${AGGREGATES} FROM llm_usage ${where} GROUP BY outcome`)
    .all<AggregateRow & { key: string }>(params);
  const byKey = new Map(rows.map((row) => [row.key, row]));
  // Every outcome, always, including the zeroes: "0 failed" is a fact worth showing, and a panel
  // whose rows come and go is a panel a reader cannot learn the shape of.
  return COST_OUTCOMES.map((outcome) => {
    const row = byKey.get(outcome) ?? emptyAggregate();
    return {
      outcome: outcome as CostOutcome,
      calls: row.calls ?? 0,
      tokens: tokensOf(row),
      estimatedUsd: round6(row.estimated_usd ?? 0),
    };
  });
}

function cacheStats(total: AggregateRow): CostCacheStats {
  const cacheRead = total.cache_read_tokens ?? 0;
  const freshInput = total.input_tokens ?? 0;
  const denominator = cacheRead + freshInput;
  return {
    freshInput,
    cacheRead,
    cacheWrite: total.cache_write_tokens ?? 0,
    hitShare: denominator === 0 ? 0 : round6(cacheRead / denominator),
  };
}

/**
 * **Cost per learner message, and per question answered.**
 *
 * Mean *and* median, and they are deliberately of different things. The mean is over **learner
 * messages** — the denominator a "what would 200 students cost" estimate divides by, and the one
 * that must include the ingest, because a student who opens a deck pays for it. The median is
 * over **agent replies**, which is the distribution that has a middle worth quoting: one
 * ingest-sized outlier moves a mean by a factor and leaves a median exactly where it was, and a
 * budget built on either alone is wrong in a predictable direction.
 *
 * `turn_id IS NOT NULL` on the agent side is what makes "a reply a model wrote" precise: the
 * hand-off line, the nudges and the summary offer are rule-written and carry none.
 */
function perMessage(
  deps: AnalyticsDeps,
  windowStart: string | null,
  windowEnd: string | null,
  fileId: string | null,
): CostPerMessageStats {
  const usageClauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (windowStart !== null) {
    usageClauses.push('u.created_at >= @since');
    params.since = windowStart;
  }
  if (windowEnd !== null) {
    usageClauses.push('u.created_at <= @until');
    params.until = windowEnd;
  }
  if (fileId !== null) {
    usageClauses.push('u.file_id = @fileId');
    params.fileId = fileId;
  }
  const usageWhere = usageClauses.length === 0 ? '' : `WHERE ${usageClauses.join(' AND ')}`;

  const totals = deps.db
    .prepare(`SELECT SUM(u.estimated_cost_usd) AS usd, SUM(u.input_tokens + u.output_tokens + u.cache_write_tokens + u.cache_read_tokens) AS tokens FROM llm_usage u ${usageWhere}`)
    .get<{ usd: number | null; tokens: number | null }>(params) ?? { usd: 0, tokens: 0 };

  /**
   * The learner's own messages, counted through the rooms the filtered calls belong to.
   *
   * Through `llm_usage` rather than through `rooms.material_id → materials.file_id`, because the
   * ledger's `file_id` is the one that already survives the ingest happening before the room
   * exists — and using two different definitions of "this document's rooms" on one page is how a
   * ratio comes to be off by the decks that were opened and never talked to.
   */
  const learnerMessages =
    deps.db
      .prepare(
        `SELECT COUNT(*) AS n
           FROM messages m
           JOIN participants p ON p.id = m.participant_id
          WHERE p.kind = 'student'
            AND m.room_id IN (SELECT DISTINCT room_id FROM llm_usage u ${usageWhere} ${usageWhere ? 'AND' : 'WHERE'} u.room_id IS NOT NULL)`,
      )
      .get<{ n: number }>(params)?.n ?? 0;

  const perAgent = deps.db
    .prepare(
      `SELECT SUM(u.estimated_cost_usd) AS usd,
              SUM(u.input_tokens + u.output_tokens + u.cache_write_tokens + u.cache_read_tokens) AS tokens
         FROM messages m
         JOIN llm_usage u ON u.turn_id = m.turn_id
        ${usageWhere}
        GROUP BY m.id`,
    )
    .all<{ usd: number | null; tokens: number | null }>(params);

  return {
    learnerMessages,
    agentMessages: perAgent.length,
    meanUsdPerLearnerMessage: learnerMessages === 0 ? 0 : round6((totals.usd ?? 0) / learnerMessages),
    meanTokensPerLearnerMessage: learnerMessages === 0 ? 0 : Math.round((totals.tokens ?? 0) / learnerMessages),
    medianUsdPerAgentMessage: round6(median(perAgent.map((r) => r.usd ?? 0))),
    medianTokensPerAgentMessage: Math.round(median(perAgent.map((r) => r.tokens ?? 0))),
  };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Ten rows, ordered by whichever column the panel is about. No bodies — `viewOf` has none. */
function calls(deps: AnalyticsDeps, where: string, params: Record<string, unknown>, order: string): CostCallView[] {
  return deps.db
    .prepare(`SELECT * FROM llm_usage ${where} ORDER BY ${order} LIMIT 10`)
    .all<UsageRow>(params)
    .map(viewOf);
}

function modeOf(deps: AnalyticsDeps, where: string, params: Record<string, unknown>): CostMode {
  const rows = deps.db.prepare(`SELECT DISTINCT backend FROM llm_usage ${where}`).all<{ backend: string }>(params);
  return modeFor(rows.map((r) => r.backend as CostBackend));
}

/**
 * The rolling window, as `ledger.cliWindow()` computes it and for the same reason it is not
 * narrowed by the filters: the window is a property of the machine, not of the document being
 * looked at, and "this deck used 4 K of your five hours" invites exactly the wrong inference.
 */
function cliWindow(deps: AnalyticsDeps, now: number): CliWindowBurn | null {
  const startIso = new Date(now - CLI_WINDOW_HOURS * 3_600_000).toISOString();
  const endIso = new Date(now).toISOString();
  const row = deps.db
    .prepare(`SELECT ${AGGREGATES} FROM llm_usage WHERE backend = 'claude-cli' AND created_at >= @s AND created_at <= @e`)
    .get<AggregateRow>({ s: startIso, e: endIso });
  if (!row || (row.calls ?? 0) === 0) return null;
  return {
    windowStart: startIso,
    windowEnd: endIso,
    hours: CLI_WINDOW_HOURS,
    tokens: tokensOf(row),
    calls: row.calls ?? 0,
    estimatedUsd: round6(row.estimated_usd ?? 0),
    reportedUsd: (row.reported_calls ?? 0) > 0 ? round6(row.reported_usd ?? 0) : null,
  };
}

/** Every document the ledger has a row for, for the filter menu. Never narrowed by the query. */
function knownFiles(deps: AnalyticsDeps): { fileId: string; title: string }[] {
  const ids = deps.db
    .prepare('SELECT DISTINCT file_id FROM llm_usage WHERE file_id IS NOT NULL ORDER BY file_id')
    .all<{ file_id: string }>();
  const titles = titleMap(deps);
  return ids
    .map((row) => ({ fileId: row.file_id, title: titles.get(row.file_id) ?? row.file_id }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * `file_id → a name a person recognises`.
 *
 * Three sources in order of how close they are to what the learner sees: the notes doc's own
 * title, the material's title, and the vault file's name. A file id that none of them knows
 * keeps its id, which is ugly and honest — the alternative is inventing a name for a document
 * that has been deleted.
 */
function titleMap(deps: AnalyticsDeps): Map<string, string> {
  const out = new Map<string, string>();
  const add = (rows: { file_id: string | null; title: string | null }[]): void => {
    for (const row of rows) {
      if (!row.file_id || !row.title) continue;
      if (!out.has(row.file_id)) out.set(row.file_id, row.title);
    }
  };
  try {
    add(deps.db.prepare('SELECT file_id, title FROM notes_docs WHERE file_id IS NOT NULL').all());
  } catch {
    /* A database migrated below 020 has no notes_docs. Not a reason to fail the page. */
  }
  try {
    add(deps.db.prepare('SELECT file_id, title FROM materials WHERE file_id IS NOT NULL').all());
  } catch {
    /* ditto */
  }
  try {
    add(deps.db.prepare('SELECT id AS file_id, name AS title FROM files').all());
  } catch {
    /* ditto */
  }
  return out;
}

function asScope(raw: string): CostScope {
  return (COST_SCOPES as readonly string[]).includes(raw) ? (raw as CostScope) : 'group';
}

function emptyAggregate(): AggregateRow {
  return {
    calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_write_tokens: 0,
    cache_read_tokens: 0,
    estimated_usd: 0,
    reported_usd: null,
    reported_calls: 0,
  };
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

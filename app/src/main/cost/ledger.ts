/**
 * **The ledger: one row per model call, and the three sums over it.**
 *
 * `migrations/017_llm_usage.sql` argues the table. This is everything that reads and writes it:
 * `record()` from the client decorator in `client.ts`, `summary()` behind `cost:summary`,
 * `recent()` behind the debug drawer, `cliWindow()` for the rolling 5-hour burn, and `rows()`
 * for the CSV export.
 *
 * **Why the arithmetic is in SQL and not in JavaScript.** The app level spans every call ever
 * made, and on a real semester that is tens of thousands of rows. `SUM()` over an index is the
 * difference between a counter that ticks and one that stutters, and — more to the point — it
 * makes `thread ≤ file ≤ app` a property of the WHERE clause rather than of three hand-written
 * reducers that could disagree. The three levels are the *same query* with one, two or three
 * predicates; that is the whole design.
 *
 * **Dollars are stored, not recomputed.** `estimated_cost_usd` is written once, by the rate card
 * that was live at the time, and summed thereafter. Recomputing on read would mean a price
 * change silently rewriting what last week cost — the opposite of what a record is for. The card
 * that priced each row is on the row (`rate_card`), so the drift is visible rather than absorbed.
 */
import { randomUUID } from 'node:crypto';
import {
  CLI_WINDOW_HOURS,
  COST_OUTCOMES,
  COST_SCOPES,
  emptyTokens,
  modeFor,
  type CliWindowBurn,
  type CostBackend,
  type CostCallView,
  type CostOutcome,
  type CostScope,
  type CostSlice,
  type CostSummary,
  type CostSummaryQuery,
  type CostTokens,
  SESSION_WINDOW,
} from '../../shared/cost.js';
import type { SqlDatabase } from '../db/driver.js';
import { insert } from '../db/sql.js';
import { estimateUsd, parseRateCardOverride, RATE_CARD_DATE, RATE_CARD_SETTING, type ModelRate } from './rates.js';

/** The table's own shape, snake_case, as it comes back from SQLite. */
export interface UsageRow {
  id: string;
  created_at: string;
  turn_id: string | null;
  room_id: string | null;
  file_id: string | null;
  anchor_id: string | null;
  scope: string;
  model: string;
  backend: string;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  reported_cost_usd: number | null;
  estimated_cost_usd: number;
  rate_card: string;
  rate_exact: number;
  duration_ms: number | null;
  backfilled: number;
  source: string;
  /** 'ok' | 'error' | 'aborted' | 'preempted' (migration 021). */
  outcome: string;
}

/** What the decorator hands over. Everything optional is genuinely unknown, not merely unset. */
export interface RecordInput {
  scope: CostScope;
  model: string;
  backend: CostBackend;
  tokens: CostTokens;
  turnId?: string | null;
  roomId?: string | null;
  fileId?: string | null;
  anchorId?: string | null;
  reportedUsd?: number | null;
  durationMs?: number | null;
  /** Overridable so a test can pin the clock; the app passes nothing and gets `Date.now()`. */
  at?: string;
  /** Set by the backfill. A live call never sets it. */
  backfilled?: boolean;
  source?: string;
  /** A deterministic id, so a backfill run twice inserts the same row twice and SQLite refuses. */
  id?: string;
  /** How the call ended. Omitted means `'ok'` — the only shape that existed before 021. */
  outcome?: CostOutcome;
}

export interface CostLedgerDeps {
  db: SqlDatabase;
  /** The rate-card override lives in `settings`; read on every record so an edit takes effect. */
  readSetting(key: string): string | undefined;
  /**
   * `rooms.material_id → materials.file_id`. Injected rather than queried here so this module
   * needs no repository, and so a test can answer it with a Map.
   */
  fileForRoom(roomId: string): string | null;
  /** When the app started. The `session` window is measured from it. */
  startedAt?: string;
  now?(): number;
}

export class CostLedger {
  readonly #d: CostLedgerDeps;
  readonly #startedAt: string;
  readonly #fileCache = new Map<string, string | null>();

  constructor(deps: CostLedgerDeps) {
    this.#d = deps;
    this.#startedAt = deps.startedAt ?? new Date(this.#now()).toISOString();
  }

  /** ISO of app start. `cost:summary` substitutes it for the `SESSION_WINDOW` sentinel. */
  get sessionStart(): string {
    return this.#startedAt;
  }

  #now(): number {
    return this.#d.now ? this.#d.now() : Date.now();
  }

  #card(): readonly ModelRate[] {
    return parseRateCardOverride(this.#d.readSetting(RATE_CARD_SETTING)).card;
  }

  /**
   * **Write one call.**
   *
   * Returns the row as the renderer sees it, which is what `cost.updated` carries. It throws
   * only on a genuinely broken database — the caller (`client.ts`) still swallows that, because
   * a failed accounting write must never cost the learner their turn.
   */
  record(input: RecordInput): CostCallView {
    const tokens: CostTokens = {
      input: int(input.tokens.input),
      output: int(input.tokens.output),
      cacheWrite: int(input.tokens.cacheWrite),
      cacheRead: int(input.tokens.cacheRead),
    };
    const estimate = estimateUsd(input.model, tokens, this.#card(), input.backend);
    const roomId = input.roomId ?? null;
    const fileId = input.fileId ?? (roomId ? this.#fileFor(roomId) : null);
    const row: UsageRow = {
      id: input.id ?? `use_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      created_at: input.at ?? new Date(this.#now()).toISOString(),
      turn_id: input.turnId ?? null,
      room_id: roomId,
      file_id: fileId,
      anchor_id: input.anchorId ?? null,
      scope: input.scope,
      model: input.model,
      backend: input.backend,
      input_tokens: tokens.input,
      output_tokens: tokens.output,
      cache_write_tokens: tokens.cacheWrite,
      cache_read_tokens: tokens.cacheRead,
      reported_cost_usd: typeof input.reportedUsd === 'number' ? input.reportedUsd : null,
      estimated_cost_usd: estimate.usd,
      rate_card: RATE_CARD_DATE,
      rate_exact: estimate.exact ? 1 : 0,
      duration_ms: typeof input.durationMs === 'number' ? Math.round(input.durationMs) : null,
      backfilled: input.backfilled ? 1 : 0,
      source: input.source ?? 'live',
      outcome: input.outcome ?? 'ok',
    };
    insert(this.#d.db, 'llm_usage', row as unknown as Record<string, unknown>);
    return viewOf(row);
  }

  /**
   * The backfill's insert: the same row, but a duplicate id is **ignored rather than an error**.
   * Re-running the backfill must be safe, because it runs at every launch until it finds nothing.
   */
  recordIfNew(input: RecordInput & { id: string }): boolean {
    const before = this.count();
    const tokens: CostTokens = {
      input: int(input.tokens.input),
      output: int(input.tokens.output),
      cacheWrite: int(input.tokens.cacheWrite),
      cacheRead: int(input.tokens.cacheRead),
    };
    const estimate = estimateUsd(input.model, tokens, this.#card(), input.backend);
    this.#d.db
      .prepare(
        `INSERT OR IGNORE INTO llm_usage
           (id, created_at, turn_id, room_id, file_id, anchor_id, scope, model, backend,
            input_tokens, output_tokens, cache_write_tokens, cache_read_tokens,
            reported_cost_usd, estimated_cost_usd, rate_card, rate_exact, duration_ms, backfilled, source, outcome)
         VALUES
           (@id, @created_at, @turn_id, @room_id, @file_id, @anchor_id, @scope, @model, @backend,
            @input_tokens, @output_tokens, @cache_write_tokens, @cache_read_tokens,
            @reported_cost_usd, @estimated_cost_usd, @rate_card, @rate_exact, @duration_ms, @backfilled, @source, @outcome)`,
      )
      .run({
        id: input.id,
        created_at: input.at ?? new Date(this.#now()).toISOString(),
        turn_id: input.turnId ?? null,
        room_id: input.roomId ?? null,
        file_id: input.fileId ?? null,
        anchor_id: input.anchorId ?? null,
        scope: input.scope,
        model: input.model,
        backend: input.backend,
        input_tokens: tokens.input,
        output_tokens: tokens.output,
        cache_write_tokens: tokens.cacheWrite,
        cache_read_tokens: tokens.cacheRead,
        reported_cost_usd: typeof input.reportedUsd === 'number' ? input.reportedUsd : null,
        estimated_cost_usd: estimate.usd,
        rate_card: RATE_CARD_DATE,
        rate_exact: estimate.exact ? 1 : 0,
        duration_ms: typeof input.durationMs === 'number' ? Math.round(input.durationMs) : null,
        backfilled: 1,
        source: input.source ?? 'backfill',
        outcome: input.outcome ?? 'ok',
      });
    return this.count() > before;
  }

  count(): number {
    return this.#d.db.prepare('SELECT COUNT(*) AS n FROM llm_usage').get<{ n: number }>()?.n ?? 0;
  }

  #fileFor(roomId: string): string | null {
    const cached = this.#fileCache.get(roomId);
    if (cached !== undefined) return cached;
    const resolved = this.#d.fileForRoom(roomId);
    this.#fileCache.set(roomId, resolved);
    return resolved;
  }

  // ── reading ───────────────────────────────────────────────────────────────

  /**
   * **The one query, at three widths.**
   *
   * `thread ≤ file ≤ app` holds because each level only ever *adds* a predicate: app has the
   * time window, file adds `file_id`, thread adds `anchor_id`. There is no path by which a
   * narrower level can count a row a wider one does not.
   */
  summary(query: CostSummaryQuery): CostSummary {
    const { where, params, windowStart } = this.#filter(query);
    const rows = this.#d.db
      .prepare(`SELECT * FROM llm_usage ${where} ORDER BY created_at`)
      .all<UsageRow>(params);

    const tokens = rows.reduce<CostTokens>((acc, r) => addRow(acc, r), emptyTokens());
    const estimatedUsd = round6(rows.reduce((n, r) => n + (r.estimated_cost_usd ?? 0), 0));
    const reportedRows = rows.filter((r) => typeof r.reported_cost_usd === 'number');
    const reportedUsd = reportedRows.length === 0 ? null : round6(reportedRows.reduce((n, r) => n + (r.reported_cost_usd ?? 0), 0));

    return {
      level: query.level,
      fileId: query.fileId ?? null,
      anchorId: query.anchorId ?? null,
      tokens,
      calls: rows.length,
      estimatedUsd,
      reportedUsd,
      reportedCalls: reportedRows.length,
      byModel: slice(rows, (r) => r.model),
      byScope: slice(rows, (r) => r.scope),
      byBackend: slice(rows, (r) => r.backend),
      windowStart,
      firstCallAt: rows[0]?.created_at ?? null,
      lastCallAt: rows.at(-1)?.created_at ?? null,
      mode: modeFor(rows.map((r) => r.backend as CostBackend)),
      rateCardDate: RATE_CARD_DATE,
      cliWindow: this.cliWindow(query),
      backfilledCalls: rows.filter((r) => r.backfilled === 1).length,
    };
  }

  /**
   * **The rolling 5-hour window on the CLI path** (item 4 of the brief).
   *
   * Null when no CLI call falls in it, which is also how an API-only or scripted install gets no
   * window panel at all rather than an empty one. Rolling from *now* rather than from a fixed
   * boundary, for the reason argued on `CliWindowBurn` in `shared/cost.ts`: Claude Code's own
   * reset schedule is not visible from here, and "what you have put through in the last five
   * hours" is something this app knows exactly.
   *
   * It is deliberately **not** narrowed by the summary's file or anchor: the window is a
   * property of the machine, not of the document being looked at. A thread-level panel showing
   * "this thread used 4 K of your window" would invite exactly the wrong inference. Only the
   * level's own `since` is ignored too — the window is five hours, always.
   */
  cliWindow(_query?: CostSummaryQuery): CliWindowBurn | null {
    const end = this.#now();
    const start = end - CLI_WINDOW_HOURS * 3_600_000;
    const startIso = new Date(start).toISOString();
    const endIso = new Date(end).toISOString();
    const rows = this.#d.db
      .prepare(`SELECT * FROM llm_usage WHERE backend = 'claude-cli' AND created_at >= @s AND created_at <= @e`)
      .all<UsageRow>({ s: startIso, e: endIso });
    if (rows.length === 0) return null;
    const reported = rows.filter((r) => typeof r.reported_cost_usd === 'number');
    return {
      windowStart: startIso,
      windowEnd: endIso,
      hours: CLI_WINDOW_HOURS,
      tokens: rows.reduce<CostTokens>((acc, r) => addRow(acc, r), emptyTokens()),
      calls: rows.length,
      estimatedUsd: round6(rows.reduce((n, r) => n + (r.estimated_cost_usd ?? 0), 0)),
      reportedUsd: reported.length === 0 ? null : round6(reported.reduce((n, r) => n + (r.reported_cost_usd ?? 0), 0)),
    };
  }

  /** The last `limit` calls, newest first. For the ⌥⌘D debug drawer. */
  recent(limit = 50): CostCallView[] {
    const n = Math.max(1, Math.min(500, Math.round(limit)));
    return this.#d.db
      .prepare('SELECT * FROM llm_usage ORDER BY created_at DESC, rowid DESC LIMIT @n')
      .all<UsageRow>({ n })
      .map(viewOf);
  }

  /** Every row at or after `since`, oldest first. The CSV export's source. */
  rows(since?: string | null): UsageRow[] {
    if (since === undefined || since === null) {
      return this.#d.db.prepare('SELECT * FROM llm_usage ORDER BY created_at').all<UsageRow>();
    }
    return this.#d.db
      .prepare('SELECT * FROM llm_usage WHERE created_at >= @s ORDER BY created_at')
      .all<UsageRow>({ s: since });
  }

  #filter(query: CostSummaryQuery): { where: string; params: Record<string, unknown>; windowStart: string | null } {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};

    let windowStart: string | null = null;
    const since = query.since ?? null;
    if (since === SESSION_WINDOW) windowStart = this.#startedAt;
    else if (since !== null && since.length > 0) windowStart = since;
    if (windowStart !== null) {
      clauses.push('created_at >= @since');
      params.since = windowStart;
    }

    /**
     * File level is `file_id = X` and nothing else — which is what makes the ingest and the
     * objectives tree land inside it. Those calls have no room (the ingest runs *before* the
     * room exists) so a file-level sum reached through `room_id` would have missed them, which
     * is the whole reason `file_id` is a column of its own rather than a join.
     */
    if (query.level === 'file' || (query.level === 'thread' && query.fileId)) {
      if (!query.fileId) throw new Error('cost:summary at file level needs a fileId');
      clauses.push('file_id = @fileId');
      params.fileId = query.fileId;
    }

    /**
     * Thread level is one anchor. Segment ids are minted globally unique, but `DECK_ANCHOR_ID`
     * is the literal `'deck'` and is shared by every document — so a deck thread is only
     * well-defined together with its file, and the caller is required to pass one.
     */
    if (query.level === 'thread') {
      if (!query.anchorId) throw new Error('cost:summary at thread level needs an anchorId');
      if (query.anchorId === 'deck' && !query.fileId) {
        throw new Error("cost:summary for the deck thread needs a fileId — 'deck' is not unique across documents");
      }
      clauses.push('anchor_id = @anchorId');
      params.anchorId = query.anchorId;
    }

    return { where: clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`, params, windowStart };
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function slice(rows: UsageRow[], key: (r: UsageRow) => string): CostSlice[] {
  const byKey = new Map<string, CostSlice>();
  for (const r of rows) {
    const k = key(r);
    const existing = byKey.get(k) ?? { key: k, calls: 0, tokens: emptyTokens(), estimatedUsd: 0, reportedUsd: null };
    existing.calls += 1;
    existing.tokens = addRow(existing.tokens, r);
    existing.estimatedUsd = round6(existing.estimatedUsd + (r.estimated_cost_usd ?? 0));
    if (typeof r.reported_cost_usd === 'number') {
      existing.reportedUsd = round6((existing.reportedUsd ?? 0) + r.reported_cost_usd);
    }
    byKey.set(k, existing);
  }
  // Biggest first: a breakdown is read to find where the tokens went.
  return [...byKey.values()].sort((a, b) => tokenTotal(b.tokens) - tokenTotal(a.tokens) || a.key.localeCompare(b.key));
}

function tokenTotal(t: CostTokens): number {
  return t.input + t.output + t.cacheWrite + t.cacheRead;
}

function addRow(acc: CostTokens, r: UsageRow): CostTokens {
  return {
    input: acc.input + (r.input_tokens ?? 0),
    output: acc.output + (r.output_tokens ?? 0),
    cacheWrite: acc.cacheWrite + (r.cache_write_tokens ?? 0),
    cacheRead: acc.cacheRead + (r.cache_read_tokens ?? 0),
  };
}

export function viewOf(row: UsageRow): CostCallView {
  return {
    id: row.id,
    createdAt: row.created_at,
    scope: asScope(row.scope),
    model: row.model,
    backend: row.backend as CostBackend,
    tokens: {
      input: row.input_tokens ?? 0,
      output: row.output_tokens ?? 0,
      cacheWrite: row.cache_write_tokens ?? 0,
      cacheRead: row.cache_read_tokens ?? 0,
    },
    estimatedUsd: row.estimated_cost_usd ?? 0,
    reportedUsd: typeof row.reported_cost_usd === 'number' ? row.reported_cost_usd : null,
    durationMs: typeof row.duration_ms === 'number' ? row.duration_ms : null,
    roomId: row.room_id,
    fileId: row.file_id,
    anchorId: row.anchor_id,
    turnId: row.turn_id,
    backfilled: row.backfilled === 1,
    outcome: asOutcome(row.outcome),
  };
}

/** A row from a future build with an outcome this one does not know reads as `'ok'`. */
function asOutcome(raw: string | null | undefined): CostOutcome {
  return (COST_OUTCOMES as readonly string[]).includes(raw ?? '') ? (raw as CostOutcome) : 'ok';
}

/** A row written by a future build with a scope this one does not know reads as `'group'`. */
function asScope(raw: string): CostScope {
  return (COST_SCOPES as readonly string[]).includes(raw) ? (raw as CostScope) : 'group';
}

function int(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

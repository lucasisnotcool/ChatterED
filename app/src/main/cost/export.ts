/**
 * **`cost:export` — the ledger as a CSV, and nothing else.**
 *
 * `~/Documents/ChatterED/usage-<date>.csv`, the path STATUS.md's "History, export to
 * `~/Documents/ChatterED/`" row has been holding open since M0. One row per call, the columns of
 * `llm_usage` in a fixed order, and **no message bodies** — the same rule as the event log and
 * `main.log`, for the same reason: a file a learner is likely to email to a supervisor must not
 * carry a transcript. The table has no body column to leak, so this is an invariant the schema
 * enforces rather than one this file remembers; the test asserts it anyway.
 *
 * Ids travel. `room_id`, `file_id`, `anchor_id` and `turn_id` are opaque local identifiers with
 * no PII in them, and without them the CSV cannot answer the one question it exists for —
 * *which document did my window go on* — outside the app.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { UsageRow } from './ledger.js';

export const CSV_COLUMNS = [
  'created_at',
  'scope',
  'model',
  'backend',
  'input_tokens',
  'output_tokens',
  'cache_write_tokens',
  'cache_read_tokens',
  'total_tokens',
  'estimated_cost_usd',
  'reported_cost_usd',
  'rate_card',
  'rate_exact',
  'duration_ms',
  'room_id',
  'file_id',
  'anchor_id',
  'turn_id',
  'backfilled',
  'source',
] as const;

/**
 * RFC 4180: quote every field, double an embedded quote. Everything is quoted rather than only
 * what needs it, because a model id with a comma in it one day must not shift every later column
 * in a file somebody has already opened in Excel.
 */
export function toCsv(rows: readonly UsageRow[]): string {
  const cell = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [CSV_COLUMNS.map(cell).join(',')];
  for (const r of rows) {
    const total = (r.input_tokens ?? 0) + (r.output_tokens ?? 0) + (r.cache_write_tokens ?? 0) + (r.cache_read_tokens ?? 0);
    lines.push(
      [
        r.created_at,
        r.scope,
        r.model,
        r.backend,
        r.input_tokens,
        r.output_tokens,
        r.cache_write_tokens,
        r.cache_read_tokens,
        total,
        r.estimated_cost_usd,
        r.reported_cost_usd ?? '',
        r.rate_card,
        r.rate_exact,
        r.duration_ms ?? '',
        r.room_id ?? '',
        r.file_id ?? '',
        r.anchor_id ?? '',
        r.turn_id ?? '',
        r.backfilled,
        r.source,
      ]
        .map(cell)
        .join(','),
    );
  }
  // A trailing newline: a CSV without one is a file some tools silently drop the last row of.
  return `${lines.join('\n')}\n`;
}

/** `usage-2026-09-16.csv`. Date only — a second export the same day replaces the first, which is
 * what "export what I have" means; a timestamped file per click leaves a folder nobody prunes. */
export function exportFileName(now: Date): string {
  return `usage-${now.toISOString().slice(0, 10)}.csv`;
}

export interface ExportResult {
  path: string;
  rows: number;
  bytes: number;
}

export function writeCsv(dir: string, rows: readonly UsageRow[], now = new Date()): ExportResult {
  const path = join(dir, exportFileName(now));
  mkdirSync(dirname(path), { recursive: true });
  const csv = toCsv(rows);
  writeFileSync(path, csv, 'utf8');
  return { path, rows: rows.length, bytes: Buffer.byteLength(csv, 'utf8') };
}

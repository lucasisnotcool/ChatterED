import type { SqlDatabase } from './driver.js';

export type SqlValue = string | number | null;

/** SQLite takes primitives only: booleans become 0/1, undefined becomes NULL. */
export function bind(row: Record<string, unknown>): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || v === null) out[k] = null;
    else if (typeof v === 'boolean') out[k] = v ? 1 : 0;
    else if (typeof v === 'number' || typeof v === 'string') out[k] = v;
    else out[k] = JSON.stringify(v);
  }
  return out;
}

export function insert(db: SqlDatabase, table: string, row: Record<string, unknown>): void {
  const params = bind(row);
  const cols = Object.keys(params);
  if (cols.length === 0) throw new Error(`insert into ${table} with no columns`);
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`;
  db.prepare(sql).run(params);
}

export function updateById(
  db: SqlDatabase,
  table: string,
  id: string,
  patch: Record<string, unknown>,
  idColumn = 'id',
): void {
  const params = bind(patch);
  const cols = Object.keys(params);
  if (cols.length === 0) return;
  const sql = `UPDATE ${table} SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE ${idColumn} = @__id`;
  db.prepare(sql).run({ ...params, __id: id });
}

/** node:sqlite hands back null-prototype objects; copy them so `{...row}` and `in` behave. */
export function plain<T>(row: T | undefined): T | undefined {
  return row === undefined || row === null ? undefined : ({ ...row } as T);
}

export function plainAll<T>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r }) as T);
}

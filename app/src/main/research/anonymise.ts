/**
 * **Anonymising the research export's copy of the database** — never the live one.
 *
 * The rule is generic on purpose: every TEXT value in every table found in `sqlite_master` is
 * scrubbed, so a table added by a migration next month is covered without anyone remembering this
 * file. What "scrubbed" means (`makeScrubber`):
 *
 *   - the home directory (`/Users/<name>`, any case) becomes `~`;
 *   - the macOS short username, as a whole word (any case), becomes `<user>`;
 *   - anything shaped like a provider API key becomes `[redacted-key]` — keys live in files, not
 *     here, but a pasted key in a chat message must not ride along.
 *
 * Three things are removed rather than scrubbed:
 *
 *   - **settings rows whose key names a secret** (`isSecretSettingKey`);
 *   - **every virtual table** (today: `file_text`, the vault's FTS5 index). It is a full-text
 *     copy of every file in the learner's folder — lecture decks, and anything else they keep
 *     there — it is rebuildable, and its shadow tables hold tokens a row walk cannot scrub;
 *   - **the columns that hold source-document text** (`SOURCE_TEXT_COLUMNS`): the lecture PDFs'
 *     extracted text. The trial shares what the learner did, not the lecturer's material.
 *
 * `secure_delete` is on and the copy is `VACUUM`ed at the end, so nothing removed here survives
 * in a free page of the exported file.
 */
import type { SqlDatabase } from '../db/driver.js';

export const HOME_REPLACEMENT = '~';
export const USER_REPLACEMENT = '<user>';
export const KEY_REPLACEMENT = '[redacted-key]';

/**
 * `[table, column]` pairs holding text extracted from the learner's source documents. Replaced
 * with a one-line marker that keeps the length, so a reader can still see that there was text.
 * The owner's scope: everything except the source PDFs — and this is the PDFs, as text.
 */
export const SOURCE_TEXT_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['materials', 'extracted_text'],
  ['materials', 'padding_text'],
  ['message_refs', 'page_text'],
];

export function sourceTextMarker(chars: number): string {
  return `[excluded from the research export: ${chars} characters of source-document text]`;
}

/** Anthropic, OpenAI (incl. `sk-proj-`), Google, and a bearer header. Deliberately greedy. */
const KEY_SHAPED = /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|Bearer\s+[A-Za-z0-9._~+/-]{16,}=*)/g;

/** A settings key that names a credential: `api_key`, `openai_key`, `x_token`, `secret`, `password`… */
export function isSecretSettingKey(key: string): boolean {
  return /(^|[_.\-\s])(api[_-]?key|key|keys|secret|secrets|token|password|passwd|credential|credentials|auth|bearer)([_.\-\s]|$)/i.test(
    key,
  ) || /apikey|secret|password|credential/i.test(key);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ScrubIdentity {
  /** `os.homedir()`, e.g. `/Users/jdoe`. */
  home: string;
  /** `os.userInfo().username`, e.g. `jdoe`. */
  username: string;
}

export type Scrub = (value: string) => string;

export function makeScrubber(id: ScrubIdentity): Scrub {
  const home = id.home.replace(/\/+$/, '');
  const homeRe = home.length > 1 ? new RegExp(escapeRegExp(home), 'gi') : null;
  const user = id.username.trim();
  // Letters and digits are the boundary: `jdoe_notes` and `jdoe.pdf` still lose the name. `<` and
  // `>` are too, so the replacement itself is never matched again — the scrub is idempotent even
  // for an account called `user`, which is what lets `findLeaks` use it as its own check.
  const userRe =
    user.length >= 2 ? new RegExp(`(?<![A-Za-z0-9<])${escapeRegExp(user)}(?![A-Za-z0-9>])`, 'gi') : null;
  return (value) => {
    let out = value;
    if (homeRe) out = out.replace(homeRe, HOME_REPLACEMENT);
    if (userRe) out = out.replace(userRe, USER_REPLACEMENT);
    out = out.replace(KEY_SHAPED, KEY_REPLACEMENT);
    return out;
  };
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

interface MasterRow {
  name: string;
  sql: string | null;
}

/** Ordinary tables, oldest first, excluding SQLite's own. */
export function listTables(db: SqlDatabase): string[] {
  return db
    .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid`)
    .all<MasterRow>()
    .filter((r) => !/^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(r.sql ?? ''))
    .map((r) => r.name);
}

function virtualTables(db: SqlDatabase): string[] {
  return db
    .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all<MasterRow>()
    .filter((r) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(r.sql ?? ''))
    .map((r) => r.name);
}

export function hasColumn(db: SqlDatabase, table: string, column: string): boolean {
  return columns(db, table).some((c) => c.name === column);
}

interface ColumnInfo {
  name: string;
  pk: number;
}

function columns(db: SqlDatabase, table: string): ColumnInfo[] {
  try {
    return db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all<ColumnInfo>();
  } catch {
    return [];
  }
}

/**
 * Visit every row of `table` with a stable key to write back through: `rowid` where the table has
 * one (every table in this schema does), else its primary key columns.
 */
function rowsOf(db: SqlDatabase, table: string): { rows: Record<string, unknown>[]; keyCols: string[] } {
  const t = quoteIdent(table);
  try {
    return { rows: db.prepare(`SELECT rowid AS "__rid__", * FROM ${t}`).all<Record<string, unknown>>(), keyCols: ['__rid__'] };
  } catch {
    const pk = columns(db, table)
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);
    return { rows: db.prepare(`SELECT * FROM ${t}`).all<Record<string, unknown>>(), keyCols: pk };
  }
}

export interface AnonymiseReport {
  droppedTables: string[];
  droppedSettings: number;
  excludedColumns: string[];
  valuesScrubbed: number;
  tablesWalked: number;
}

/**
 * Scrub the copy in place. `db` must be the **snapshot**, opened on its own — never the live
 * database. Foreign keys are switched off for the walk: a scrubbed id is still the same id on
 * both sides, and enforcing it mid-walk would only turn a harmless ordering into a failure.
 */
export function anonymiseDatabase(db: SqlDatabase, scrub: Scrub): AnonymiseReport {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('PRAGMA secure_delete = ON');
  // One transaction for the whole walk: tens of thousands of auto-committed UPDATEs are tens of
  // thousands of fsyncs — 12 s on a 50k-message database, against well under one this way.
  db.exec('BEGIN');
  try {
    const report = anonymiseInTransaction(db, scrub);
    db.exec('COMMIT');
    return report;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function anonymiseInTransaction(db: SqlDatabase, scrub: Scrub): AnonymiseReport {
  // The copy's triggers go first. Migration 029's keep the live record from being rewritten, which
  // is exactly what scrubbing this copy does: left in, a scrubbed `messages.body` would file its
  // unscrubbed text in `message_revisions`, and a scrubbed whisper would abort the export.
  const triggers = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'`)
    .all<{ name: string }>()
    .map((r) => r.name);
  for (const name of triggers) db.exec(`DROP TRIGGER IF EXISTS ${quoteIdent(name)}`);

  const droppedTables = virtualTables(db);
  for (const name of droppedTables) db.exec(`DROP TABLE IF EXISTS ${quoteIdent(name)}`);

  let droppedSettings = 0;
  if (listTables(db).includes('settings')) {
    const keys = db.prepare('SELECT key FROM settings').all<{ key: string }>().map((r) => r.key);
    for (const key of keys.filter(isSecretSettingKey)) {
      db.prepare('DELETE FROM settings WHERE key = @k').run({ k: key });
      droppedSettings += 1;
    }
  }

  const excludedColumns: string[] = [];
  for (const [table, column] of SOURCE_TEXT_COLUMNS) {
    if (!listTables(db).includes(table) || !hasColumn(db, table, column)) continue;
    const c = quoteIdent(column);
    // The marker keeps the length; an empty value stays empty, which is what it was.
    const rows = db
      .prepare(`SELECT rowid AS rid, length(${c}) AS n FROM ${quoteIdent(table)} WHERE ${c} IS NOT NULL AND ${c} <> ''`)
      .all<{ rid: number; n: number }>();
    const update = db.prepare(`UPDATE ${quoteIdent(table)} SET ${c} = @v WHERE rowid = @rid`);
    for (const r of rows) update.run({ v: sourceTextMarker(r.n), rid: r.rid });
    excludedColumns.push(`${table}.${column}`);
  }

  let valuesScrubbed = 0;
  const tables = listTables(db);
  // One prepared UPDATE per (table, changed-column set), not one per row.
  const statements = new Map<string, ReturnType<SqlDatabase['prepare']>>();
  const prepared = (sql: string) => {
    let st = statements.get(sql);
    if (!st) statements.set(sql, (st = db.prepare(sql)));
    return st;
  };
  for (const table of tables) {
    const { rows, keyCols } = rowsOf(db, table);
    if (keyCols.length === 0) continue;
    for (const row of rows) {
      const changed: [string, string][] = [];
      for (const [col, value] of Object.entries(row)) {
        if (col === '__rid__' || typeof value !== 'string') continue;
        const next = scrub(value);
        if (next !== value) changed.push([col, next]);
      }
      if (changed.length === 0) continue;
      const params: Record<string, unknown> = {};
      const sets = changed.map(([col, next], i) => {
        params[`v${i}`] = next;
        return `${quoteIdent(col)} = @v${i}`;
      });
      const where = keyCols.map((k, i) => {
        params[`k${i}`] = row[k];
        return `${k === '__rid__' ? 'rowid' : quoteIdent(k)} = @k${i}`;
      });
      const sql = `UPDATE ${quoteIdent(table)} SET ${sets.join(', ')} WHERE ${where.join(' AND ')}`;
      try {
        prepared(sql).run(params);
      } catch {
        // Two values that differed only in the home directory's case now collide on a UNIQUE
        // column. Keep them apart — never keep the unscrubbed one.
        changed.forEach(([, next], i) => (params[`v${i}`] = `${next} (${String(row[keyCols[0]!])})`));
        prepared(sql).run(params);
      }
      valuesScrubbed += changed.length;
    }
  }

  return { droppedTables, droppedSettings, excludedColumns, valuesScrubbed, tablesWalked: tables.length };
}

/**
 * Every `table.column` whose text still trips the scrubber — the export's self-check, and the
 * tests' assertion. Empty is the only acceptable answer.
 */
export function findLeaks(db: SqlDatabase, scrub: Scrub): string[] {
  const leaks = new Set<string>();
  for (const table of listTables(db)) {
    const { rows } = rowsOf(db, table);
    for (const row of rows) {
      for (const [col, value] of Object.entries(row)) {
        if (col !== '__rid__' && typeof value === 'string' && scrub(value) !== value) leaks.add(`${table}.${col}`);
      }
    }
  }
  return [...leaks];
}

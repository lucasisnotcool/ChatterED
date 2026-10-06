/**
 * **Exclude from research data** (migration 032): what the research export leaves out.
 *
 * A folder or a notebook can be marked "Exclude from research data". A folder's mark covers its
 * whole subtree. The effective set is computed here, on every read, from the two flags and the
 * folder tree, so a notebook moved into an excluded folder is excluded with no further write.
 *
 * **Everything tied to an excluded notebook is left out**, found by following the keys the app
 * itself uses (migration 024's header lists them):
 *
 *   the notebook      `notebooks`, `notebook_sources`, its `files` rows (the managed copies, and the
 *                     pre-024 file it was imported from), their FTS rows, its settings rows
 *   its docs          `notes_docs` keyed `nb:<id>` or `nb:<id>:tut:<file>` (or on one of its files),
 *                     and every per-doc table: edits, suggestions, threads, objective blocks, slide
 *                     groups, tutorial parts
 *   its room          the `materials` on the notebook or its files, the `rooms` on those, and every
 *                     row under a room: participants, sessions, messages and their revisions and
 *                     refs, private turns, turn decisions, events, the ledger, rubric scores, the
 *                     outbox, the room's flow-state setting
 *   its progress      the objective tree and states, quiz outcomes and objective activity, by the
 *                     notebook id, a file id, a doc's content key or a room
 *   its cost          `llm_usage` rows filed under the notebook, one of its files, one of its rooms,
 *                     or a turn of one of its rooms
 *   its search rows   `search_chunks`, `search_state`
 *   its bytes' cache  `file_segmentations` / `segments` / `segments_touched` for a sha that no
 *                     remaining file still has
 *
 * Two uses, one rule set: `applyResearchExclusion` deletes the rows from the export's **snapshot**
 * (never the live database), and `excludedCounts` counts them on the live database for
 * Settings ▸ Research trial, read-only. Every table and column is checked first, so an older or
 * newer schema still works.
 */
import type { SqlDatabase } from '../db/driver.js';
import { hasColumn, listTables, quoteIdent } from './anonymise.js';

/** The managed vault's id (`vault/managed.ts`), repeated so this module stays import-light. */
const MANAGED_VAULT_ID = 'vault_notebooks';

export interface ExclusionScope {
  /** Folders marked, and every folder under one. */
  folders: string[];
  /** Notebooks marked, or in an excluded folder. */
  notebooks: string[];
  /** `files.id` of their sources, of any managed copy under their folder, and their legacy file. */
  files: string[];
  docs: string[];
  /** `nb:<id>` and every excluded doc's `content_sha`. */
  contentKeys: string[];
  materials: string[];
  rooms: string[];
  sessions: string[];
  turns: string[];
  /** File shas that no remaining file has. */
  shas: string[];
}

export function emptyScope(): ExclusionScope {
  return { folders: [], notebooks: [], files: [], docs: [], contentKeys: [], materials: [], rooms: [], sessions: [], turns: [], shas: [] };
}

class Schema {
  readonly #tables: Set<string>;
  readonly #cols = new Map<string, boolean>();
  constructor(readonly db: SqlDatabase) {
    // Virtual tables (the FTS index) are listed separately by `listTables`; they are wanted too.
    this.#tables = new Set([
      ...listTables(db),
      ...db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL TABLE%'`)
        .all<{ name: string }>()
        .map((r) => r.name),
    ]);
  }
  has(table: string): boolean {
    return this.#tables.has(table);
  }
  col(table: string, column: string): boolean {
    const key = `${table}.${column}`;
    let v = this.#cols.get(key);
    if (v === undefined) {
      v = this.has(table) && hasColumn(this.db, table, column);
      this.#cols.set(key, v);
    }
    return v;
  }
}

const IN = (param: string) => `IN (SELECT value FROM json_each(@${param}))`;

function ids(db: SqlDatabase, sql: string, params: Record<string, unknown> = {}): string[] {
  return db
    .prepare(sql)
    .all<{ id: string | null }>(params)
    .map((r) => r.id)
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function uniq(...lists: string[][]): string[] {
  return [...new Set(lists.flat())];
}

/** Folders marked, and every folder under one. Empty before migration 032. */
export function excludedFolderIds(db: SqlDatabase): string[] {
  const s = new Schema(db);
  if (!s.col('folders', 'research_exclude')) return [];
  return ids(
    db,
    `WITH RECURSIVE ex(id) AS (
       SELECT id FROM folders WHERE research_exclude = 1
       UNION SELECT f.id FROM folders f JOIN ex ON f.parent_id = ex.id
     )
     SELECT id FROM ex ORDER BY id`,
  );
}

/** Notebooks marked themselves, or in an excluded folder at any depth. Empty before 032. */
export function excludedNotebookIds(db: SqlDatabase): string[] {
  const s = new Schema(db);
  if (!s.has('notebooks')) return [];
  const folders = excludedFolderIds(db);
  const own = s.col('notebooks', 'research_exclude');
  const inFolder = s.col('notebooks', 'folder_id');
  if (!own && !inFolder) return [];
  const where = [own ? 'research_exclude = 1' : null, inFolder ? `folder_id ${IN('folders')}` : null].filter(Boolean).join(' OR ');
  return ids(db, `SELECT id FROM notebooks WHERE ${where} ORDER BY id`, inFolder ? { folders: JSON.stringify(folders) } : {});
}

/** Every id the rules below key on. Read-only. */
export function exclusionScope(db: SqlDatabase): ExclusionScope {
  const s = new Schema(db);
  const folders = excludedFolderIds(db);
  const notebooks = excludedNotebookIds(db);
  if (notebooks.length === 0) return { ...emptyScope(), folders };
  const p = (v: string[]) => JSON.stringify(v);
  const nb = p(notebooks);

  const files = uniq(
    s.has('notebook_sources') ? ids(db, `SELECT file_id AS id FROM notebook_sources WHERE notebook_id ${IN('nb')}`, { nb }) : [],
    s.col('notebooks', 'legacy_file_id') ? ids(db, `SELECT legacy_file_id AS id FROM notebooks WHERE id ${IN('nb')}`, { nb }) : [],
    s.has('files')
      ? ids(
          db,
          `SELECT f.id FROM files f, json_each(@nb) n
            WHERE f.vault_id = @v AND substr(f.rel_path, 1, length(n.value) + 1) = n.value || '/'`,
          { nb, v: MANAGED_VAULT_ID },
        )
      : [],
  );
  const owners = p(uniq(notebooks, files));

  const docs = s.has('notes_docs')
    ? ids(
        db,
        `SELECT d.id FROM notes_docs d
          WHERE d.file_id ${IN('owners')}
             OR EXISTS (SELECT 1 FROM json_each(@nb) n
                         WHERE d.content_sha = 'nb:' || n.value OR substr(d.content_sha, 1, length(n.value) + 4) = 'nb:' || n.value || ':')`,
        { owners, nb },
      )
    : [];
  const contentKeys = uniq(
    notebooks.map((n) => `nb:${n}`),
    s.has('notes_docs') ? ids(db, `SELECT content_sha AS id FROM notes_docs WHERE id ${IN('docs')}`, { docs: p(docs) }) : [],
  );

  const materials = s.col('materials', 'file_id')
    ? ids(db, `SELECT id FROM materials WHERE file_id ${IN('owners')}`, { owners })
    : [];
  const roomSources: string[][] = [];
  if (s.has('rooms')) roomSources.push(ids(db, `SELECT id FROM rooms WHERE material_id ${IN('m')}`, { m: p(materials) }));
  if (s.col('notes_threads', 'doc_id')) roomSources.push(ids(db, `SELECT room_id AS id FROM notes_threads WHERE doc_id ${IN('d')}`, { d: p(docs) }));
  if (s.col('notes_doc_edits', 'room_id')) roomSources.push(ids(db, `SELECT room_id AS id FROM notes_doc_edits WHERE doc_id ${IN('d')}`, { d: p(docs) }));
  for (const t of ['quiz_outcomes', 'objective_activity']) {
    if (s.col(t, 'room_id')) roomSources.push(ids(db, `SELECT room_id AS id FROM ${t} WHERE content_sha ${IN('k')}`, { k: p(contentKeys) }));
  }
  const rooms = uniq(...roomSources);
  const sessions = s.has('sessions') ? ids(db, `SELECT id FROM sessions WHERE room_id ${IN('r')}`, { r: p(rooms) }) : [];
  const turns = s.col('messages', 'turn_id')
    ? uniq(ids(db, `SELECT DISTINCT turn_id AS id FROM messages WHERE room_id ${IN('r')} AND turn_id IS NOT NULL`, { r: p(rooms) }))
    : [];
  const shas =
    s.col('files', 'sha256') && files.length > 0
      ? ids(
          db,
          `SELECT DISTINCT sha256 AS id FROM files
            WHERE id ${IN('f')} AND sha256 IS NOT NULL
              AND sha256 NOT IN (SELECT sha256 FROM files WHERE sha256 IS NOT NULL AND id NOT ${IN('f')})`,
          { f: p(files) },
        )
      : [];
  return { folders, notebooks, files, docs, contentKeys, materials, rooms, sessions, turns, shas };
}

export interface ExclusionRule {
  table: string;
  /** A WHERE clause over the scope's JSON-array parameters. */
  where: string;
}

/** The rules, for the tables and columns this database has. */
export function exclusionRules(db: SqlDatabase): ExclusionRule[] {
  const s = new Schema(db);
  const rules: ExclusionRule[] = [];
  const add = (table: string, ...clauses: [column: string, clause: string][]) => {
    const parts = clauses.filter(([c]) => s.col(table, c)).map(([, clause]) => clause);
    if (parts.length > 0) rules.push({ table, where: parts.join(' OR ') });
  };
  const ownerCols = (col: string): [string, string] => [col, `${col} ${IN('owners')}`];

  add('folders', ['id', `id ${IN('folders')}`]);
  add('notebooks', ['id', `id ${IN('notebooks')}`]);
  add('notebook_sources', ['notebook_id', `notebook_id ${IN('notebooks')}`], ['file_id', `file_id ${IN('files')}`]);
  add('files', ['id', `id ${IN('files')}`]);
  add('file_text', ['file_id', `file_id ${IN('files')}`]);
  // Per-notebook and per-room settings: `notebook_page_hwm:<nb>`, `flow_state:<room>`, … Every id
  // here is a minted `<prefix>_<12 hex>`, so a substring match cannot catch an unrelated key.
  add('settings', ['key', `EXISTS (SELECT 1 FROM json_each(@all) a WHERE instr(settings.key, a.value) > 0)`]);

  add('notes_docs', ['id', `id ${IN('docs')}`]);
  for (const t of ['notes_doc_edits', 'notes_suggestions', 'notes_objective_blocks', 'notes_slide_groups', 'tutorial_parts']) {
    add(t, ['doc_id', `doc_id ${IN('docs')}`]);
  }
  add('notes_threads', ['doc_id', `doc_id ${IN('docs')}`], ['room_id', `room_id ${IN('rooms')}`]);

  add('materials', ['id', `id ${IN('materials')}`]);
  add('rooms', ['id', `id ${IN('rooms')}`]);
  for (const t of ['participants', 'messages', 'whispers', 'turn_decisions', 'message_revisions', 'sessions']) {
    add(t, ['room_id', `room_id ${IN('rooms')}`]);
  }
  add('message_refs', ['room_id', `room_id ${IN('rooms')}`], ['file_id', `file_id ${IN('files')}`]);
  add('events', ['room_id', `room_id ${IN('rooms')}`], ['session_id', `session_id ${IN('sessions')}`]);
  for (const t of ['ledger', 'ledger_history', 'rubric_scores']) add(t, ['session_id', `session_id ${IN('sessions')}`]);
  add('outbox', ['doc_path', `EXISTS (SELECT 1 FROM json_each(@rooms) r WHERE substr(outbox.doc_path, 1, length(r.value) + 7) = 'rooms/' || r.value || '/')`]);

  add('learning_trees', ownerCols('file_id'), ['content_sha', `content_sha ${IN('keys')}`]);
  add('learning_objective_states', ownerCols('file_id'));
  for (const t of ['quiz_outcomes', 'objective_activity']) {
    add(t, ['content_sha', `content_sha ${IN('keys')}`], ['room_id', `room_id ${IN('rooms')}`]);
  }
  add('llm_usage', ownerCols('file_id'), ['room_id', `room_id ${IN('rooms')}`], ['turn_id', `turn_id ${IN('turns')}`]);

  add('search_chunks', ['notebook_id', `notebook_id ${IN('notebooks')}`]);
  add('search_state', ['notebook_id', `notebook_id ${IN('notebooks')}`]);

  for (const t of ['file_segmentations', 'segments', 'segments_touched']) add(t, ['content_sha', `content_sha ${IN('shas')}`]);
  return rules;
}

function params(scope: ExclusionScope): Record<string, string> {
  const j = (v: string[]) => JSON.stringify(v);
  return {
    folders: j(scope.folders),
    notebooks: j(scope.notebooks),
    files: j(scope.files),
    owners: j(uniq(scope.notebooks, scope.files)),
    docs: j(scope.docs),
    keys: j(scope.contentKeys),
    materials: j(scope.materials),
    rooms: j(scope.rooms),
    sessions: j(scope.sessions),
    turns: j(scope.turns),
    shas: j(scope.shas),
    all: j(uniq(scope.notebooks, scope.files, scope.docs, scope.rooms, scope.folders)),
  };
}

/** Only the parameters a clause names: SQLite refuses a named parameter the statement lacks. */
function paramsFor(where: string, all: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) if (new RegExp(`@${k}\\b`).test(where)) out[k] = v;
  return out;
}

function isEmpty(scope: ExclusionScope): boolean {
  return scope.folders.length === 0 && scope.notebooks.length === 0;
}

/** How many rows of each table the export would leave out. Read-only; safe on the live database. */
export function excludedCounts(db: SqlDatabase, scope: ExclusionScope = exclusionScope(db)): Record<string, number> {
  const out: Record<string, number> = {};
  if (isEmpty(scope)) return out;
  const all = params(scope);
  for (const rule of exclusionRules(db)) {
    const n =
      db
        .prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(rule.table)} WHERE ${rule.where}`)
        .get<{ n: number }>(paramsFor(rule.where, all))?.n ?? 0;
    if (n > 0) out[rule.table] = n;
  }
  return out;
}

export interface ExclusionReport {
  notebooks: number;
  folders: number;
  /** Rows deleted, per table. */
  rows: Record<string, number>;
}

/**
 * Delete everything tied to an excluded notebook or folder from `db`, which must be the export's
 * **snapshot**, opened on its own — never the live database. Its triggers go first: migration
 * 029's keep the chat record from being deleted, which is exactly what this copy must do.
 * `secure_delete` is on, so the rows do not survive in a free page; the export `VACUUM`s after.
 */
export function applyResearchExclusion(db: SqlDatabase): ExclusionReport {
  const scope = exclusionScope(db);
  const report: ExclusionReport = { notebooks: scope.notebooks.length, folders: scope.folders.length, rows: {} };
  if (isEmpty(scope)) return report;
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('PRAGMA secure_delete = ON');
  db.exec('BEGIN');
  try {
    const triggers = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'`).all<{ name: string }>();
    for (const t of triggers) db.exec(`DROP TRIGGER IF EXISTS ${quoteIdent(t.name)}`);
    const all = params(scope);
    for (const rule of exclusionRules(db)) {
      const n = db.prepare(`DELETE FROM ${quoteIdent(rule.table)} WHERE ${rule.where}`).run(paramsFor(rule.where, all)).changes;
      if (n > 0) report.rows[rule.table] = (report.rows[rule.table] ?? 0) + n;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return report;
}

/**
 * Add migration 032's two columns when a database lacks them although its `user_version` is
 * already past 31 — a database a build with a later migration but not this one has opened, where
 * `runMigrations` would skip 032 for good. Idempotent; a no-op on every database 032 reached.
 */
export function ensureResearchExcludeColumns(db: SqlDatabase): string[] {
  const added: string[] = [];
  for (const table of ['folders', 'notebooks']) {
    if (!listTables(db).includes(table) || hasColumn(db, table, 'research_exclude')) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN research_exclude INTEGER NOT NULL DEFAULT 0`);
    added.push(table);
  }
  return added;
}

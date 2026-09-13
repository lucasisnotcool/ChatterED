/**
 * The tiny SQL surface the repository layer uses.
 *
 * Two adapters implement it: `better-sqlite3` in the Electron main process (synchronous,
 * in-process, transactional — architecture-mac.md §A.1), and Node's built-in `node:sqlite`
 * in tests. The second exists for one reason: `better-sqlite3` is a native module rebuilt
 * against Electron's ABI by `postinstall`, so it cannot be loaded by a plain-Node test runner.
 * Both are real SQLite, so the migrations and the queries are exercised for real either way.
 */

export interface SqlRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqlStatement {
  run(params?: Record<string, unknown>): SqlRunResult;
  get<T>(params?: Record<string, unknown>): T | undefined;
  all<T>(params?: Record<string, unknown>): T[];
}

export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
}

const PRAGMAS = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA foreign_keys = ON',
  'PRAGMA busy_timeout = 5000',
];

/** better-sqlite3, for the Electron main process. */
export function openDatabase(filename: string): SqlDatabase {
  // Required lazily so that importing this module from a plain-Node test does not load the
  // Electron-ABI native binary.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite3 = require('better-sqlite3') as new (f: string) => {
    exec(sql: string): unknown;
    prepare(sql: string): {
      run(p?: unknown): SqlRunResult;
      get(p?: unknown): unknown;
      all(p?: unknown): unknown[];
    };
    close(): void;
  };
  const db = new BetterSqlite3(filename);
  const wrapped: SqlDatabase = {
    exec: (sql) => void db.exec(sql),
    prepare: (sql) => {
      const st = db.prepare(sql);
      return {
        run: (params) => (params === undefined ? st.run() : st.run(params)),
        get: <T>(params?: Record<string, unknown>) =>
          (params === undefined ? st.get() : st.get(params)) as T | undefined,
        all: <T>(params?: Record<string, unknown>) =>
          (params === undefined ? st.all() : st.all(params)) as T[],
      };
    },
    close: () => db.close(),
  };
  for (const p of PRAGMAS) wrapped.exec(p);
  return wrapped;
}

/** node:sqlite, for tests. Same SQL, same semantics, no native rebuild. */
export function openTestDatabase(filename = ':memory:'): SqlDatabase {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (f: string) => {
      exec(sql: string): void;
      prepare(sql: string): {
        run(p?: unknown): SqlRunResult;
        get(p?: unknown): unknown;
        all(p?: unknown): unknown[];
      };
      close(): void;
    };
  };
  const db = new DatabaseSync(filename);
  const wrapped: SqlDatabase = {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const st = db.prepare(sql);
      return {
        run: (params) => (params === undefined ? st.run() : st.run(params)),
        get: <T>(params?: Record<string, unknown>) =>
          (params === undefined ? st.get() : st.get(params)) as T | undefined,
        all: <T>(params?: Record<string, unknown>) =>
          (params === undefined ? st.all() : st.all(params)) as T[],
      };
    },
    close: () => db.close(),
  };
  wrapped.exec('PRAGMA foreign_keys = ON');
  if (filename !== ':memory:') wrapped.exec('PRAGMA journal_mode = WAL');
  return wrapped;
}

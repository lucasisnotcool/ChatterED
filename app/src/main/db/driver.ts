/**
 * The tiny SQL surface the repository layer uses.
 *
 * Two adapters implement it, and they are now the *same library* twice:
 *   - `better-sqlite3` in the Electron main process, rebuilt against Electron's ABI by
 *     `postinstall` (architecture-mac.md §A.1);
 *   - `better-sqlite3-node`, a devDependency alias of the identical version, left on its
 *     Node-ABI prebuild, for the plain-Node test runner.
 *
 * It used to be Node's built-in `node:sqlite` on the test side. That stopped being viable with
 * the vault full-text index (issue #22): Node 22 ships SQLite **without FTS5**
 * (`sqlite_compileoption_used('ENABLE_FTS5')` = 0, and `CREATE VIRTUAL TABLE … USING fts5`
 * fails with "no such module: fts5"), so migration 005 could not even be applied under the
 * tests, while `better-sqlite3` compiles FTS5 in (SQLite 3.53.4, `ENABLE_FTS5` = 1). Pinning
 * both sides to one library also removes the last place where a test could pass against a
 * different SQLite than the one that ships.
 *
 * `electron-builder install-app-deps` only rebuilds `dependencies`, so the devDependency alias
 * keeps its Node-ABI binary across a `postinstall` — verified, and asserted in store.test.ts.
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

interface NativeDb {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(p?: unknown): SqlRunResult;
    get(p?: unknown): unknown;
    all(p?: unknown): unknown[];
  };
  close(): void;
}

/**
 * Required lazily and by a variable specifier, so that importing this module from a plain-Node
 * test does not load the Electron-ABI binary (and vice versa).
 */
function load(specifier: string): new (f: string) => NativeDb {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(specifier) as new (f: string) => NativeDb;
}

function wrap(Ctor: new (f: string) => NativeDb, filename: string, wal: boolean): SqlDatabase {
  const db = new Ctor(filename);
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
  wrapped.exec('PRAGMA foreign_keys = ON');
  wrapped.exec('PRAGMA busy_timeout = 5000');
  if (wal) wrapped.exec('PRAGMA journal_mode = WAL');
  return wrapped;
}

/** better-sqlite3, for the Electron main process. */
export function openDatabase(filename: string): SqlDatabase {
  return wrap(load('better-sqlite3'), filename, true);
}

/** The same better-sqlite3, on its Node-ABI build, for the plain-Node test runner. */
export function openTestDatabase(filename = ':memory:'): SqlDatabase {
  return wrap(load('better-sqlite3-node'), filename, filename !== ':memory:');
}

/**
 * The Node-ABI build on a real file, WAL like the app's: for the headless tools under
 * `scripts/` (`duplicate-folder.mjs`), which run with the app quit, under plain Node.
 */
export function openNodeDatabase(filename: string): SqlDatabase {
  return wrap(load('better-sqlite3-node'), filename, true);
}

/** True when this SQLite was compiled with FTS5. Both of ours are; the vault index needs it. */
export function hasFts5(db: SqlDatabase): boolean {
  const row = db.prepare(`SELECT sqlite_compileoption_used('ENABLE_FTS5') AS used`).get<{ used: number }>();
  return (row?.used ?? 0) === 1;
}

// Imports stored "explain" comments on notes blocks into a ChatterED database (migration 033),
// headless, **with the app quit**. Each JSONL line is
//   {"doc_id": "doc_…", "block_id": "…", "text_sha": "…", "body": "…", "model": "sonnet"}
// (other fields, such as "notebook", are ignored). A line whose doc or block does not exist is
// skipped and reported; the rest are upserted on (doc_id, block_id, 'explain') in one
// transaction. text_sha is stored as given and never compared.
//
//   node app/scripts/import-comments.mjs --db <app.db> --in <comments.jsonl> [--dry-run]
//
// The database must already be at migration 033: open the app built from this branch once, quit
// it, then import. The app picks the comments up on its next launch (the notes badge, and search
// re-indexes within its 20 s sweep).
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { appDir, loadKit } from './lib/loadts.mjs';

const require = createRequire(join(appDir, 'package.json'));

function arg(name) {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}

function fail(message) {
  console.error(`import-comments: ${message}`);
  process.exit(1);
}

const dbPath = arg('--db');
const inPath = arg('--in');
const dryRun = process.argv.includes('--dry-run');
if (!dbPath || !inPath) fail('usage: node app/scripts/import-comments.mjs --db <app.db> --in <comments.jsonl> [--dry-run]');
if (!existsSync(dbPath)) fail(`no database at ${dbPath}`);
if (!existsSync(inPath)) fail(`no file at ${inPath}`);

const kit = await loadKit();
const Database = require('better-sqlite3-node');
const raw = new Database(dbPath, { fileMustExist: true });
raw.pragma('foreign_keys = ON');
raw.pragma('busy_timeout = 5000');
const version = raw.pragma('user_version', { simple: true });
const hasTable = raw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'block_comments'").get();
if (version < 33 || !hasTable) {
  raw.close();
  fail(`this database is at migration ${version}; open the app built with migration 033 once, quit it, then import`);
}

// The repository's SqlDatabase shape, over better-sqlite3 (as src/main/db/driver.ts wraps it).
const db = {
  exec: (sql) => void raw.exec(sql),
  prepare: (sql) => {
    const st = raw.prepare(sql);
    return {
      run: (p) => (p === undefined ? st.run() : st.run(p)),
      get: (p) => (p === undefined ? st.get() : st.get(p)),
      all: (p) => (p === undefined ? st.all() : st.all(p)),
    };
  },
  close: () => raw.close(),
};

const lines = kit.parseJsonl(readFileSync(inPath, 'utf8'));
const report = kit.importComments(db, lines, { now: new Date().toISOString(), dryRun });
db.close();

console.log(
  `${dryRun ? '[dry run] ' : ''}${report.lines} lines: ${report.inserted} inserted, ${report.updated} updated, ` +
    `${report.unchanged} unchanged, ${report.skipped.length} skipped`,
);
for (const s of report.skipped.slice(0, 50)) console.log(`  entry ${s.line}: ${s.reason}`);
if (report.skipped.length > 50) console.log(`  … and ${report.skipped.length - 50} more`);

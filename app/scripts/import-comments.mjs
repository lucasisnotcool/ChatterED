// Imports stored "explain" comments on notes blocks into a ChatterED database (migration 033),
// headless, **with the app quit**. Each JSONL line is
//   {"doc_id": "doc_…", "block_id": "…", "text_sha": "…", "body": "…", "model": "sonnet"}
// (other fields, such as "notebook", are ignored). A line whose doc or block does not exist is
// skipped and reported; the rest are upserted on (doc_id, block_id, 'explain') in one
// transaction. text_sha is stored as given and never compared.
//
//   node app/scripts/import-comments.mjs --db <app.db> --in <comments.jsonl> [--dry-run] [--no-backup] [--force]
//
// Like scripts/duplicate-folder.mjs: it refuses while the app has the database open, backs it up
// to <db dir>/backups/before-import-comments-<time>.db (unless --no-backup), brings the schema up
// to date with the app's own migrations, then imports. The work is the app's own code,
// `src/main/notes/importcommentscli.ts`; this file only bundles that entry with Rolldown into
// `node_modules/.cache/chattered/` (so `better-sqlite3-node` resolves from this app) and prints
// its result. The app picks the comments up on its next launch (the notes badge, and search
// re-indexes within its 20 s sweep). Exit code 0 on success, 2 when it could not run.
import { build } from 'rolldown';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(appDir, 'node_modules/.cache/chattered');
const outFile = resolve(outDir, 'import-comments-cli.cjs');

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
  console.log(`usage: node scripts/import-comments.mjs --db <path to app.db> --in <comments.jsonl>
         [--dry-run] [--no-backup] [--force]

Quit ChatterED first. The database is backed up to <db dir>/backups/before-import-comments-<time>.db
unless --no-backup, and migrated to this build's schema. --dry-run writes nothing to it.`);
  process.exit(argv.length === 0 ? 2 : 0);
}

try {
  mkdirSync(outDir, { recursive: true });
  await build({
    input: resolve(appDir, 'src/main/notes/importcommentscli.ts'),
    platform: 'node',
    // Native and Node built-ins stay `require`s; everything of ours is inlined.
    external: [/^better-sqlite3/, /^node:/],
    output: { file: outFile, format: 'cjs', sourcemap: false },
    logLevel: 'warn',
  });
  const require = createRequire(outFile);
  const cli = require(outFile);
  const { db, dryRun, backup, schema, report } = cli.runImportCommentsCli(argv, {
    migrationsDir: resolve(appDir, 'src/main/db/migrations'),
  });
  console.log(`database ${db}`);
  if (backup) console.log(`backup   ${backup}`);
  console.log(
    `schema   ${schema.from} -> ${schema.to}${dryRun && schema.from !== schema.to ? ' (on a scratch copy: dry run)' : ''}` +
      (schema.added.length > 0 ? `, added ${schema.added.join(', ')}` : ''),
  );
  console.log(
    `${dryRun ? '[dry run] ' : ''}${report.lines} lines: ${report.inserted} inserted, ${report.updated} updated, ` +
      `${report.unchanged} unchanged, ${report.skipped.length} skipped`,
  );
  for (const s of report.skipped.slice(0, 50)) console.log(`  entry ${s.line}: ${s.reason}`);
  if (report.skipped.length > 50) console.log(`  … and ${report.skipped.length - 50} more`);
} catch (err) {
  console.error(`import-comments: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

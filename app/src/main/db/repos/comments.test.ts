import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase, type SqlDatabase } from '../driver.js';
import { runMigrations } from '../migrations.js';
import { commentsRepo, importComments, parseJsonl } from './comments.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
const T0 = '2026-10-07T00:00:00.000Z';
const T1 = '2026-10-07T01:00:00.000Z';

const DOC = JSON.stringify({
  type: 'doc',
  content: [
    { type: 'paragraph', attrs: { blockId: 'b_p', pages: [3] }, content: [{ type: 'text', text: 'Admissible heuristics.' }] },
    {
      type: 'bullet_list',
      attrs: { blockId: 'b_list', pages: [4] },
      content: [{ type: 'list_item', attrs: { blockId: 'b_li' }, content: [{ type: 'paragraph', attrs: { blockId: '' }, content: [{ type: 'text', text: 'one' }] }] }],
    },
  ],
});

let db: SqlDatabase;

function addDoc(id: string, notebookId: string): void {
  db.prepare(
    `INSERT INTO notes_docs (id, content_sha, title, doc_json, ingest_status, ingest_version, created_at, updated_at)
     VALUES (@id, @k, 'T', @doc, 'ready', 1, @t, @t)`,
  ).run({ id, k: `nb:${notebookId}`, doc: DOC, t: T0 });
}

const line = (o: Record<string, unknown>) => ({ doc_id: 'doc_a', block_id: 'b_p', text_sha: 'abc', body: 'Because $h(s) \\le h^*(s)$.', model: 'sonnet', ...o });

beforeEach(() => {
  db = openTestDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  addDoc('doc_a', 'nb_a');
});

describe('block comments', () => {
  it('imports, lists by doc and by notebook, and keeps created_at on an update', () => {
    const r = importComments(db, [line({}), line({ block_id: 'b_li', body: 'A list item.', notebook: 'ignored' })], { now: T0 });
    expect(r).toMatchObject({ lines: 2, inserted: 2, updated: 0, unchanged: 0, skipped: [] });
    const repo = commentsRepo(db);
    expect(repo.forDoc('doc_a').map((c) => c.blockId)).toEqual(['b_li', 'b_p']);
    expect(repo.forNotebook('nb_a')[1]).toEqual({ blockId: 'b_p', kind: 'explain', body: 'Because $h(s) \\le h^*(s)$.', model: 'sonnet', updatedAt: T0 });
    const sig0 = repo.signature('nb_a');

    const again = importComments(db, [line({}), line({ body: 'Changed.' })], { now: T1 });
    // The later line for the same block wins; the earlier is not counted separately.
    expect(again).toMatchObject({ inserted: 0, updated: 1, unchanged: 0 });
    const row = db.prepare("SELECT created_at, updated_at, body FROM block_comments WHERE block_id = 'b_p'").get<Record<string, string>>();
    expect(row).toEqual({ created_at: T0, updated_at: T1, body: 'Changed.' });
    expect(repo.signature('nb_a')).not.toBe(sig0);

    expect(importComments(db, [line({ body: 'Changed.' })], { now: T1 }).unchanged).toBe(1);
  });

  it('skips lines with a missing field, an unknown doc or a block not in the doc, and writes nothing on a dry run', () => {
    const r = importComments(
      db,
      [null, line({ doc_id: '' }), line({ body: '  ' }), line({ doc_id: 'doc_zz' }), line({ block_id: 'b_gone' }), line({})],
      { now: T0, dryRun: true },
    );
    expect(r.skipped.map((s) => s.line)).toEqual([1, 2, 3, 4, 5]);
    expect(r.skipped[4]!.reason).toContain('b_gone');
    expect(r.inserted).toBe(1);
    expect(commentsRepo(db).forDoc('doc_a')).toEqual([]);
  });

  it('goes with its doc', () => {
    importComments(db, [line({})], { now: T0 });
    db.prepare("DELETE FROM notes_docs WHERE id = 'doc_a'").run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM block_comments').get<{ n: number }>()!.n).toBe(0);
  });

  it('parses JSONL, a bad line becoming null', () => {
    expect(parseJsonl('{"a":1}\n\nnot json\r\n{"b":2}\n')).toEqual([{ a: 1 }, null, { b: 2 }]);
  });
});

/**
 * The one-time legacy import (`notebooks.md` §1, "existing work is kept"), against a seeded,
 * migrated database: a folder vault with two files that have notes docs (one of them missing
 * on disk), one that was only browsed, and the rows a real learner would have — an older doc
 * on other bytes, outcomes, a tree, states, a room and its material, cost rows.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase, type SqlDatabase } from '../db/driver.js';
import { runMigrations } from '../db/migrations.js';
import { createStore, type LocalStore } from '../db/store.js';
import { createSession } from '../sessions.js';
import { PINNED_PAIRING } from '../../room/agents.js';
import { ensureManagedVault } from '../vault/managed.js';
import { notebookContentKey } from '../../shared/notebook.js';
import { NotebookService } from './service.js';
import { importLegacyNotebooks, LEGACY_IMPORT_SETTING } from './legacy.js';
import { TWO_PAGE_PDF } from './fixtures.test-support.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations', import.meta.url));
const T = '2026-09-30T10:00:00.000Z';

let tmp = '';
let vaultRoot = '';
let db: SqlDatabase;
let store: LocalStore;
let service: NotebookService;

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

function seedFile(id: string, rel: string, body: Buffer | null): void {
  if (body) {
    mkdirSync(join(vaultRoot, rel, '..'), { recursive: true });
    writeFileSync(join(vaultRoot, rel), body);
  }
  db.prepare(
    `INSERT INTO files (id, vault_id, rel_path, name, ext, kind, size, mtime_ms, sha256)
     VALUES (@id, 'vault_old', @rel, @name, 'pdf', 'pdf', 1, 1, @sha)`,
  ).run({ id, rel, name: rel.split('/').pop()!, sha: body ? sha(body) : 'gone' });
}

function seedDoc(id: string, fileId: string, contentSha: string, updatedAt: string, title = 'Planning'): void {
  db.prepare(
    `INSERT INTO notes_docs (id, content_sha, file_id, title, page_count, doc_json, ingest_status, ingest_version, created_at, updated_at)
     VALUES (@id, @sha, @f, @title, 2, '{"type":"doc"}', 'ready', 1, @t, @u)`,
  ).run({ id, sha: contentSha, f: fileId, title, t: T, u: updatedAt });
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'chattered-legacy-'));
  vaultRoot = join(tmp, 'Study');
  mkdirSync(vaultRoot);
  db = openTestDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  store = createStore(db);
  db.prepare(
    "INSERT INTO vaults (id, root_path, display_name, created_at) VALUES ('vault_old', @r, 'Study', @t)",
  ).run({ r: vaultRoot, t: T });
  const root = join(tmp, 'userData', 'notebooks');
  ensureManagedVault(db, root, T);
  service = new NotebookService({ db, root });
});

afterEach(() => {
  service.dispose();
  rmSync(tmp, { recursive: true, force: true });
});

describe('importLegacyNotebooks', () => {
  it('makes a notebook of one source per file with a notes doc, and re-keys its rows', async () => {
    const pdf = Buffer.from(TWO_PAGE_PDF, 'latin1');
    const pdfSha = sha(pdf);
    seedFile('f_lecture', 'CS4246/Lecture 4.pdf', pdf);
    seedFile('f_browsed', 'CS4246/Only browsed.pdf', Buffer.from('x'));
    // The newest doc for the file, on its current bytes, and an older one on bytes it no longer has.
    seedDoc('doc_new', 'f_lecture', pdfSha, '2026-09-30T12:00:00.000Z');
    seedDoc('doc_old', 'f_lecture', 'oldbytes', '2026-09-20T12:00:00.000Z');
    db.prepare(
      `INSERT INTO quiz_outcomes (id, content_sha, room_id, objective_id, question_id, kind, verdict, created_at)
       VALUES ('q1', @s, 'room_x', 'o1', 'qq', 'verdict', 'complete', @t), ('q2', 'oldbytes', 'room_y', 'o1', 'qq', 'verdict', 'partial', @t)`,
    ).run({ s: pdfSha, t: T });
    db.prepare(
      `INSERT INTO learning_trees (file_id, content_sha, prompt_version, model, status, json, created_at, updated_at)
       VALUES ('f_lecture', @s, 1, 'm', 'ready', '[]', @t, @t)`,
    ).run({ s: pdfSha, t: T });
    db.prepare(
      "INSERT INTO learning_objective_states (objective_id, file_id, level) VALUES ('o1', 'f_lecture', 2)",
    ).run();
    db.prepare(
      `INSERT INTO llm_usage (id, created_at, backend, model, scope, file_id, input_tokens, output_tokens)
       VALUES ('u1', @t, 'cli', 'sonnet', 'notes', 'f_lecture', 1, 1)`,
    ).run({ t: T });
    const room = createSession(
      { store, pairing: PINNED_PAIRING, appVersion: 't', osVersion: 't', mode: 'scripted' },
      { moduleCode: '', title: 'Planning', text: 'deck', sourceKind: 'pdf_pages', pageFrom: 1, pageTo: 2, fileName: 'Lecture 4.pdf', fileId: 'f_lecture', fileSha: pdfSha },
    );

    const report = importLegacyNotebooks({ db, service });
    expect(report).toMatchObject({ ran: true, failed: 0 });
    expect(report.imported).toHaveLength(1);
    const { notebookId, copied } = report.imported[0]!;
    const key = notebookContentKey(notebookId);
    expect(copied).toBe(true);

    const nb = db.prepare('SELECT * FROM notebooks WHERE id = @id').get<{ name: string; legacy_file_id: string }>({ id: notebookId })!;
    expect(nb).toMatchObject({ name: 'Lecture 4', legacy_file_id: 'f_lecture' });

    // The doc is kept unchanged, under the notebook's key; the older doc is left alone.
    const doc = db.prepare("SELECT * FROM notes_docs WHERE id = 'doc_new'").get<{ content_sha: string; file_id: string; doc_json: string }>()!;
    expect(doc).toMatchObject({ content_sha: key, file_id: notebookId, doc_json: '{"type":"doc"}' });
    expect(db.prepare("SELECT content_sha FROM notes_docs WHERE id = 'doc_old'").get<{ content_sha: string }>()!.content_sha).toBe('oldbytes');

    expect(db.prepare("SELECT content_sha FROM quiz_outcomes WHERE id = 'q1'").get<{ content_sha: string }>()!.content_sha).toBe(key);
    expect(db.prepare("SELECT content_sha FROM quiz_outcomes WHERE id = 'q2'").get<{ content_sha: string }>()!.content_sha).toBe('oldbytes');
    expect(db.prepare('SELECT file_id, content_sha FROM learning_trees').get()).toEqual({ file_id: notebookId, content_sha: key });
    expect(db.prepare('SELECT file_id, level FROM learning_objective_states').get()).toEqual({ file_id: notebookId, level: 2 });
    expect(db.prepare("SELECT file_id FROM llm_usage WHERE id = 'u1'").get()).toEqual({ file_id: notebookId });
    // The room continues: its material is found by the notebook's key.
    expect(store.materials.forFile(notebookId, key)?.id).toBe(room.materialId);

    // The file was copied in as the only source, at base 0, and reads to ready.
    service.resumeReading();
    await service.whenIdle();
    const view = service.get(notebookId)!;
    expect(view.sources).toHaveLength(1);
    expect(view.sources[0]).toMatchObject({ name: 'Lecture 4.pdf', pageBase: 0, pageCount: 2, status: 'ready' });
    // The vault folder is never modified.
    expect(readdirSync(join(vaultRoot, 'CS4246')).sort()).toEqual(['Lecture 4.pdf', 'Only browsed.pdf']);
  });

  it('makes a notebook with no sources when the file is gone, and says so', () => {
    seedFile('f_gone', 'Gone.pdf', null);
    seedDoc('doc_g', 'f_gone', 'gonebytes', T, 'Gone deck');
    // A doc whose file row is gone altogether is named after its title.
    seedDoc('doc_orphan', 'f_nofile', 'orphanbytes', T, 'Orphan notes');
    const report = importLegacyNotebooks({ db, service });
    expect(report.imported.map((i) => i.copied)).toEqual([false, false]);
    const names = db.prepare('SELECT name FROM notebooks ORDER BY name').all<{ name: string }>().map((r) => r.name);
    expect(names).toEqual(['Gone', 'Orphan notes']);
    for (const i of report.imported) expect(service.get(i.notebookId)!.sources).toEqual([]);
    expect(existsSync(join(service.root))).toBe(false);
  });

  it('runs once, and never imports a file twice even when forced', () => {
    const pdf = Buffer.from(TWO_PAGE_PDF, 'latin1');
    seedFile('f_a', 'a.pdf', pdf);
    seedDoc('doc_a', 'f_a', sha(pdf), T);
    expect(importLegacyNotebooks({ db, service }).imported).toHaveLength(1);
    expect(db.prepare('SELECT value FROM settings WHERE key = @k').get({ k: LEGACY_IMPORT_SETTING })).toEqual({ value: '1' });
    expect(importLegacyNotebooks({ db, service })).toEqual({ ran: false, imported: [], failed: 0 });
    expect(importLegacyNotebooks({ db, service, force: true }).imported).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM notebooks').get()).toEqual({ n: 1 });
  });

  it('rolls one notebook back on a failure and leaves the flag unset so it retries', () => {
    const pdf = Buffer.from(TWO_PAGE_PDF, 'latin1');
    seedFile('f_a', 'a.pdf', pdf);
    seedDoc('doc_a', 'f_a', sha(pdf), T);
    // Break the re-key: a trigger that refuses the doc's update.
    db.exec(
      "CREATE TRIGGER no_rekey BEFORE UPDATE OF content_sha ON notes_docs BEGIN SELECT RAISE(ABORT, 'nope'); END",
    );
    const report = importLegacyNotebooks({ db, service });
    expect(report).toMatchObject({ ran: true, failed: 1, imported: [] });
    expect(db.prepare('SELECT COUNT(*) AS n FROM notebooks').get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM files WHERE vault_id = 'vault_notebooks'").get()).toEqual({ n: 0 });
    expect(existsSync(service.root) ? readdirSync(service.root) : []).toEqual([]);
    expect(db.prepare('SELECT value FROM settings WHERE key = @k').get({ k: LEGACY_IMPORT_SETTING })).toBeUndefined();
    db.exec('DROP TRIGGER no_rekey');
    expect(importLegacyNotebooks({ db, service }).imported).toHaveLength(1);
  });
});

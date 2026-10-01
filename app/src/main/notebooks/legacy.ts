/**
 * **The one-time legacy import: existing work is kept** (`docs/research/notebooks.md` §1).
 *
 * > On first launch after this change, each file that already has a notes doc becomes a notebook
 * > of one source (the file is copied in), and its existing notes doc is kept unchanged as that
 * > notebook's doc. Files on disk that were only browsed are not imported. The vault folder
 * > itself is never modified.
 *
 * For each folder-vault file with a notes doc (the most recently updated doc per `file_id`, when
 * the file was opened at more than one version of its bytes):
 *
 *  1. the file is **copied** into the managed vault as the notebook's only source, at page base
 *     0, so notebook page N is the file's page N and every page the doc already cites still means
 *     what it meant. If the file is gone from disk the notebook is made with no sources, and the
 *     log says so: the doc is still the learner's, and they can add the file back;
 *  2. in one transaction with the notebook's rows, everything keyed on the file is **re-keyed**
 *     to the notebook (contract C2): the doc (`content_sha` → `nb:<id>`, `file_id` → the
 *     notebook), the quiz outcomes on its bytes, the objective tree and the learner's states,
 *     the room's material (`file_id`, and `file_sha256` → the key, so `materials.forFile` finds
 *     it and the room and the chat continue), and the cost rows filed under the file.
 *
 * The tree's `content_sha` is re-keyed only when it was the doc's bytes; a tree for other bytes
 * is moved with its states but stays stale, for the overview to replace. Page images under
 * `<userData>/notes-pages/<sha>/` are left where they are (the overview track's concern).
 *
 * **Idempotent** twice over: a settings flag stops it once it has run clean, and a file that is
 * already a notebook's `legacy_file_id` is never imported again, so a run that failed half way
 * re-runs only what is missing. Each notebook is its own transaction, and a failure rolls back
 * that notebook (and deletes its copy) without touching the others.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { SqlDatabase } from '../db/driver.js';
import { log } from '../log.js';
import { MANAGED_VAULT_ID } from '../vault/managed.js';
import { newVaultId } from '../vault/repo.js';
import { notebookContentKey } from '../../shared/notebook.js';
import { fileKindFor, inSavepoint, nameFromPath, newNotebookId, safeFileName, type NotebookService } from './service.js';

export const LEGACY_IMPORT_SETTING = 'notebooks_legacy_import_v1';

interface LegacyDoc {
  id: string;
  file_id: string;
  content_sha: string;
  title: string;
  updated_at: string;
}

interface LegacyFile {
  id: string;
  name: string;
  rel_path: string;
  root_path: string;
}

export interface LegacyImported {
  notebookId: string;
  legacyFileId: string;
  docId: string;
  /** False when the file was missing on disk: the notebook has no sources. */
  copied: boolean;
}

export interface LegacyImportReport {
  ran: boolean;
  imported: LegacyImported[];
  failed: number;
}

/** The docs to import: the newest per folder-vault file that is not already a notebook. */
export function legacyCandidates(db: SqlDatabase): LegacyDoc[] {
  const rows = db
    .prepare(
      `SELECT id, file_id, content_sha, title, updated_at FROM notes_docs
        WHERE file_id IS NOT NULL
          AND content_sha NOT LIKE 'nb:%'
          AND substr(file_id, 1, 3) <> 'nb_'
          AND file_id NOT IN (SELECT legacy_file_id FROM notebooks WHERE legacy_file_id IS NOT NULL)
        ORDER BY updated_at DESC, id`,
    )
    .all<LegacyDoc>();
  const seen = new Set<string>();
  const out: LegacyDoc[] = [];
  for (const r of rows) {
    if (seen.has(r.file_id)) continue;
    seen.add(r.file_id);
    out.push({ ...r });
  }
  return out;
}

export function importLegacyNotebooks(deps: {
  db: SqlDatabase;
  service: NotebookService;
  now?: () => string;
  /** Run even when the flag says it already has (tests). */
  force?: boolean;
}): LegacyImportReport {
  const { db, service } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const flag = db.prepare('SELECT value FROM settings WHERE key = @k').get<{ value: string }>({ k: LEGACY_IMPORT_SETTING });
  if (flag?.value === '1' && !deps.force) return { ran: false, imported: [], failed: 0 };

  const imported: LegacyImported[] = [];
  let failed = 0;
  for (const doc of legacyCandidates(db)) {
    try {
      imported.push(importOne(db, service, doc));
    } catch (err) {
      failed += 1;
      log().error('notebook.legacy_import_failed', {
        file_id: doc.file_id,
        doc_id: doc.id,
        cause: (err as Error).message.slice(0, 300),
      });
    }
  }
  if (failed === 0) {
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (@k, '1', @t)
         ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = @t`,
    ).run({ k: LEGACY_IMPORT_SETTING, t: now() });
  }
  log().info('notebook.legacy_import', { imported: imported.length, failed, without_source: imported.filter((i) => !i.copied).length });
  return { ran: true, imported, failed };
}

function importOne(db: SqlDatabase, service: NotebookService, doc: LegacyDoc): LegacyImported {
  const file = db
    .prepare(
      `SELECT f.id, f.name, f.rel_path, v.root_path FROM files f JOIN vaults v ON v.id = f.vault_id
        WHERE f.id = @f AND f.vault_id <> @m`,
    )
    .get<LegacyFile>({ f: doc.file_id, m: MANAGED_VAULT_ID });
  const notebookId = newNotebookId();
  const key = notebookContentKey(notebookId);
  const name = file ? nameFromPath(file.name) : doc.title.trim() || 'Imported notes';

  // The copy, before the transaction (a file copy cannot roll back); undone if the rows fail.
  let copy: { fileId: string; copyName: string; path: string; sha: string; size: number; mtimeMs: number } | null = null;
  const kind = file ? fileKindFor(file.name) : null;
  if (file && kind) {
    const abs = join(file.root_path, ...file.rel_path.split('/'));
    if (existsSync(abs) && statSync(abs).isFile()) {
      const fileId = newVaultId('f');
      const dir = join(service.root, notebookId);
      mkdirSync(dir, { recursive: true });
      const copyName = `${fileId}-${safeFileName(file.name)}`;
      const path = join(dir, copyName);
      copyFileSync(abs, path);
      const st = statSync(path);
      const sha = createHash('sha256').update(readFileSync(path)).digest('hex');
      copy = { fileId, copyName, path, sha, size: st.size, mtimeMs: Math.round(st.mtimeMs) };
    }
  }

  try {
    inSavepoint(db, () => {
      service.createRow({ id: notebookId, name, legacyFileId: doc.file_id, updatedAt: doc.updated_at });
      if (copy && file && kind) {
        service.insertCopiedSource({
          notebookId,
          fileId: copy.fileId,
          name: file.name,
          kind,
          sha: copy.sha,
          size: copy.size,
          mtimeMs: copy.mtimeMs,
          copyName: copy.copyName,
          pageBase: 0,
        });
      }
      const p = { nb: notebookId, key, doc: doc.id, old_file: doc.file_id, old_sha: doc.content_sha };
      db.prepare('UPDATE notes_docs SET content_sha = @key, file_id = @nb WHERE id = @doc').run(p);
      db.prepare('UPDATE quiz_outcomes SET content_sha = @key WHERE content_sha = @old_sha').run(p);
      db.prepare(
        `UPDATE learning_trees
            SET file_id = @nb,
                content_sha = CASE WHEN content_sha = @old_sha THEN @key ELSE content_sha END
          WHERE file_id = @old_file`,
      ).run(p);
      db.prepare('UPDATE learning_objective_states SET file_id = @nb WHERE file_id = @old_file').run(p);
      db.prepare(
        'UPDATE materials SET file_id = @nb, file_sha256 = @key WHERE file_id = @old_file AND file_sha256 = @old_sha',
      ).run(p);
      db.prepare('UPDATE llm_usage SET file_id = @nb WHERE file_id = @old_file').run(p);
    });
  } catch (err) {
    if (copy) rmSync(join(service.root, notebookId), { recursive: true, force: true });
    throw err;
  }

  log().info('notebook.legacy_imported', {
    notebook_id: notebookId,
    file_id: doc.file_id,
    doc_id: doc.id,
    copied: copy !== null,
    // The file's bytes changed after the doc was written: the doc is kept, and cites the old pages.
    stale_bytes: copy !== null && copy.sha !== doc.content_sha,
    ...(file ? {} : { reason: 'no_file_row' }),
    ...(file && !copy ? { reason: kind ? 'missing_on_disk' : 'unsupported_kind' } : {}),
  });
  return { notebookId, legacyFileId: doc.file_id, docId: doc.id, copied: copy !== null };
}

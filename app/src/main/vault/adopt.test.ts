/**
 * Issue #39: a re-minted `files.id` adopts its orphaned predecessor's room, tree and progress.
 *
 * Against a real migrated SQLite, because what is being tested is exactly which rows of which
 * tables move under which ids — a mock would be a test of my own reading of the schema.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SqlDatabase } from '../db/driver.js';
import { objectivesRepo } from '../db/repos/objectives.js';
import type { LocalStore } from '../db/store.js';
import { openTestDb } from '../../test-support/db.js';
import { adoptOrphanedFileRows } from './adopt.js';
import { createVaultRepo, type VaultRepo } from './repo.js';
import type { ScannedFile } from './scan.js';
import { SegmentService } from './segments.js';

const SHA = 'a'.repeat(64);
const T0 = '2026-09-20T10:00:00.000Z';
const T1 = '2026-09-21T10:00:00.000Z';

function deck(relPath: string, over: Partial<ScannedFile> = {}): ScannedFile {
  const name = relPath.split('/').pop()!;
  return { relPath, name, ext: 'pdf', kind: 'pdf', size: 1000, mtimeMs: 1_700_000_000_000, ...over };
}

function setup() {
  const { db, store } = openTestDb();
  const repo = createVaultRepo(db);
  const vault = (id: string, root: string) =>
    repo.vaults.insert({ id, root_path: root, display_name: root, created_at: T0, last_scan_at: null });
  return { db, store, repo, vault };
}

function sync(repo: VaultRepo, vaultId: string, files: ScannedFile[]) {
  return repo.files.sync(vaultId, files, () => null, T0);
}

function idAt(repo: VaultRepo, vaultId: string, relPath: string): string {
  return repo.files.byRelPath(vaultId, relPath)!.id;
}

function indexed(repo: VaultRepo, id: string, sha = SHA): void {
  repo.files.markIndexed(id, { at: T1, size: 1000, mtimeMs: 1_700_000_000_000, pageCount: 3, sha256: sha });
}

/** A room's material, as `openOrCreateFlowRoom` writes it: keyed on (file_id, file_sha256). */
function material(store: LocalStore, id: string, fileId: string, sha = SHA): void {
  store.materials.insert({
    id,
    module_code: 'CS3249',
    title: 'Lecture 4',
    source_kind: 'pdf_pages',
    file_path: 'Lecture 4.pdf',
    file_id: fileId,
    file_sha256: sha,
    file_mtime: null,
    page_from: 1,
    page_to: 3,
    page_count: 3,
    extracted_text: 'text',
    extract_engine: 'pdfjs',
    padding_text: '',
    topic_context: '',
    outline: '',
    concept_pack: '{}',
    pack_provenance: 'pending',
    pack_confirmed_at: null,
    token_count: 0,
    cache_eligible: 0,
    prefix_sha256: 'p',
    created_at: T0,
  });
}

function tree(db: SqlDatabase, fileId: string, model: string, sha = SHA, now = T0): void {
  objectivesRepo(db).upsertTree(
    { fileId, contentSha: sha, promptVersion: 1, model, status: 'ready', generatedAt: now, error: null, objectives: [] },
    now,
  );
}

function usage(db: SqlDatabase, id: string, fileId: string): void {
  db.prepare(
    `INSERT INTO llm_usage (id, created_at, file_id, scope, model, backend)
     VALUES (@id, @t, @f, 'deck', 'sonnet', 'cli')`,
  ).run({ id, t: T0, f: fileId });
}

const count = (db: SqlDatabase, sql: string, p: Record<string, unknown>) =>
  db.prepare(sql).get<{ n: number }>(p)!.n;

describe('fix B: a rename or a move keeps the id', () => {
  it('pairs a vanished row with a new path of the same size, mtime and extension', () => {
    const { repo, vault } = setup();
    vault('v1', '/vault');
    sync(repo, 'v1', [deck('CS3249/Lecture 4.pdf')]);
    const before = idAt(repo, 'v1', 'CS3249/Lecture 4.pdf');

    // Moved to another folder, and its case changed on the way.
    const counts = sync(repo, 'v1', [deck('Archive/lecture 4.pdf')]);
    expect(counts).toMatchObject({ added: 0, removed: 0, moved: 1 });
    const after = repo.files.byRelPath('v1', 'Archive/lecture 4.pdf')!;
    expect(after.id).toBe(before);
    expect(after.name).toBe('lecture 4.pdf');
    expect(repo.files.byRelPath('v1', 'CS3249/Lecture 4.pdf')).toBeUndefined();
  });

  it('pairs nothing when the match is not one-to-one', () => {
    const { repo, vault } = setup();
    vault('v1', '/vault');
    sync(repo, 'v1', [deck('a/Deck.pdf')]);
    const old = idAt(repo, 'v1', 'a/Deck.pdf');
    // Two identical new copies: which one is the move is not knowable.
    const counts = sync(repo, 'v1', [deck('b/Deck.pdf'), deck('c/Deck.pdf')]);
    expect(counts).toMatchObject({ added: 2, removed: 1, moved: 0 });
    expect(idAt(repo, 'v1', 'b/Deck.pdf')).not.toBe(old);
    expect(idAt(repo, 'v1', 'c/Deck.pdf')).not.toBe(old);
  });
});

describe('fix A: a re-minted id adopts its orphaned predecessor', () => {
  it('a rename the scan could not pair keeps the room, the tree and the progress', () => {
    const { db, store, repo, vault } = setup();
    vault('v1', '/vault');
    sync(repo, 'v1', [deck('Lecture 4.pdf')]);
    const old = idAt(repo, 'v1', 'Lecture 4.pdf');
    indexed(repo, old);
    material(store, 'mat_1', old);
    tree(db, old, 'orphan-tree');
    const objectives = objectivesRepo(db);
    objectives.setLevel({ fileId: old, objectiveId: 'obj_1', level: 2, movedAt: T0, evidenceMessageIds: ['m_1'] });
    objectives.markTaught({ fileId: old, objectiveId: 'obj_2', at: T0 });
    usage(db, 'u_1', old);

    // Renamed *and* touched (an atomic save), so size/mtime pairing cannot see it.
    sync(repo, 'v1', [deck('Lecture 4 (annotated).pdf', { mtimeMs: 1_800_000_000_000 })]);
    const fresh = idAt(repo, 'v1', 'Lecture 4 (annotated).pdf');
    expect(fresh).not.toBe(old);
    expect(store.materials.forFile(fresh, SHA)).toBeUndefined();

    indexed(repo, fresh);

    expect(store.materials.forFile(fresh, SHA)?.id).toBe('mat_1');
    expect(objectives.tree(fresh)?.model).toBe('orphan-tree');
    expect(objectives.tree(old)).toBeNull();
    expect(objectives.state(fresh, 'obj_1')).toMatchObject({ level: 2 });
    expect(objectives.state(fresh, 'obj_2')?.taughtAt).toBe(T0);
    expect(objectives.states(old)).toEqual([]);
    expect(count(db, 'SELECT COUNT(*) AS n FROM llm_usage WHERE file_id = @f', { f: fresh })).toBe(1);
  });

  it('a vault reopened under a different root string adopts the old vault’s rows', () => {
    const { db, store, repo, vault } = setup();
    vault('v1', '/Users/me/NUS');
    sync(repo, 'v1', [deck('CS3249/Lecture 4.pdf')]);
    const old = idAt(repo, 'v1', 'CS3249/Lecture 4.pdf');
    indexed(repo, old);
    material(store, 'mat_1', old);
    tree(db, old, 'orphan-tree');
    objectivesRepo(db).setLevel({ fileId: old, objectiveId: 'obj_1', level: 3, movedAt: T0 });

    // Same folder, another spelling: `vaults.byPath` misses and every file is new.
    vault('v2', '/Users/me/NUS/');
    sync(repo, 'v2', [deck('CS3249/Lecture 4.pdf')]);
    const fresh = idAt(repo, 'v2', 'CS3249/Lecture 4.pdf');
    // The old row is still in `files`, under the other vault — not deleted, yet an orphan here.
    expect(repo.files.get(old)).toBeDefined();

    indexed(repo, fresh);

    expect(store.materials.forFile(fresh, SHA)?.id).toBe('mat_1');
    expect(objectivesRepo(db).tree(fresh)?.model).toBe('orphan-tree');
    expect(objectivesRepo(db).state(fresh, 'obj_1')?.level).toBe(3);
  });

  it('two live copies of one deck are never merged', () => {
    const { db, store, repo, vault } = setup();
    vault('v1', '/vault');
    sync(repo, 'v1', [deck('CS3249/Lecture 4.pdf'), deck('Revision/Lecture 4.pdf', { mtimeMs: 1 })]);
    const a = idAt(repo, 'v1', 'CS3249/Lecture 4.pdf');
    const b = idAt(repo, 'v1', 'Revision/Lecture 4.pdf');
    indexed(repo, a);
    material(store, 'mat_a', a);
    tree(db, a, 'tree-a');
    objectivesRepo(db).setLevel({ fileId: a, objectiveId: 'obj_1', level: 2, movedAt: T0 });

    indexed(repo, b);

    expect(store.materials.forFile(a, SHA)?.id).toBe('mat_a');
    expect(store.materials.forFile(b, SHA)).toBeUndefined();
    expect(objectivesRepo(db).tree(b)).toBeNull();
    expect(objectivesRepo(db).states(b)).toEqual([]);
    expect(objectivesRepo(db).tree(a)?.model).toBe('tree-a');
  });

  it('an orphan with two known live copies of its bytes is left alone', () => {
    const { db, store, repo, vault } = setup();
    vault('v1', '/vault');
    sync(repo, 'v1', [deck('old/Lecture 4.pdf')]);
    const old = idAt(repo, 'v1', 'old/Lecture 4.pdf');
    material(store, 'mat_old', old);
    sync(repo, 'v1', [deck('x/Lecture 4.pdf', { mtimeMs: 1 }), deck('y/Lecture 4.pdf', { mtimeMs: 2 })]);
    const x = idAt(repo, 'v1', 'x/Lecture 4.pdf');
    const y = idAt(repo, 'v1', 'y/Lecture 4.pdf');
    // y's bytes are already known when x's become known: which one `old` was is not knowable.
    db.prepare('UPDATE files SET sha256 = @s WHERE id = @y').run({ s: SHA, y });
    indexed(repo, x);
    expect(store.materials.get('mat_old')?.file_id).toBe(old);
    expect(adoptOrphanedFileRows(db, y, SHA).from).toEqual([]);
    expect(store.materials.get('mat_old')?.file_id).toBe(old);
  });

  it('nothing orphaned is a no-op', () => {
    const { db, store, repo, vault } = setup();
    vault('v1', '/vault');
    sync(repo, 'v1', [deck('Lecture 4.pdf')]);
    const id = idAt(repo, 'v1', 'Lecture 4.pdf');
    material(store, 'mat_1', id);
    tree(db, id, 'own');
    indexed(repo, id);

    const result = adoptOrphanedFileRows(db, id, SHA);
    expect(result).toEqual({ from: [], materials: 0, usage: 0, tree: 'none', states: 0 });
    expect(store.materials.get('mat_1')?.file_id).toBe(id);
    expect(objectivesRepo(db).tree(id)?.model).toBe('own');
    // An id that is not a vault file at all (the segments tests' 'file_1') is also a no-op.
    expect(adoptOrphanedFileRows(db, 'file_1', SHA).from).toEqual([]);
    // And a second adoption after a real one finds nothing left to take.
    expect(adoptOrphanedFileRows(db, id, SHA).from).toEqual([]);
  });

  it('leaves rows of other bytes, and rows of other ids, where they are', () => {
    const { store, repo, vault } = setup();
    vault('v1', '/vault');
    sync(repo, 'v1', [deck('Lecture 4.pdf')]);
    const id = idAt(repo, 'v1', 'Lecture 4.pdf');
    material(store, 'mat_other', 'f_gone_elsewhere', 'b'.repeat(64));
    indexed(repo, id);
    expect(store.materials.get('mat_other')?.file_id).toBe('f_gone_elsewhere');
  });
});

describe('fix A: a tree collision on the new id', () => {
  function collided(newHasProgress: boolean) {
    const ctx = setup();
    const { db, repo, vault } = ctx;
    vault('v1', '/vault');
    sync(repo, 'v1', [deck('a/Lecture 4.pdf')]);
    const old = idAt(repo, 'v1', 'a/Lecture 4.pdf');
    tree(db, old, 'orphan-tree');
    const o = objectivesRepo(db);
    o.setLevel({ fileId: old, objectiveId: 'obj_1', level: 1, movedAt: T0, evidenceMessageIds: ['m_1'] });
    o.setLevel({ fileId: old, objectiveId: 'obj_2', level: 3, movedAt: T0, evidenceMessageIds: ['m_2'] });

    sync(repo, 'v1', [deck('b/Lecture 4.pdf', { mtimeMs: 5 })]);
    const fresh = idAt(repo, 'v1', 'b/Lecture 4.pdf');
    // The open raced the indexer before this fix: a second tree was generated for the new id.
    tree(db, fresh, 'fresh-tree', SHA, T1);
    if (newHasProgress) {
      o.setLevel({ fileId: fresh, objectiveId: 'obj_1', level: 2, movedAt: T1, evidenceMessageIds: ['m_9'] });
    }
    indexed(repo, fresh);
    return { ...ctx, o, old, fresh };
  }

  it('the orphan’s tree wins when the new id has no progress of its own', () => {
    const { o, old, fresh } = collided(false);
    expect(o.tree(fresh)?.model).toBe('orphan-tree');
    expect(o.tree(old)).toBeNull();
    expect(o.state(fresh, 'obj_2')?.level).toBe(3);
  });

  it('the new id keeps its tree when it has progress, and the two progresses are merged', () => {
    const { db, o, old, fresh } = collided(true);
    expect(o.tree(fresh)?.model).toBe('fresh-tree');
    // The orphan's tree for the same bytes is an unreachable duplicate and is gone.
    expect(o.tree(old)).toBeNull();
    expect(count(db, 'SELECT COUNT(*) AS n FROM learning_trees', {})).toBe(1);
    // obj_1: the higher level, and both sentences that earned it.
    const s1 = o.state(fresh, 'obj_1')!;
    expect(s1.level).toBe(2);
    expect([...s1.evidenceMessageIds].sort()).toEqual(['m_1', 'm_9']);
    expect(s1.lastMovedAt).toBe(T1);
    expect(o.state(fresh, 'obj_2')?.level).toBe(3);
    expect(o.states(old)).toEqual([]);
  });
});

describe('fix A on the open path: before the indexer reaches a moved file', () => {
  const FIXTURE = resolve(
    __dirname,
    '../../../../Academia/Sources/btw interaction/A0282987E_LohZhengLucas_Critique1_slides (1).pdf',
  );

  it('the room lookup after `segments.document` finds the orphan’s room', async () => {
    const { db, store, repo, vault } = setup();
    vault('v1', '/vault');
    const svc = new SegmentService({ db, sourcePath: () => FIXTURE, now: () => T0 });

    sync(repo, 'v1', [deck('old/Critique.pdf')]);
    const old = idAt(repo, 'v1', 'old/Critique.pdf');
    const { contentSha } = await svc.document(old);
    material(store, 'mat_1', old, contentSha);
    tree(db, old, 'orphan-tree', contentSha);

    sync(repo, 'v1', [deck('new/Critique.pdf', { mtimeMs: 42 })]);
    const fresh = idAt(repo, 'v1', 'new/Critique.pdf');
    expect(repo.files.get(fresh)?.sha256).toBeNull(); // not indexed yet

    const view = await svc.document(fresh);
    expect(view.contentSha).toBe(contentSha);
    // Exactly the lookup `openOrCreateFlowRoom` and the doc chat's `roomFor` make.
    expect(store.materials.forFile(fresh, contentSha)?.id).toBe('mat_1');
    expect(objectivesRepo(db).tree(fresh)?.model).toBe('orphan-tree');
  }, 60_000);
});

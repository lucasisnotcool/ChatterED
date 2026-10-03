/**
 * The notebook service and its host, against a real migrated SQLite and a real temp folder — the
 * things under test are copies on disk, an FTS table and page arithmetic across both.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase, type SqlDatabase } from '../db/driver.js';
import { runMigrations } from '../db/migrations.js';
import { ensureManagedVault, MANAGED_VAULT_ID } from '../vault/managed.js';
import { MESSAGES, NotebookService, safeFileName } from './service.js';
import { createNotebookHost, sourceHeader } from './host.js';
import { hwmKey } from './repo.js';
import type { NotebookChange } from '../../shared/notebook.js';
import { notebookContentKey, TEXT_PAGE_WORDS } from '../../shared/notebook.js';
import { paginateText } from '../../shared/paginate.js';
import { TWO_PAGE_PDF } from './fixtures.test-support.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations', import.meta.url));

let tmp = '';
let outside = '';
let db: SqlDatabase;
let service: NotebookService;
let changes: NotebookChange[];
let answer: boolean;
let deleted: string[];

function file(name: string, body: string | Buffer): string {
  const p = join(outside, name);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, typeof body === 'string' && name.endsWith('.pdf') ? Buffer.from(body, 'latin1') : body);
  return p;
}

function longText(paragraphs: number, words = 100): string {
  return Array.from({ length: paragraphs }, (_, i) =>
    Array.from({ length: words }, (_, j) => `para${i}word${j}`).join(' '),
  ).join('\n\n');
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'chattered-nb-'));
  outside = join(tmp, 'Desktop');
  mkdirSync(outside);
  db = openTestDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  const root = join(tmp, 'userData', 'notebooks');
  ensureManagedVault(db, root, '2026-10-01T00:00:00.000Z');
  changes = [];
  answer = true;
  deleted = [];
  let tick = 0;
  service = new NotebookService({
    db,
    root,
    // A clock that always moves, so "most recently opened" is never a tie.
    now: () => new Date(Date.UTC(2026, 9, 1) + (tick += 1000)).toISOString(),
    onChanged: (c) => changes.push(c),
    confirm: async () => answer,
    onDeleted: (id) => deleted.push(id),
    // "textutil": the test's .docx files hold their text, and conversion copies it.
    convertToText: async (input, output) => {
      const { readFileSync } = await import('node:fs');
      const body = readFileSync(input, 'utf8');
      if (body.startsWith('BROKEN')) throw new Error('textutil: bad file');
      writeFileSync(output, body);
    },
  });
});

afterEach(() => {
  service.dispose();
  rmSync(tmp, { recursive: true, force: true });
});

describe('making notebooks', () => {
  it('names a notebook after its first file, and lists the most recently opened first', async () => {
    const a = await service.create({ paths: [file('Lecture 4.pdf', TWO_PAGE_PDF)] });
    expect(a.notebook.name).toBe('Lecture 4');
    expect(a.notebook.id).toMatch(/^nb_[0-9a-f]{12}$/);
    const b = await service.create({});
    expect(b.notebook.name).toBe('Untitled notebook');
    const c = await service.create({ name: '  Revision  ' });
    expect(c.notebook.name).toBe('Revision');

    service.open(a.notebook.id);
    expect(service.list()[0]!.id).toBe(a.notebook.id);
    expect(service.list().map((s) => s.name)).toContain('Untitled notebook');
  });

  it('renames, and refuses an empty name', async () => {
    const { notebook } = await service.create({});
    expect(service.rename(notebook.id, ' Week 5 ').name).toBe('Week 5');
    expect(() => service.rename(notebook.id, '   ')).toThrow(/needs a name/);
  });
});

describe('adding sources', () => {
  it('copies a PDF in, returns it reading, then reads it to ready with its pages', async () => {
    const original = file('Lecture.pdf', TWO_PAGE_PDF);
    const { notebook, added, refused } = await service.create({ paths: [original] });
    expect(refused).toEqual([]);
    expect(added).toHaveLength(1);
    expect(added[0]!.status).toBe('reading');
    await service.whenIdle();

    const view = service.get(notebook.id)!;
    const src = view.sources[0]!;
    expect(src).toMatchObject({ name: 'Lecture.pdf', kind: 'pdf', status: 'ready', pageBase: 0, pageCount: 2, enabled: true });
    expect(view.pageCount).toBe(2);
    expect(view.contextFingerprint).toBe(`${src.fileId}@0`);

    // The copy is in the notebook's folder; the original is untouched.
    const dir = join(service.root, notebook.id);
    expect(readdirSync(dir)).toEqual([`${src.fileId}-Lecture.pdf`]);
    expect(existsSync(original)).toBe(true);

    // A files row in the managed vault, indexed, with the FTS rows per page.
    const row = db.prepare('SELECT * FROM files WHERE id = @id').get<{ vault_id: string; page_count: number; indexed_at: string | null }>({ id: src.fileId })!;
    expect(row.vault_id).toBe(MANAGED_VAULT_ID);
    expect(row.page_count).toBe(2);
    expect(row.indexed_at).not.toBeNull();
    // Every step was pushed.
    expect(changes.filter((c) => c.notebookId === notebook.id).length).toBeGreaterThanOrEqual(2);
    expect(changes.at(-1)!.view!.sources[0]!.status).toBe('ready');
  });

  it('paginates a text source and gives the next source the next base', async () => {
    const { notebook } = await service.create({ paths: [file('Lecture.pdf', TWO_PAGE_PDF)] });
    const text = longText(10); // 1,000 words → 3 pages
    await service.addSources(notebook.id, [file('notes.md', text), file('diagram.png', Buffer.from([137, 80, 78, 71]))]);
    await service.whenIdle();
    const view = service.get(notebook.id)!;
    expect(view.sources.map((s) => [s.name, s.kind, s.status, s.pageBase, s.pageCount])).toEqual([
      ['Lecture.pdf', 'pdf', 'ready', 0, 2],
      ['notes.md', 'text', 'ready', 2, paginateText(text).length],
      ['diagram.png', 'image', 'ready', 5, 1],
    ]);
    expect(paginateText(text).length).toBe(3);
    expect(view.pageCount).toBe(6);
  });

  it('converts a Word file with textutil and indexes the text, keeping the original copy', async () => {
    const { notebook } = await service.create({ paths: [file('Report.docx', 'Heading\n\nBody of the report.')] });
    await service.whenIdle();
    const src = service.get(notebook.id)!.sources[0]!;
    expect(src).toMatchObject({ name: 'Report.docx', kind: 'text', status: 'ready', pageCount: 1 });
    const names = readdirSync(join(service.root, notebook.id)).sort();
    expect(names).toEqual([`${src.fileId}-Report.docx`, `${src.fileId}-Report.docx.txt`]);
  });

  it('refuses Keynote/PowerPoint, unknown kinds, folders, oversize files and duplicates, and keeps the rest', async () => {
    const big = file('huge.pdf', '');
    truncateSync(big, 200 * 1024 * 1024 + 1);
    const pdf = file('a.pdf', TWO_PAGE_PDF);
    const twin = file('copy of a.pdf', TWO_PAGE_PDF);
    const { added, refused } = await service.create({
      paths: [pdf, file('deck.pptx', 'x'), file('talk.key', 'x'), file('tool.exe', 'x'), outside, big, twin, join(outside, 'gone.pdf')],
    });
    expect(added.map((a) => a.name)).toEqual(['a.pdf']);
    expect(refused).toEqual([
      { name: 'deck.pptx', reason: 'unsupported', message: MESSAGES.exportAsPdf },
      { name: 'talk.key', reason: 'unsupported', message: MESSAGES.exportAsPdf },
      { name: 'tool.exe', reason: 'unsupported', message: MESSAGES.unknownKind('exe') },
      { name: 'Desktop', reason: 'unsupported', message: MESSAGES.unknownKind('') },
      { name: 'huge.pdf', reason: 'too_big', message: MESSAGES.tooBig },
      { name: 'copy of a.pdf', reason: 'duplicate', message: MESSAGES.duplicate },
      { name: 'gone.pdf', reason: 'unreadable', message: MESSAGES.unreadable },
    ]);
    expect(MESSAGES.exportAsPdf).toBe("Keynote and PowerPoint files can't be read here. Export it as a PDF first.");
  });

  it('marks a source failed with a sentence the learner can act on', async () => {
    const { notebook } = await service.create({
      paths: [file('broken.docx', 'BROKEN'), file('empty.txt', '   \n\n  '), file('bad.pdf', 'not a pdf at all')],
    });
    await service.whenIdle();
    const byName = Object.fromEntries(service.get(notebook.id)!.sources.map((s) => [s.name, s]));
    expect(byName['broken.docx']).toMatchObject({ status: 'failed', error: MESSAGES.convertFailed, pageCount: 0 });
    expect(byName['empty.txt']).toMatchObject({ status: 'failed', error: MESSAGES.empty });
    expect(byName['bad.pdf']).toMatchObject({ status: 'failed', error: MESSAGES.pdfBroken });
    // Failed sources take no pages.
    expect(service.get(notebook.id)!.pageCount).toBe(0);
  });

  it('keeps unique copy names safe', () => {
    expect(safeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeFileName('.hidden.md')).toBe('hidden.md');
    expect(safeFileName('a:b/c.pdf')).toBe('a_b_c.pdf');
    expect(safeFileName(`${'x'.repeat(300)}.pdf`)).toMatch(/^x+\.pdf$/);
    expect(safeFileName(`${'x'.repeat(300)}.pdf`).length).toBe(120);
  });
});

describe('ticking, removing and deleting', () => {
  it('ticks and unticks, which changes the fingerprint and nothing else', async () => {
    const { notebook } = await service.create({ paths: [file('a.pdf', TWO_PAGE_PDF), file('b.md', 'B text')] });
    await service.whenIdle();
    const [a, b] = service.get(notebook.id)!.sources;
    const before = service.get(notebook.id)!.contextFingerprint;
    const after = service.setEnabled(notebook.id, [b!.fileId], false);
    expect(after.sources.map((s) => s.enabled)).toEqual([true, false]);
    expect(after.contextFingerprint).toBe(`${a!.fileId}@0`);
    expect(after.contextFingerprint).not.toBe(before);
    expect(service.setEnabled(notebook.id, [a!.fileId, b!.fileId], true).contextFingerprint).toBe(before);
  });

  it('removes a source after the confirm: copy, files row and FTS rows go, its pages become a gap', async () => {
    const { notebook } = await service.create({ paths: [file('a.pdf', TWO_PAGE_PDF), file('b.md', 'B text')] });
    await service.whenIdle();
    const [, b] = service.get(notebook.id)!.sources;
    expect(b!.pageBase).toBe(2);

    answer = false;
    expect((await service.removeSource(notebook.id, b!.fileId)).removed).toBe(false);
    answer = true;
    const result = await service.removeSource(notebook.id, b!.fileId);
    expect(result.removed).toBe(true);
    expect(result.notebook.sources).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM files WHERE id = @f').get<{ n: number }>({ f: b!.fileId })!.n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM file_text WHERE file_id = @f').get<{ n: number }>({ f: b!.fileId })!.n).toBe(0);
    expect(readdirSync(join(service.root, notebook.id)).some((n) => n.startsWith(b!.fileId))).toBe(false);
    // Page 3 was b's; it stays in range as a gap, and the next source starts after it.
    expect(result.notebook.pageCount).toBe(3);
    await service.addSources(notebook.id, [file('c.md', 'C text')]);
    await service.whenIdle();
    expect(service.get(notebook.id)!.sources.find((s) => s.name === 'c.md')!.pageBase).toBe(3);
    const host = createNotebookHost(db, { absPath: (rel) => service.absPath(rel) });
    expect(host.locate(notebook.id, 3)).toBeNull();
    expect(host.textFor({ notebookId: notebook.id, pageFrom: 3, pageTo: 3 })).toBe('');
  });

  it('never reuses a base, even with the high-water row lost, while a source is present', async () => {
    const { notebook } = await service.create({ paths: [file('a.pdf', TWO_PAGE_PDF)] });
    await service.whenIdle();
    db.prepare('DELETE FROM settings WHERE key = @k').run({ k: hwmKey(notebook.id) });
    await service.addSources(notebook.id, [file('b.md', 'B')]);
    await service.whenIdle();
    expect(service.get(notebook.id)!.sources[1]!.pageBase).toBe(2);
  });

  it('deletes a notebook after the confirm: copies and rows go, originals stay', async () => {
    const original = file('a.pdf', TWO_PAGE_PDF);
    const { notebook } = await service.create({ paths: [original] });
    await service.whenIdle();
    const fileId = service.get(notebook.id)!.sources[0]!.fileId;
    answer = false;
    expect(await service.delete(notebook.id)).toEqual({ deleted: false });
    answer = true;
    expect(await service.delete(notebook.id)).toEqual({ deleted: true });
    expect(service.get(notebook.id)).toBeNull();
    expect(existsSync(join(service.root, notebook.id))).toBe(false);
    expect(existsSync(original)).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM files WHERE id = @f').get<{ n: number }>({ f: fileId })!.n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM notebook_sources').get<{ n: number }>()!.n).toBe(0);
    expect(deleted).toEqual([notebook.id]);
    expect(changes.at(-1)).toEqual({ notebookId: notebook.id, view: null });
  });
});

describe('the host: one virtual deck', () => {
  it('lays the ticked, ready sources end to end with notebook page markers', async () => {
    const text = longText(10);
    const { notebook } = await service.create({
      paths: [file('Lecture.pdf', TWO_PAGE_PDF), file('notes.md', text), file('fig.png', Buffer.from([1, 2, 3]))],
    });
    await service.whenIdle();
    const host = createNotebookHost(db, { absPath: (rel) => service.absPath(rel) });
    const deck = host.deckText(notebook.id);
    expect(deck.truncated).toBe(false);
    const pages = paginateText(text);
    expect(deck.text).toBe(
      [
        sourceHeader('Lecture.pdf'),
        '[p. 1]\nChallenger',
        '[p. 2]\nHessian',
        sourceHeader('notes.md'),
        ...pages.map((p, i) => `[p. ${3 + i}]\n${p}`),
        sourceHeader('fig.png'),
        '[p. 6]\n(An image: fig.png. It has no text to read.)',
      ].join('\n\n'),
    );

    // Unticked sources leave the deck text and the outline, but not textFor or locate.
    const md = service.get(notebook.id)!.sources[1]!;
    service.setEnabled(notebook.id, [md.fileId], false);
    expect(host.deckText(notebook.id).text).not.toContain('notes.md');
    expect(host.textFor({ notebookId: notebook.id, pageFrom: 3, pageTo: 3 })).toBe(pages[0]);
    expect(host.textFor({ notebookId: notebook.id, pageFrom: 2, pageTo: 3 })).toBe(`Hessian\n\n${pages[0]}`);
    expect(host.locate(notebook.id, 4)).toMatchObject({ fileId: md.fileId, localPage: 2, kind: 'text' });
    expect(host.locate(notebook.id, 1)!.path).toBe(join(service.root, notebook.id, `${service.get(notebook.id)!.sources[0]!.fileId}-Lecture.pdf`));
    expect(host.locate(notebook.id, 7)).toBeNull();
    expect(host.locate(notebook.id, 0)).toBeNull();

    expect(host.outline(notebook.id)).toBe(['Lecture.pdf:', 'p. 1 — Challenger', 'p. 2 — Hessian', 'fig.png:', 'p. 6 — (image) fig.png'].join('\n'));

    const subject = host.subject(notebook.id)!;
    expect(subject.contentKey).toBe(notebookContentKey(notebook.id));
    expect(subject.pageCount).toBe(6);
    expect(subject.sources).toHaveLength(3);
    expect(host.subject('f_abc')).toBeNull();
    expect(host.deckText('f_abc')).toEqual({ text: '', truncated: false });
  });

  it('counts a long text in about TEXT_PAGE_WORDS-word pages', async () => {
    const { notebook } = await service.create({ paths: [file('long.txt', longText(40))] });
    await service.whenIdle();
    expect(service.get(notebook.id)!.sources[0]!.pageCount).toBe(Math.ceil((40 * 100) / TEXT_PAGE_WORDS));
  });
});

describe('the home card', () => {
  it('shows the doc title as the subtitle and the fill from the tree and the outcomes', async () => {
    const { notebook } = await service.create({ name: 'N' });
    expect(service.list()[0]).toMatchObject({ subtitle: null, fill: null, sourceCount: 0 });
    const key = notebookContentKey(notebook.id);
    const now = '2026-10-02T00:00:00.000Z';
    db.prepare(
      `INSERT INTO notes_docs (id, content_sha, file_id, title, doc_json, ingest_status, ingest_version, created_at, updated_at)
       VALUES ('doc_1', @k, @f, 'Real World Planning', '{}', 'ready', 1, @t, @t)`,
    ).run({ k: key, f: notebook.id, t: now });
    const objectives = [
      { id: 'o1', title: 'A', assumedByDeck: false },
      { id: 'o2', title: 'B', assumedByDeck: false },
      { id: 'o3', title: 'C', assumedByDeck: true },
    ];
    db.prepare(
      `INSERT INTO learning_trees (file_id, content_sha, prompt_version, model, status, generated_at, error, json, created_at, updated_at)
       VALUES (@f, @k, 1, 'm', 'ready', @t, NULL, @j, @t, @t)`,
    ).run({ f: notebook.id, k: key, t: now, j: JSON.stringify(objectives) });
    db.prepare(
      `INSERT INTO quiz_outcomes (id, content_sha, room_id, objective_id, question_id, kind, verdict, created_at)
       VALUES ('q1', @k, 'r', 'o1', 'qq1', 'verdict', 'complete', @t)`,
    ).run({ k: key, t: now });
    const card = service.list()[0]!;
    expect(card.subtitle).toBe('Real World Planning');
    expect(card.updatedAt).toBe(now);
    // One of the two counted objectives complete; the assumed one is out of the total.
    expect(card.fill).toBe(0.5);
  });
});

describe('folders (docs/research/search.md §1)', () => {
  it('nests folders, names new ones so they do not clash, and lists them', () => {
    const cs = service.createFolder({ name: 'CS4246' });
    expect(cs.id).toMatch(/^fd_[0-9a-f]{12}$/);
    const a = service.createFolder({ parentId: cs.id });
    const b = service.createFolder({ parentId: cs.id });
    expect([a.name, b.name]).toEqual(['Untitled folder', 'Untitled folder 2']);
    expect(service.renameFolder(a.id, ' Planning ').name).toBe('Planning');
    expect(() => service.renameFolder(a.id, '  ')).toThrow(/needs a name/);
    expect(service.folders().map((f) => [f.name, f.parentId])).toEqual(
      expect.arrayContaining([['CS4246', null], ['Planning', cs.id], ['Untitled folder 2', cs.id]]),
    );
    expect(() => service.createFolder({ parentId: 'fd_000000000000' })).toThrow(/no longer exists/);
  });

  it('makes a notebook in the folder the learner is in, and moves it without calling it an edit', async () => {
    const cs = service.createFolder({ name: 'CS4246' });
    const { notebook } = await service.create({ name: 'Week 3', folderId: cs.id });
    expect(service.list().find((n) => n.id === notebook.id)!.folderId).toBe(cs.id);
    const before = service.list().find((n) => n.id === notebook.id)!.updatedAt;
    service.moveNotebook(notebook.id, null);
    const after = service.list().find((n) => n.id === notebook.id)!;
    expect(after.folderId).toBeNull();
    expect(after.updatedAt).toBe(before);
    expect(() => service.moveNotebook(notebook.id, 'fd_000000000000')).toThrow(/no longer exists/);
  });

  it('refuses to move a folder inside itself, and moves it anywhere else', () => {
    const top = service.createFolder({ name: 'CS4246' });
    const mid = service.createFolder({ name: 'Planning', parentId: top.id });
    const low = service.createFolder({ name: 'Week 3', parentId: mid.id });
    expect(() => service.moveFolder(top.id, low.id)).toThrow(/inside itself/);
    expect(() => service.moveFolder(top.id, top.id)).toThrow(/inside itself/);
    expect(service.moveFolder(low.id, null).parentId).toBeNull();
    expect(service.moveFolder(low.id, top.id).parentId).toBe(top.id);
  });

  it('deletes a folder by moving its notebooks and subfolders up one level, never deleting a notebook', async () => {
    const top = service.createFolder({ name: 'CS4246' });
    const mid = service.createFolder({ name: 'Planning', parentId: top.id });
    const low = service.createFolder({ name: 'Week 3', parentId: mid.id });
    const { notebook } = await service.create({ name: 'Lecture-complex', folderId: mid.id });
    changes.length = 0;
    expect(service.deleteFolder(mid.id)).toEqual({ deleted: true, movedNotebooks: 1, movedFolders: 1 });
    expect(service.get(notebook.id)).not.toBeNull();
    expect(service.list().find((n) => n.id === notebook.id)!.folderId).toBe(top.id);
    expect(service.folders().find((f) => f.id === low.id)!.parentId).toBe(top.id);
    expect(service.folders().some((f) => f.id === mid.id)).toBe(false);
    expect(changes.map((c) => c.notebookId)).toEqual([notebook.id]);
    expect(service.deleteFolder(mid.id)).toEqual({ deleted: false, movedNotebooks: 0, movedFolders: 0 });
  });

  it('scopes search to a folder and everything under it', async () => {
    const top = service.createFolder({ name: 'CS4246' });
    const mid = service.createFolder({ name: 'Planning', parentId: top.id });
    const other = service.createFolder({ name: 'CS3249' });
    const a = (await service.create({ name: 'a', folderId: top.id })).notebook.id;
    const b = (await service.create({ name: 'b', folderId: mid.id })).notebook.id;
    const c = (await service.create({ name: 'c', folderId: other.id })).notebook.id;
    const d = (await service.create({ name: 'd' })).notebook.id;
    expect(service.scopeNotebookIds(top.id).sort()).toEqual([a, b].sort());
    expect(service.scopeNotebookIds(mid.id)).toEqual([b]);
    expect(service.scopeNotebookIds(null).sort()).toEqual([a, b, c, d].sort());
    expect(service.scopeNotebookIds('fd_000000000000')).toEqual([]);
  });

  it('keeps a notebook visible at the top level if its folder row is ever deleted behind the service’s back', async () => {
    const top = service.createFolder({ name: 'CS4246' });
    const { notebook } = await service.create({ name: 'a', folderId: top.id });
    db.prepare('DELETE FROM folders WHERE id = @id').run({ id: top.id });
    expect(service.list().find((n) => n.id === notebook.id)!.folderId).toBeNull();
  });
});

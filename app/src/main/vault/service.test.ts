/**
 * Vault end-to-end: scan → topic promotion → FTS5 index → query (issue #22 decisions 1–2).
 *
 * Against a real temp vault and a real migrated SQLite, because the things being tested are a
 * migration, a virtual table and a filesystem walk — a mock of any of the three would be a test
 * of my assumptions about it. The PDF is the hand-written two-page fixture from pdf.test.ts, so
 * the page-numbered search path is exercised without checking a binary into the repo.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { openTestDatabase, hasFts5 } from '../db/driver.js';
import { runMigrations } from '../db/migrations.js';
import { settingsRepo } from '../db/repos/core.js';
import { REFERENCE_TEXT_CAP, VaultService } from './service.js';
import { createVaultRepo, toMatchQuery, type VaultRepo } from './repo.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations', import.meta.url));

/** A two-page PDF: page 1 says "Challenger", page 2 says "Hessian". Hand-written, 845 bytes. */
const TWO_PAGE_PDF =
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 42 >>\nstream\nBT /F1 24 Tf 20 100 Td (Challenger) Tj ET\nendstream\nendobj\n5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>\nendobj\n6 0 obj\n<< /Length 39 >>\nstream\nBT /F1 24 Tf 20 100 Td (Hessian) Tj ET\nendstream\nendobj\n7 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\nxref\n0 8\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000121 00000 n \n0000000247 00000 n \n0000000338 00000 n \n0000000464 00000 n \n0000000552 00000 n \ntrailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n622\n%%EOF\n';

let root = '';
let service: VaultService;
let repo: VaultRepo;

function write(rel: string, body: string, binary = false): string {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, binary ? Buffer.from(body, 'latin1') : body);
  return abs;
}

function freshService(): VaultService {
  const db = openTestDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  repo = createVaultRepo(db);
  return new VaultService({ db, settings: settingsRepo(db) });
}

/** The scanned file with this name. The vault's tree and search are gone (issue #58), so tests ask the repo. */
function fileNamed(name: string) {
  const file = repo.files.forVault(service.activeVaultId()!).find((f) => f.name === name);
  if (!file) throw new Error(`no scanned file called ${name}`);
  return file;
}

/** FTS hits for a query, as `name#page`, sorted. */
function hitNames(query: string): string[] {
  return repo.text
    .search(service.activeVaultId()!, query, 60)
    .map((h) => `${repo.files.get(h.file_id)!.name}#${h.page}`)
    .sort();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chattered-vaultsvc-'));
  service = freshService();
});

afterEach(() => {
  service.dispose();
  rmSync(root, { recursive: true, force: true });
});

describe('the SQLite the vault index needs', () => {
  it('has FTS5 compiled in, on the driver the tests actually run', () => {
    const db = openTestDatabase(':memory:');
    expect(hasFts5(db)).toBe(true);
  });
});

describe('opening a vault', () => {
  it('scans recursively and files everything under "Other" until a topic is promoted', () => {
    write('MA3236/notes.md', '# Convexity\n\nA Hessian is positive semidefinite.');
    write('CS3249/brief.txt', 'usability heuristics');
    write('loose.md', 'stray');

    const view = service.open(root);
    expect(view.rootPath).toBe(root);
    expect(view.totalFiles).toBe(3);
    expect(view.topics).toEqual([]);
    expect(view.otherCount).toBe(3);
  });
});

describe('the full-text index', () => {
  it('indexes Markdown, text and PDF, and answers with a snippet and a page number', async () => {
    write('MA3236/notes.md', '# Convexity\n\nThe Hessian is positive semidefinite everywhere.');
    write('MA3236/brief.txt', 'Max plays the Challenger role in the room.');
    write('MA3236/slides.pdf', TWO_PAGE_PDF, true);
    service.open(root);
    await service.indexAll();

    const status = service.indexStatus();
    expect(status.total).toBe(3);
    expect(status.done).toBe(3);
    expect(status.failed).toBe(0);

    // The word is on page 1 of the PDF and in the .txt (which has no pages).
    expect(hitNames('Challenger')).toEqual(['brief.txt#null', 'slides.pdf#1']);

    // Page 2 of the same PDF is a separate row, so a query finds the right page.
    expect(hitNames('Hessian')).toEqual(['notes.md#null', 'slides.pdf#2']);

    const heads = await service.pageHeads(fileNamed('slides.pdf').id);
    expect(heads.map((h) => h.head)).toEqual(['Challenger', 'Hessian']);
  });

  it('records a PDF with no text layer as a failed row rather than dropping the file', async () => {
    // A one-page PDF whose content stream draws a rectangle and no text at all.
    const IMAGE_ONLY =
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 26 >>\nstream\n0 0 1 rg 10 10 80 80 re f\n\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000117 00000 n \n0000000210 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n287\n%%EOF\n';
    write('scan.pdf', IMAGE_ONLY, true);
    service.open(root);
    await service.indexAll();

    const row = fileNamed('scan.pdf');
    expect(row.indexed_at !== null && row.index_error === null).toBe(false);
    expect(row.index_error).toMatch(/scanned image/);
    expect(service.indexStatus().failed).toBe(1);
  });

  it('re-indexes only what changed, and drops the rows of a deleted file', async () => {
    write('a.md', 'alpha content');
    write('b.md', 'bravo content');
    service.open(root);
    await service.indexAll();
    expect(hitNames('bravo')).toHaveLength(1);

    // Touch one file: new bytes, new mtime.
    write('a.md', 'alpha rewritten with charlie');
    const future = new Date(Date.now() + 5_000);
    utimesSync(join(root, 'a.md'), future, future);
    service.rescan();
    await service.indexAll();

    expect(hitNames('charlie')).toEqual(['a.md#null']);
    expect(hitNames('rewritten')).toHaveLength(1);
    // The old text is gone, not merely shadowed.
    expect(hitNames('alpha content')).toHaveLength(0);

    rmSync(join(root, 'b.md'));
    service.rescan();
    expect(hitNames('bravo')).toHaveLength(0);
    expect(service.view().totalFiles).toBe(1);
  });

  it('quotes what the learner typed instead of handing it to the FTS5 query parser', () => {
    // A bare `AND`, a quote or a `*` would otherwise be a syntax error or a different query.
    expect(toMatchQuery('positive semidefinite')).toBe('"positive" AND "semidefinite"*');
    expect(toMatchQuery('  "OR" ')).toBe('"OR"*');
    expect(toMatchQuery('   ')).toBe('');
    expect(() => hitNames('AND OR NEAR(')).not.toThrow();
  });
});

describe('text for a reference', () => {
  it('serves the indexed page range without re-reading the PDF', async () => {
    write('slides.pdf', TWO_PAGE_PDF, true);
    service.open(root);
    await service.indexAll();
    const fileId = fileNamed('slides.pdf').id;

    expect(await service.textFor({ fileId, pageFrom: 1, pageTo: 1 })).toContain('Challenger');
    expect(await service.textFor({ fileId, pageFrom: 2, pageTo: 2 })).toContain('Hessian');
    const both = await service.textFor({ fileId, pageFrom: 1, pageTo: 2 });
    expect(both).toContain('Challenger');
    expect(both).toContain('Hessian');
  });

  it('falls back to reading the file when the indexer has not got there yet', async () => {
    write('notes.md', 'not indexed yet, but readable');
    service.open(root);
    const fileId = fileNamed('notes.md').id;
    expect(await service.textFor({ fileId, pageFrom: null, pageTo: null })).toContain('readable');
  });
});

describe('the whole document, for a deck-scope question', () => {
  /** ~28 K characters, the size of the 58-page CS4246 deck this was found on. */
  const LONG = Array.from({ length: 700 }, (_, i) => `line ${i} of the lecture, with words in it.`).join('\n');

  it('is uncapped, where a selection is capped', async () => {
    expect(LONG.length).toBeGreaterThan(REFERENCE_TEXT_CAP * 4);
    write('deck.md', LONG);
    service.open(root);
    await service.indexAll();
    const fileId = fileNamed('deck.md').id;

    const selection = await service.textFor({ fileId, pageFrom: null, pageTo: null });
    expect(selection.length).toBeLessThanOrEqual(REFERENCE_TEXT_CAP);

    const deck = await service.deckText(fileId);
    expect(deck.text).toBe(LONG);
    expect(deck.truncated).toBe(false);
  });

  it('ranks whole pages of one file for the retrieval fallback', async () => {
    write('slides.pdf', TWO_PAGE_PDF, true);
    service.open(root);
    await service.indexAll();
    const fileId = fileNamed('slides.pdf').id;

    const hits = service.topPages(fileId, 'Hessian', 4);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.page).toBe(2);
    expect(hits[0]!.body).toContain('Hessian');
  });

  it("falls back to each page's first line when a document has no segmentation", async () => {
    write('slides.pdf', TWO_PAGE_PDF, true);
    service.open(root);
    await service.indexAll();
    const fileId = fileNamed('slides.pdf').id;

    const heads = await service.pageHeads(fileId);
    expect(heads.map((h) => h.head)).toEqual(['Challenger', 'Hessian']);
  });
});

describe('topic context for the room', () => {
  it('is the topic name plus a sorted, capped list of file names — never paths', () => {
    write('MA3236/z.md', 'a');
    write('MA3236/a.md', 'b');
    write('MA3236/Week 4/m.md', 'c');
    service.open(root);
    // Topics are no longer made in the app (issue #58); an upgraded install still has them, so
    // the row is planted the way the retired promote step wrote it, then a scan files into it.
    const topicId = 'topic_ma3236';
    repo.topics.insert({
      id: topicId,
      vault_id: service.activeVaultId()!,
      rel_path: 'MA3236',
      name: 'MA3236',
      module_code: 'MA3236',
      colour: '#888888',
      sort_order: 0,
      promoted_at: '2026-01-01T00:00:00.000Z',
    });
    service.rescan();

    const context = service.topicContext(topicId)!;
    expect(context.name).toBe('MA3236');
    expect(context.fileNames).toEqual(['a.md', 'm.md', 'z.md']);
    expect(context.fileNames.join()).not.toContain('/');
    expect(service.topicContext(null)).toBeNull();
  });
});

describe('path safety', () => {
  it('will not serve a file that is not in the index', async () => {
    service.open(root);
    await expect(service.document('f_nonexistent')).rejects.toThrow(/not in the vault/);
  });
});

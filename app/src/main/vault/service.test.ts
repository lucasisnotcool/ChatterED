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
import { TOPIC_COLOURS } from './palette.js';
import { splitSnippet, VaultService } from './service.js';
import { toMatchQuery } from './repo.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations', import.meta.url));

/** A two-page PDF: page 1 says "Challenger", page 2 says "Hessian". Hand-written, 845 bytes. */
const TWO_PAGE_PDF =
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 42 >>\nstream\nBT /F1 24 Tf 20 100 Td (Challenger) Tj ET\nendstream\nendobj\n5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>\nendobj\n6 0 obj\n<< /Length 39 >>\nstream\nBT /F1 24 Tf 20 100 Td (Hessian) Tj ET\nendstream\nendobj\n7 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\nxref\n0 8\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000121 00000 n \n0000000247 00000 n \n0000000338 00000 n \n0000000464 00000 n \n0000000552 00000 n \ntrailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n622\n%%EOF\n';

let root = '';
let service: VaultService;

function write(rel: string, body: string, binary = false): string {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, binary ? Buffer.from(body, 'latin1') : body);
  return abs;
}

function freshService(): VaultService {
  const db = openTestDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  return new VaultService({ db, settings: settingsRepo(db) });
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

  it('offers the depth-1 folders as topic candidates, with counts', () => {
    write('MA3236/Week 4/lecture.md', 'a');
    write('MA3236/notes.md', 'b');
    write('CS3249/brief.txt', 'c');
    service.open(root);

    expect(service.candidates()).toEqual([
      { relPath: 'CS3249', name: 'CS3249', fileCount: 1, promoted: false },
      { relPath: 'MA3236', name: 'MA3236', fileCount: 2, promoted: false },
    ]);
  });

  it('persists a promoted topic, its colour and its module code across a re-scan', () => {
    write('MA3236/Week 4/lecture.md', 'a');
    write('MA3236/notes.md', 'b');
    write('Sources/paper.md', 'c');
    write('loose.md', 'd');
    service.open(root);

    const promoted = service.promote(['MA3236']);
    expect(promoted.topics).toHaveLength(1);
    const topic = promoted.topics[0]!;
    expect(topic.name).toBe('MA3236');
    expect(topic.fileCount).toBe(2);
    expect(topic.moduleCode).toBe('MA3236');
    expect(TOPIC_COLOURS).toContain(topic.colour as (typeof TOPIC_COLOURS)[number]);
    expect(promoted.otherCount).toBe(2);

    // A re-scan must not re-colour the sidebar or lose the promotion.
    const again = service.rescan();
    expect(again.topics.map((t) => [t.id, t.colour, t.fileCount])).toEqual([
      [topic.id, topic.colour, 2],
    ]);
    expect(service.candidates().find((c) => c.relPath === 'MA3236')?.promoted).toBe(true);
  });

  it('names a non-module folder as a topic but leaves module_code null', () => {
    write('Sources/paper.md', 'a');
    service.open(root);
    expect(service.promote(['Sources']).topics[0]!.moduleCode).toBeNull();
  });

  it('demotes a topic by leaving it out, and its files fall back to Other', () => {
    write('MA3236/notes.md', 'a');
    service.open(root);
    expect(service.promote(['MA3236']).otherCount).toBe(0);
    const after = service.promote([]);
    expect(after.topics).toEqual([]);
    expect(after.otherCount).toBe(1);
  });

  it('builds a folders-first tree under the topic, with the topic prefix stripped', () => {
    write('MA3236/notes.md', 'a');
    write('MA3236/Week 4/lecture.md', 'b');
    write('MA3236/Week 10/lecture.md', 'c');
    service.open(root);
    const topicId = service.promote(['MA3236']).topics[0]!.id;

    const tree = service.tree(topicId);
    expect(tree.map((n) => [n.name, n.dir])).toEqual([
      ['Week 4', true],
      ['Week 10', true], // numeric collation: Week 4 before Week 10, not '10' before '4'
      ['notes.md', false],
    ]);
    expect(tree[0]!.children.map((c) => c.name)).toEqual(['lecture.md']);
    expect(tree[2]!.file?.relPath).toBe('MA3236/notes.md');
  });
});

describe('the full-text index', () => {
  it('indexes Markdown, text and PDF, and answers with a snippet and a page number', async () => {
    write('MA3236/notes.md', '# Convexity\n\nThe Hessian is positive semidefinite everywhere.');
    write('MA3236/brief.txt', 'Max plays the Challenger role in the room.');
    write('MA3236/slides.pdf', TWO_PAGE_PDF, true);
    service.open(root);
    service.promote(['MA3236']);
    await service.indexAll();

    const status = service.indexStatus();
    expect(status.total).toBe(3);
    expect(status.done).toBe(3);
    expect(status.failed).toBe(0);

    const hits = service.search('Challenger');
    const names = hits.map((h) => `${h.name}#${h.page}`).sort();
    // The word is on page 1 of the PDF and in the .txt (which has no pages).
    expect(names).toEqual(['brief.txt#null', 'slides.pdf#1']);

    const pdfHit = hits.find((h) => h.kind === 'pdf')!;
    expect(pdfHit.page).toBe(1);
    expect(pdfHit.topicName).toBe('MA3236');
    expect(splitSnippet(pdfHit.snippet).some((p) => p.match && p.text === 'Challenger')).toBe(true);

    // Page 2 of the same PDF is a separate row, so a query finds the right page.
    expect(service.search('Hessian').map((h) => [h.name, h.page]).sort()).toEqual([
      ['notes.md', null],
      ['slides.pdf', 2],
    ]);
  });

  it('records a PDF with no text layer as a failed row rather than dropping the file', async () => {
    // A one-page PDF whose content stream draws a rectangle and no text at all.
    const IMAGE_ONLY =
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 26 >>\nstream\n0 0 1 rg 10 10 80 80 re f\n\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000117 00000 n \n0000000210 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n287\n%%EOF\n';
    write('scan.pdf', IMAGE_ONLY, true);
    service.open(root);
    await service.indexAll();

    const node = service.tree(null).find((n) => n.name === 'scan.pdf');
    expect(node?.file?.indexed).toBe(false);
    expect(node?.file?.indexError).toMatch(/scanned image/);
    expect(service.indexStatus().failed).toBe(1);
  });

  it('re-indexes only what changed, and drops the rows of a deleted file', async () => {
    write('a.md', 'alpha content');
    write('b.md', 'bravo content');
    service.open(root);
    await service.indexAll();
    expect(service.search('bravo')).toHaveLength(1);

    // Touch one file: new bytes, new mtime.
    write('a.md', 'alpha rewritten with charlie');
    const future = new Date(Date.now() + 5_000);
    utimesSync(join(root, 'a.md'), future, future);
    service.rescan();
    await service.indexAll();

    expect(service.search('charlie').map((h) => h.name)).toEqual(['a.md']);
    expect(service.search('rewritten')).toHaveLength(1);
    // The old text is gone, not merely shadowed.
    expect(service.search('alpha content')).toHaveLength(0);

    rmSync(join(root, 'b.md'));
    service.rescan();
    expect(service.search('bravo')).toHaveLength(0);
    expect(service.view().totalFiles).toBe(1);
  });

  it('quotes what the learner typed instead of handing it to the FTS5 query parser', () => {
    // A bare `AND`, a quote or a `*` would otherwise be a syntax error or a different query.
    expect(toMatchQuery('positive semidefinite')).toBe('"positive" AND "semidefinite"*');
    expect(toMatchQuery('  "OR" ')).toBe('"OR"*');
    expect(toMatchQuery('   ')).toBe('');
    expect(() => service.search('AND OR NEAR(')).not.toThrow();
  });
});

describe('the ⌘K finder', () => {
  it('matches on a fuzzy subsequence of the path and prefers the file name', () => {
    write('MA3236/Week 4/lecture-notes.pdf', 'a');
    write('MA3236/admin/timetable.md', 'b');
    service.open(root);

    const hits = service.find('ma32wk4lec');
    expect(hits[0]!.relPath).toBe('MA3236/Week 4/lecture-notes.pdf');
    expect(hits[0]!.positions.length).toBe('ma32wk4lec'.length);

    expect(service.find('timetable')[0]!.name).toBe('timetable.md');
    expect(service.find('zzzz')).toEqual([]);
    expect(service.find('')).toEqual([]);
  });
});

describe('text for a reference', () => {
  it('serves the indexed page range without re-reading the PDF', async () => {
    write('slides.pdf', TWO_PAGE_PDF, true);
    service.open(root);
    await service.indexAll();
    const fileId = service.tree(null).find((n) => n.name === 'slides.pdf')!.file!.id;

    expect(await service.textFor({ fileId, pageFrom: 1, pageTo: 1 })).toContain('Challenger');
    expect(await service.textFor({ fileId, pageFrom: 2, pageTo: 2 })).toContain('Hessian');
    const both = await service.textFor({ fileId, pageFrom: 1, pageTo: 2 });
    expect(both).toContain('Challenger');
    expect(both).toContain('Hessian');
  });

  it('falls back to reading the file when the indexer has not got there yet', async () => {
    write('notes.md', 'not indexed yet, but readable');
    service.open(root);
    const fileId = service.tree(null).find((n) => n.name === 'notes.md')!.file!.id;
    expect(await service.textFor({ fileId, pageFrom: null, pageTo: null })).toContain('readable');
  });
});

describe('topic context for the room', () => {
  it('is the topic name plus a sorted, capped list of file names — never paths', () => {
    write('MA3236/z.md', 'a');
    write('MA3236/a.md', 'b');
    write('MA3236/Week 4/m.md', 'c');
    service.open(root);
    const topicId = service.promote(['MA3236']).topics[0]!.id;

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
    expect(() => service.revealPath('f_nonexistent')).toThrow(/not in the vault/);
  });
});

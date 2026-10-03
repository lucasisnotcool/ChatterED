/**
 * `notes:pageTexts`: the vault's indexed text as notebook pages, for the slide strips.
 *
 * Seeded with plain rows rather than through the notebook service: what is under test is the
 * arithmetic (each source at its base, every page a key, an image empty, a gap absent) and that it
 * reads the same `file_text` rows the rest of the doc path does.
 */
import { describe, expect, it } from 'vitest';
import { openTestDb } from '../../test-support/db.js';
import type { SqlDatabase } from '../db/driver.js';
import { IPC } from '../../shared/ipc.js';
import { notebookPageTexts, pageTextsFor, registerPageTextsIpc } from './pagetexts.js';

const NB = 'nb_0123456789ab';
const NOW = '2026-10-03T10:00:00.000Z';

function seed(): SqlDatabase {
  const { db } = openTestDb();
  db.prepare(`INSERT INTO vaults (id, root_path, display_name, created_at) VALUES ('v1', '/tmp/v1', 'Store', @now)`).run({ now: NOW });
  const file = db.prepare(
    `INSERT INTO files (id, vault_id, rel_path, name, ext, kind, size, mtime_ms) VALUES (@id, 'v1', @id, @id, @ext, @kind, 1, 1)`,
  );
  file.run({ id: 'f_deck', ext: 'pdf', kind: 'pdf' });
  file.run({ id: 'f_photo', ext: 'png', kind: 'image' });
  file.run({ id: 'f_reading', ext: 'md', kind: 'markdown' });
  db.prepare(`INSERT INTO notebooks (id, name, created_at, updated_at) VALUES (@id, 'Planning', @now, @now)`).run({ id: NB, now: NOW });
  const source = db.prepare(
    `INSERT INTO notebook_sources (file_id, notebook_id, display_name, page_base, page_count, enabled, ord, status, added_at)
     VALUES (@file, @nb, @file, @base, @count, @enabled, @ord, 'ready', @now)`,
  );
  // The deck at 1..3; a removed source left 4..9 a gap; the photo at 10; the reading at 11..12, unticked.
  source.run({ file: 'f_deck', nb: NB, base: 0, count: 3, enabled: 1, ord: 0, now: NOW });
  source.run({ file: 'f_photo', nb: NB, base: 9, count: 1, enabled: 1, ord: 1, now: NOW });
  source.run({ file: 'f_reading', nb: NB, base: 10, count: 2, enabled: 0, ord: 2, now: NOW });
  const text = db.prepare('INSERT INTO file_text (body, name, file_id, page) VALUES (@body, @file, @file, @page)');
  text.run({ file: 'f_deck', page: 1, body: 'Real World Planning and Acting\n' });
  text.run({ file: 'f_deck', page: 3, body: 'Topics\n• Heuristics' });
  text.run({ file: 'f_reading', page: 1, body: 'A reading, paragraph one.' });
  text.run({ file: 'f_reading', page: 2, body: 'Paragraph two.' });
  return db;
}

describe('notebookPageTexts', () => {
  it('lays the sources end to end at their bases, every page a key, an image empty', () => {
    expect(
      notebookPageTexts([
        { pageBase: 0, pageCount: 2, kind: 'pdf', rows: [{ page: 2, body: ' Two ' }, { page: null, body: 'chunk' }] },
        { pageBase: 5, pageCount: 1, kind: 'image', rows: [{ page: 1, body: 'never read' }] },
        { pageBase: 6, pageCount: 1, kind: 'pdf', rows: [{ page: 1, body: 'a' }, { page: 1, body: 'b' }, { page: 4, body: 'past the end' }] },
      ]),
    ).toEqual({ 1: '', 2: 'Two', 6: '', 7: 'a\nb' });
  });
});

describe('pageTextsFor', () => {
  it('reads a notebook as notebook pages, whatever each source\'s tick', () => {
    expect(pageTextsFor(seed(), NB)).toEqual({
      1: 'Real World Planning and Acting',
      2: '',
      3: 'Topics\n• Heuristics',
      10: '',
      11: 'A reading, paragraph one.',
      12: 'Paragraph two.',
    });
  });

  it('reads a plain file by its own pages, and an unknown id as nothing', () => {
    const db = seed();
    expect(pageTextsFor(db, 'f_deck')).toEqual({ 1: 'Real World Planning and Acting', 2: '', 3: 'Topics\n• Heuristics' });
    expect(pageTextsFor(db, 'f_nope')).toEqual({});
    expect(pageTextsFor(db, 'nb_ffffffffffff')).toEqual({});
  });

  it('is the body of notes:pageTexts', async () => {
    const db = seed();
    const handlers = new Map<string, (payload: unknown) => unknown>();
    registerPageTextsIpc({ db }, ((channel: string, fn: (payload: unknown) => unknown) => void handlers.set(channel, fn)) as never);
    expect(await handlers.get(IPC.notesPageTexts)!({ fileId: NB })).toMatchObject({ 3: 'Topics\n• Heuristics' });
    expect(await handlers.get(IPC.notesPageTexts)!({ fileId: '' })).toEqual({});
  });
});

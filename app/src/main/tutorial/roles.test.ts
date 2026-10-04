/**
 * Source roles (`tutorials.md` §1, migration 028): guessed when a source is read, set from its
 * row, and honoured by the host — the overview reads lecture sources only, the room lecture and
 * tutorial, and nothing outside `main/tutorial/` reads solutions. Against a real migrated SQLite
 * and real copies on disk, as `notebooks/service.test.ts` is.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase, type SqlDatabase } from '../db/driver.js';
import { runMigrations } from '../db/migrations.js';
import { ensureManagedVault } from '../vault/managed.js';
import { NotebookService, type RoleChange } from '../notebooks/service.js';
import { createNotebookHost, OVERVIEW_ROLES, sourceHeader } from '../notebooks/host.js';
import { contextFingerprint } from '../../shared/notebook.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations', import.meta.url));

let tmp = '';
let outside = '';
let db: SqlDatabase;
let service: NotebookService;
let roleChanges: RoleChange[];

function file(name: string, body: string): string {
  const p = join(outside, name);
  writeFileSync(p, body);
  return p;
}

const LECTURE = 'Planning graphs and heuristics.\n\nThe relaxed problem ignores delete lists.';
const SHEET = 'Tutorial 9\n\nProblem 1\nGive a plan.\n\nProblem 2\nExplain relaxation.';
const SOLUTIONS = 'Problem 1: Move(X, Y, Table), Move(Y, Table, X).\n\nProblem 2: it is a lower bound.';

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'chattered-tut-'));
  outside = join(tmp, 'Desktop');
  mkdirSync(outside);
  db = openTestDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  const root = join(tmp, 'userData', 'notebooks');
  ensureManagedVault(db, root, '2026-10-01T00:00:00.000Z');
  roleChanges = [];
  let tick = 0;
  service = new NotebookService({
    db,
    root,
    now: () => new Date(Date.UTC(2026, 9, 3) + (tick += 1000)).toISOString(),
    confirm: async () => true,
    onRoleChanged: (c) => roleChanges.push(c),
  });
});

afterEach(() => {
  service.dispose();
  rmSync(tmp, { recursive: true, force: true });
});

async function notebookWithAll(): Promise<string> {
  const { notebook } = await service.create({
    paths: [file('Lecture 9.md', LECTURE), file('Tutorial 9.md', SHEET), file('Tutorial 9 Solutions.md', SOLUTIONS)],
  });
  await service.whenIdle();
  return notebook.id;
}

describe('guessing a role when a source is read', () => {
  it('guesses lecture, tutorial and solutions, and points the solutions at the only tutorial', async () => {
    const id = await notebookWithAll();
    const sources = service.get(id)!.sources;
    expect(sources.map((s) => [s.name, s.role])).toEqual([
      ['Lecture 9.md', 'lecture'],
      ['Tutorial 9.md', 'tutorial'],
      ['Tutorial 9 Solutions.md', 'solutions'],
    ]);
    expect(sources[2]!.keyFor).toBe(sources[1]!.fileId);
    expect(sources[0]!.keyFor).toBeNull();
    expect(roleChanges.map((c) => [c.role, c.by, c.previous])).toEqual([
      ['tutorial', 'guess', 'lecture'],
      ['solutions', 'guess', 'lecture'],
    ]);
    expect(roleChanges[1]!.keyFor).toBe(sources[1]!.fileId);
  });

  it('attaches solutions read before their tutorial once the tutorial is read', async () => {
    const { notebook } = await service.create({ paths: [file('Tutorial 9 Solutions.md', SOLUTIONS)] });
    await service.whenIdle();
    expect(service.get(notebook.id)!.sources[0]).toMatchObject({ role: 'solutions', keyFor: null });
    await service.addSources(notebook.id, [file('Tutorial 9.md', SHEET)]);
    await service.whenIdle();
    const [solutions, tutorial] = service.get(notebook.id)!.sources;
    expect(tutorial!.role).toBe('tutorial');
    expect(solutions!.keyFor).toBe(tutorial!.fileId);
  });

  it('leaves an existing lecture-only notebook exactly as it was: every source a lecture', async () => {
    const { notebook } = await service.create({ paths: [file('Lecture 9.md', LECTURE), file('Week 3 notes.md', LECTURE)] });
    await service.whenIdle();
    const view = service.get(notebook.id)!;
    expect(view.sources.every((s) => s.role === 'lecture' && s.keyFor === null)).toBe(true);
    expect(view.contextFingerprint).toBe(contextFingerprint(view.sources, ['lecture', 'tutorial', 'solutions']));
    expect(roleChanges).toEqual([]);
  });
});

describe('notebook:setRole', () => {
  it('retypes a source, defaults solutions to the only tutorial, and refuses a bad target', async () => {
    const id = await notebookWithAll();
    const [lecture, tutorial, solutions] = service.get(id)!.sources;
    roleChanges = [];

    const asLecture = service.setRole({ notebookId: id, fileId: solutions!.fileId, role: 'lecture' });
    expect(asLecture.sources[2]).toMatchObject({ role: 'lecture', keyFor: null });

    const back = service.setRole({ notebookId: id, fileId: solutions!.fileId, role: 'solutions', keyFor: null });
    expect(back.sources[2]).toMatchObject({ role: 'solutions', keyFor: tutorial!.fileId });
    expect(roleChanges.at(-1)).toMatchObject({ role: 'solutions', keyFor: tutorial!.fileId, by: 'learner', previous: 'lecture' });

    expect(() => service.setRole({ notebookId: id, fileId: solutions!.fileId, role: 'solutions', keyFor: lecture!.fileId })).toThrow(
      /answer a tutorial/,
    );
    expect(() => service.setRole({ notebookId: id, fileId: 'f_nope', role: 'tutorial' })).toThrow(/not in this notebook/);
    expect(() => service.setRole({ notebookId: id, fileId: lecture!.fileId, role: 'quiz' as never })).toThrow(/Unknown source role/);
  });

  it('frees solutions when their tutorial is retyped', async () => {
    const id = await notebookWithAll();
    const [, tutorial] = service.get(id)!.sources;
    const view = service.setRole({ notebookId: id, fileId: tutorial!.fileId, role: 'lecture' });
    expect(view.sources[2]).toMatchObject({ role: 'solutions', keyFor: null });
  });
});

describe('the host by role', () => {
  it('gives the overview lecture text only, the room lecture and tutorial, and nobody the solutions', async () => {
    const id = await notebookWithAll();
    const host = createNotebookHost(db, { absPath: (rel) => service.absPath(rel) });
    const room = host.deckText(id).text;
    expect(room).toContain(sourceHeader('Lecture 9.md'));
    expect(room).toContain(sourceHeader('Tutorial 9.md'));
    expect(room).not.toContain('Solutions');
    expect(room).not.toContain('lower bound');

    const overview = host.deckText(id, { roles: OVERVIEW_ROLES }).text;
    expect(overview).toContain('relaxed problem');
    expect(overview).not.toContain('Problem 1');

    expect(host.outline(id)).not.toContain('Solutions');
    const solutions = service.get(id)!.sources[2]!;
    const page = solutions.pageBase + 1;
    expect(host.textFor({ notebookId: id, pageFrom: page, pageTo: page })).toBe('');
    expect(host.textFor({ notebookId: id, pageFrom: page, pageTo: page, includeSolutions: true })).toContain('lower bound');
  });

  it('keeps the overview fingerprint when a tutorial or solutions arrive', async () => {
    const { notebook } = await service.create({ paths: [file('Lecture 9.md', LECTURE)] });
    await service.whenIdle();
    const before = service.get(notebook.id)!.contextFingerprint;
    const host = createNotebookHost(db, { absPath: (rel) => service.absPath(rel) });
    await service.addSources(notebook.id, [file('Tutorial 9.md', SHEET), file('Tutorial 9 Solutions.md', SOLUTIONS)]);
    await service.whenIdle();
    expect(service.get(notebook.id)!.contextFingerprint).toBe(before);
    expect(host.subject(notebook.id)!.fingerprint).toBe(before);
    // Retyping the tutorial as a lecture does change it: now the overview does not cover it.
    const tutorial = service.get(notebook.id)!.sources[1]!;
    expect(service.setRole({ notebookId: notebook.id, fileId: tutorial.fileId, role: 'lecture' }).contextFingerprint).not.toBe(before);
  });
});

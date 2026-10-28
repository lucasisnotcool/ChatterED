/**
 * A tutorial end to end in main (`TUTORIAL-CONTRACT.md` S2–S4, S6): the scripted read into its
 * document and part records, checks routed to code or the model, help up the ladder, reveal,
 * re-read, solutions, and the gaps — against a real migrated SQLite, the real notebook host, and
 * a fake actor that records its tutorial turns.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Node } from 'prosemirror-model';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase, type SqlDatabase } from '../db/driver.js';
import { runMigrations } from '../db/migrations.js';
import { newDocId, notesRepo } from '../db/repos/notes.js';
import { outcomesRepo } from '../db/repos/outcomes.js';
import { threadsRepo } from '../db/repos/threads.js';
import { ensureManagedVault } from '../vault/managed.js';
import { NotebookService } from '../notebooks/service.js';
import { createNotebookHost } from '../notebooks/host.js';
import { API_PLAN } from '../../room/llm/models.js';
import { EMPTY_USAGE, type LLMClient, type LlmRequest } from '../../room/llm/types.js';
import { authorMark, docFromJson, emptyDoc, notesSchema } from '../../shared/doc/schema.js';
import { partAnswers } from '../../shared/doc/tutorialdoc.js';
import { notebookContentKey } from '../../shared/notebook.js';
import type { LearningObjective, LearningTree } from '../../shared/objectives.js';
import { tutorialContentKey, type TutorialChange } from '../../shared/tutorial.js';
import { checkPart, judgeChoice } from './check.js';
import { listViews, tutorialRecord, type TutorialDeps, type TutorialTurnInput, type TutorialTurnStart } from './context.js';
import { helpPart } from './help.js';
import { replyInPart, tutorialPartStates } from './reply.js';
import { tutorialFocus, tutorialFocusText } from './focus.js';
import { ingestTutorial, rewriteKeys, tutorialInFlight } from './ingest.js';
import { tutorialRepo } from './repo.js';
import { tutorialGaps } from './view.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations', import.meta.url));

let tmp = '';
let db: SqlDatabase;
let service: NotebookService;
let deps: TutorialDeps;
let pushed: TutorialChange[];
let turns: TutorialTurnInput[];
let actorReply: (input: TutorialTurnInput) => Omit<TutorialTurnStart, 'turn'>;
let llm: LLMClient | null;
let notebookId = '';
let tutorialId = '';
let notesBlockId = '';

function objective(id: string, title: string, pages: number[], order: number): LearningObjective {
  return {
    id,
    fileId: 'nb',
    title,
    kind: 'objective',
    statement: '',
    criteria: [],
    quizSeeds: [],
    refs: pages.map((page) => ({ page })),
    parentId: null,
    requires: [],
    assumedByDeck: false,
    order,
  };
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'chattered-tutorial-'));
  const outside = join(tmp, 'Desktop');
  mkdirSync(outside);
  db = openTestDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  const root = join(tmp, 'userData', 'notebooks');
  ensureManagedVault(db, root, '2026-10-01T00:00:00.000Z');
  service = new NotebookService({ db, root, confirm: async () => true });
  const lecture = join(outside, 'Lecture 9.md');
  writeFileSync(lecture, 'Planning with STRIPS.\n\nThe relaxed problem ignores delete lists.');
  const sheet = join(outside, 'Tutorial 9.md');
  writeFileSync(sheet, 'Tutorial 9\n\nProblem 1\nGive a plan.\n\nProblem 2\nExplain relaxation.');
  const { notebook } = await service.create({ paths: [lecture, sheet] });
  await service.whenIdle();
  notebookId = notebook.id;
  tutorialId = service.get(notebookId)!.sources[1]!.fileId;

  // The notebook's own notes: a title and one paragraph, which the scripted read links to.
  const doc = emptyDoc('Planning');
  notesBlockId = 'b_notes0000001';
  const para = notesSchema.nodes.paragraph!.create(
    { blockId: notesBlockId, pages: [1], reason: null, objectiveIds: [] },
    notesSchema.text('Relaxation drops delete lists.', [authorMark('ingest', null)]),
  );
  const nbDoc = notesSchema.nodes.doc!.create(null, [doc.firstChild!, para]);
  notesRepo(db).create(
    {
      id: newDocId(),
      contentSha: notebookContentKey(notebookId),
      fileId: notebookId,
      title: 'Planning',
      pageCount: 2,
      doc: nbDoc.toJSON(),
      ingestStatus: 'ready',
      ingestVersion: 1,
      windowsTotal: 1,
      withImages: false,
      model: 'fixture',
    },
    '2026-10-03T00:00:00.000Z',
  );

  const tree: LearningTree = {
    fileId: notebookId,
    contentSha: notebookContentKey(notebookId),
    generatedAt: '',
    model: 'fixture',
    version: 1,
    status: 'ready',
    objectives: [objective('obj_a', 'Write a STRIPS plan', [1], 0), objective('obj_b', 'Explain relaxed planning', [1], 1)],
  };
  pushed = [];
  turns = [];
  llm = null;
  actorReply = (input) => ({ accepted: true, reason: null, threadId: input.anchorId });
  const host = createNotebookHost(db, { absPath: (rel) => service.absPath(rel) });
  deps = {
    db,
    notebooks: host,
    userDataDir: join(tmp, 'userData'),
    llm: () => llm,
    models: () => API_PLAN,
    geometry: async () => [],
    objectivesTree: () => tree,
    push: (c) => pushed.push(c),
    openRoom: async () => ({
      roomId: 'room_1',
      actor: {
        tutorialTurn: async (input: TutorialTurnInput): Promise<TutorialTurnStart> => {
          turns.push(input);
          return { ...actorReply(input), turn: Promise.resolve() };
        },
      },
    }),
    persistFlow: () => undefined,
  };
});

afterEach(() => {
  service.dispose();
  rmSync(tmp, { recursive: true, force: true });
});

async function ingested(force = false) {
  const view = ingestTutorial(deps, { notebookId, fileId: tutorialId, force });
  await tutorialInFlight(tutorialContentKey(notebookId, tutorialId));
  return view;
}

function savedDoc(): { docId: string; version: number; doc: Node } {
  const record = tutorialRecord(deps, notebookId, tutorialId)!;
  return { docId: record.id, version: record.version, doc: docFromJson(record.doc) };
}

/** The learner writes into a part's slot: the doc saved as the renderer would save it. */
function answer(partId: string, edit: (part: Node) => Node): void {
  const { docId, version, doc } = savedDoc();
  const children: Node[] = [];
  doc.forEach((n) => children.push(n.type.name === 'tut_part' && n.attrs.partId === partId ? edit(n) : n));
  const next = notesSchema.nodes.doc!.create(null, children);
  const saved = notesRepo(db).save({ docId, baseVersion: version, doc: next.toJSON(), learnerTouched: true }, '2026-10-03T01:00:00.000Z');
  expect(saved.ok).toBe(true);
}

function slot(part: Node, content: Node): Node {
  const children: Node[] = [];
  part.forEach((c) => children.push(c.type.name === 'tut_answer' ? c.type.create(c.attrs, content) : c));
  return part.type.create(part.attrs, children);
}

function pickChoice(part: Node, picked: string[]): Node {
  const children: Node[] = [];
  part.forEach((child) => children.push(child.type.name === 'tut_choices'
    ? child.type.create({ ...child.attrs, picked }) : child));
  return part.type.create(part.attrs, children);
}

const user = () => [authorMark('user', null)];
const plan = (steps: string[]) =>
  notesSchema.nodes.ordered_list!.create(
    { blockId: '', pages: [], reason: null, objectiveIds: [] },
    steps.map((s) => notesSchema.nodes.list_item!.create(null, notesSchema.nodes.paragraph!.create(null, notesSchema.text(s, user())))),
  );
const para = (text: string) => notesSchema.nodes.paragraph!.create(null, notesSchema.text(text, user()));

describe('reading a tutorial (scripted)', () => {
  it('lands the sheet as a document with a record per part, linked into the notes', async () => {
    const first = await ingested();
    expect(first.status).toBe('pending');
    const [view] = listViews(deps, notebookId);
    expect(view).toMatchObject({ status: 'ready', title: 'Tutorial 9: Planning practice', hasSolutions: false, error: null });
    expect(view!.parts.map((p) => [p.partId, p.answerKind, p.status])).toEqual([
      ['P1a', 'code', 'untried'],
      ['P1b', 'sequence', 'untried'],
      ['P2', 'text', 'untried'],
      ['P3A.i', 'blanks', 'untried'],
      ['P3B', 'choice', 'untried'],
    ]);
    // Links: real notes blocks and lecture pages only; the first objective, so a check can fill.
    expect(view!.parts[0]!.links).toEqual({ notesBlockIds: [notesBlockId], pages: [1] });
    expect(view!.parts.every((p) => p.objectiveIds.join() === 'obj_a')).toBe(true);
    // The objective no part exercises is advertised.
    expect(view!.gaps).toEqual([{ objectiveId: 'obj_b', title: 'Explain relaxed planning', pages: [1] }]);

    const record = tutorialRecord(deps, notebookId, tutorialId)!;
    expect(record.fileId).toBe(tutorialId);
    const keys = new Map(tutorialRepo(db).parts(record.id).map((p) => [p.partId, p.key]));
    expect(keys.get('P1b')!.check?.type).toBe('plan');
    expect(keys.get('P1b')!.confidence).toBe('high');
    expect(keys.get('P3B')!.correct).toEqual(['i']);
    // Pages beyond the sheet's one page are the sheet's last page; every block cites the tutorial.
    const tutorialPage = service.get(notebookId)!.sources[1]!.pageBase + 1;
    expect(partAnswers(docFromJson(record.doc)).every((a) => a.pages.every((p) => p === tutorialPage))).toBe(true);
    expect(pushed.at(-1)!.view!.status).toBe('ready');
  });

  it('refuses a source that is not a tutorial', () => {
    const lecture = service.get(notebookId)!.sources[0]!;
    expect(() => ingestTutorial(deps, { notebookId, fileId: lecture.fileId })).toThrow(/not a tutorial/);
  });

  it('keeps the learner\'s answers and records through a re-read', async () => {
    await ingested();
    answer('P2', (p) => slot(p, para('Fewer constraints, so never harder.')));
    await checkPart(deps, { notebookId, fileId: tutorialId, partId: 'P2' });
    await ingested(true);
    const { doc } = savedDoc();
    expect(partAnswers(doc).find((a) => a.partId === 'P2')!.text).toBe('Fewer constraints, so never harder.');
    expect(listViews(deps, notebookId)[0]!.parts.find((p) => p.partId === 'P2')!.attempts).toBe(1);
  });
});

describe('checking a part', () => {
  it('says empty for an unanswered part, without opening a turn', async () => {
    await ingested();
    expect(await checkPart(deps, { notebookId, fileId: tutorialId, partId: 'P1b' })).toEqual({
      accepted: false,
      reason: 'empty',
      status: 'untried',
      threadId: null,
    });
    expect(turns).toEqual([]);
  });

  it('decides a plan by simulation, fills the objective, and has Max voice it in the part thread', async () => {
    await ingested();
    answer('P1b', (p) => slot(p, plan(['Move(X, Y, Table)', 'Move(Y, Table, X)'])));
    expect(listViews(deps, notebookId)[0]!.parts[1]!.status).toBe('working');
    const result = await checkPart(deps, { notebookId, fileId: tutorialId, partId: 'P1b' });
    expect(result).toMatchObject({ accepted: true, reason: null, status: 'correct' });
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ kind: 'feedback', partId: 'P1b', verdict: { verdict: 'complete', checkedBy: 'simulation' } });
    expect(turns[0]!.slides.map((s) => s.page)).toEqual([1]);
    expect(turns[0]!.notes.map((n) => n.blockId)).toEqual([notesBlockId]);
    const thread = threadsRepo(db).get('room_1', result.threadId!)!;
    expect(thread).toMatchObject({ kind: 'span', docId: tutorialRecord(deps, notebookId, tutorialId)!.id, blockId: turns[0]!.partBlockId });

    const rows = outcomesRepo(db).forContent(notebookContentKey(notebookId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      objectiveId: 'obj_a',
      questionId: `tut:${tutorialId}:P1b`,
      kind: 'verdict',
      verdict: 'complete',
      source: 'doc_text',
      form: 'open',
      attemptIndex: 1,
    });
    expect(listViews(deps, notebookId)[0]!.parts[1]).toMatchObject({ status: 'correct', attempts: 1, checkedBy: 'simulation' });
  });

  it('keeps a revealed part revealed when its answer is checked, and fills nothing (DG5)', async () => {
    await ingested();
    await helpPart(deps, { notebookId, fileId: tutorialId, partId: 'P1b', kind: 'reveal' });
    answer('P1b', (p) => slot(p, plan(['Move(X, Y, Table)', 'Move(Y, Table, X)'])));
    const result = await checkPart(deps, { notebookId, fileId: tutorialId, partId: 'P1b' });
    expect(result).toMatchObject({ accepted: true, status: 'revealed' });
    expect(turns.at(-1)).toMatchObject({ kind: 'feedback', verdict: { verdict: 'complete' } });
    const rows = outcomesRepo(db).forContent(notebookContentKey(notebookId));
    expect(rows.map((r) => [r.kind, r.releasedBy, r.verdict])).toEqual([['released', 'give_up', null]]);
    expect(listViews(deps, notebookId)[0]!.parts[1]!.status).toBe('revealed');
  });

  it('marks a plan that does not reach the goal incorrect and fills nothing', async () => {
    await ingested();
    answer('P1b', (p) => slot(p, plan(['Move(Y, Table, X)'])));
    const result = await checkPart(deps, { notebookId, fileId: tutorialId, partId: 'P1b' });
    expect(result.status).toBe('incorrect');
    expect(turns[0]!.verdict!.verdict).toBe('not_yet');
    expect(outcomesRepo(db).forContent(notebookContentKey(notebookId))).toEqual([]);
  });

  it('asks the model when no code check decides, and records it as the model\'s', async () => {
    await ingested();
    const calls: LlmRequest[] = [];
    llm = {
      kind: 'anthropic',
      async complete(request) {
        calls.push(request);
        return {
          text: JSON.stringify({ verdict: 'partial', detail: 'Right idea; the lower bound is not said.' }),
          model: 'claude-sonnet-5',
          usage: EMPTY_USAGE,
          ttftMs: 1,
          backend: 'anthropic',
        };
      },
    };
    answer('P2', (p) => slot(p, para('It removes constraints.')));
    const result = await checkPart(deps, { notebookId, fileId: tutorialId, partId: 'P2' });
    expect(result.status).toBe('partial');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.jsonSchema).toBeDefined();
    expect(calls[0]!.messages[0]!.content).toContain('It removes constraints.');
    expect(turns[0]!.verdict).toEqual({ verdict: 'partial', checkedBy: 'model', detail: 'Right idea; the lower bound is not said.' });
    expect(outcomesRepo(db).forContent(notebookContentKey(notebookId))[0]!.verdict).toBe('partial');
  });

  it('sends a plan the simulation rejects to the judge, with the simulation beside it', async () => {
    await ingested();
    const calls: LlmRequest[] = [];
    llm = {
      kind: 'anthropic',
      async complete(request) {
        calls.push(request);
        return {
          text: JSON.stringify({ verdict: 'complete', detail: 'Valid under the sheet: the table is always clear.' }),
          model: 'claude-sonnet-5',
          usage: EMPTY_USAGE,
          ttftMs: 1,
          backend: 'anthropic',
        };
      },
    };
    answer('P1b', (p) => slot(p, plan(['Move(Y, Table, X)'])));
    const result = await checkPart(deps, { notebookId, fileId: tutorialId, partId: 'P1b' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.messages[0]!.content).toContain('THE APP SIMULATED THIS PLAN');
    expect(result.status).toBe('correct');
    expect(turns[0]!.verdict!.checkedBy).toBe('model');
  });

  it('keeps the verdict when Max is busy, and drops the thread it made', async () => {
    await ingested();
    actorReply = (input) => ({ accepted: false, reason: 'busy', threadId: input.anchorId });
    answer('P1b', (p) => slot(p, plan(['Move(X, Y, Table)', 'Move(Y, Table, X)'])));
    const result = await checkPart(deps, { notebookId, fileId: tutorialId, partId: 'P1b' });
    expect(result).toMatchObject({ accepted: true, reason: 'busy', status: 'correct', threadId: null });
    expect(threadsRepo(db).forRoom('room_1')).toEqual([]);
  });

  it('judges a choice by its key: all and only the right ticks', () => {
    expect(judgeChoice(['i'], ['i'], true).verdict).toBe('complete');
    expect(judgeChoice(['i', 'ii'], ['i'], true).verdict).toBe('not_yet');
    expect(judgeChoice(['i'], ['i', 'iii'], true).verdict).toBe('partial');
    expect(judgeChoice([], ['i'], true).verdict).toBe('not_yet');
  });
});

describe('help on a part', () => {
  it('climbs the hint ladder to the top, then refuses; a refresher keeps the rung', async () => {
    await ingested();
    const ask = (kind: 'hint' | 'refresher' | 'reveal') => helpPart(deps, { notebookId, fileId: tutorialId, partId: 'P2', kind });
    expect(await ask('hint')).toMatchObject({ accepted: true, level: 1 });
    expect(await ask('hint')).toMatchObject({ accepted: true, level: 2 });
    expect(await ask('refresher')).toMatchObject({ accepted: true, level: null });
    expect(turns.at(-1)).toMatchObject({ kind: 'refresher', level: 2 });
    expect(await ask('hint')).toMatchObject({ accepted: true, level: 3 });
    expect(await ask('hint')).toEqual({ accepted: false, reason: 'top', level: 3, threadId: null });
    expect(turns.map((t) => [t.kind, t.level])).toEqual([
      ['hint', 1],
      ['hint', 2],
      ['refresher', 2],
      ['hint', 3],
    ]);
    // Every help lands in the part's one span thread.
    expect(new Set(turns.map((t) => t.anchorId)).size).toBe(1);
    expect(listViews(deps, notebookId)[0]!.parts.find((p) => p.partId === 'P2')!.hintLevel).toBe(3);
  });

  it('does not record a rung the actor refused', async () => {
    await ingested();
    actorReply = (input) => ({ accepted: false, reason: 'busy', threadId: input.anchorId });
    expect(await helpPart(deps, { notebookId, fileId: tutorialId, partId: 'P2', kind: 'hint' })).toMatchObject({
      accepted: false,
      reason: 'busy',
    });
    expect(listViews(deps, notebookId)[0]!.parts.find((p) => p.partId === 'P2')!.hintLevel).toBe(0);
    expect(threadsRepo(db).forRoom('room_1')).toEqual([]);
  });

  it('reveals: the part is revealed and a released row fills nothing', async () => {
    await ingested();
    const result = await helpPart(deps, { notebookId, fileId: tutorialId, partId: 'P2', kind: 'reveal' });
    expect(result.accepted).toBe(true);
    expect(turns[0]!.kind).toBe('reveal');
    expect(turns[0]!.key.answer).toContain('lower bound');
    expect(listViews(deps, notebookId)[0]!.parts.find((p) => p.partId === 'P2')!.status).toBe('revealed');
    const rows = outcomesRepo(db).forContent(notebookContentKey(notebookId));
    expect(rows.map((r) => [r.kind, r.releasedBy, r.verdict])).toEqual([['released', 'give_up', null]]);
  });
});

describe('official solutions', () => {
  it('mark every key as the official one (scripted)', async () => {
    await ingested();
    const writeSolutions = join(tmp, 'Desktop', 'Tutorial 9 Solutions.md');
    writeFileSync(writeSolutions, 'Problem 1: Move(X, Y, Table), Move(Y, Table, X).');
    await service.addSources(notebookId, [writeSolutions]);
    await service.whenIdle();
    expect(service.get(notebookId)!.sources[2]).toMatchObject({ role: 'solutions', keyFor: tutorialId });
    expect(await rewriteKeys(deps, notebookId, tutorialId)).toBe(5);
    // Scripted mode never inspected that file, so it cannot claim a verified solution.
    expect(listViews(deps, notebookId)[0]!.hasSolutions).toBe(false);
  });

  it('verifies an image-only choice only when two independent reads agree', async () => {
    await ingested();
    const path = join(tmp, 'Desktop', 'Tutorial 9 Solutions.md');
    writeFileSync(path, 'The marked answer is on the attached page image.');
    await service.addSources(notebookId, [path]);
    await service.whenIdle();
    const source = service.get(notebookId)!.sources[2]!;
    const located = deps.notebooks.locate(notebookId, source.pageBase + 1)!;
    const dir = join(deps.userDataDir, 'notes-pages', located.contentSha!);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'p-1.jpg'), 'fake-image-for-stub');
    const calls: LlmRequest[] = [];
    llm = { kind: 'anthropic', async complete(request) {
      calls.push(request);
      const visual = request.system[0]!.text.includes('Independently read');
      const parts = visual
        ? [{ partId: 'P3B', sourcePage: 1, correct: ['i'] }]
        : [{ partId: 'P3B', answer: 'i', correct: ['i'], sourcePage: 1, sourceQuote: '', steps: [], mistakes: [], prerequisites: [], blanks: [] }];
      return { text: JSON.stringify({ parts }), model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'anthropic' as const };
    } };
    expect(await rewriteKeys(deps, notebookId, tutorialId)).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.images?.length === 1)).toBe(true);
    const key = tutorialRepo(db).part(savedDoc().docId, 'P3B')!.key;
    expect(key.solutionEvidence).toEqual({ fileId: source.fileId, page: 1, method: 'image', version: 1 });
    expect(key.correct).toEqual(['i']);
  });

  it('uses a formal check to grade and brief Max when the uploaded choice key is wrong', async () => {
    await ingested();
    const path = join(tmp, 'Desktop', 'Tutorial 9 Solutions.md');
    writeFileSync(path, 'The marked answer is on the attached page image.');
    await service.addSources(notebookId, [path]);
    await service.whenIdle();
    const source = service.get(notebookId)!.sources[2]!;
    const located = deps.notebooks.locate(notebookId, source.pageBase + 1)!;
    const dir = join(deps.userDataDir, 'notes-pages', located.contentSha!);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'p-1.jpg'), 'fake-image-for-stub');
    llm = { kind: 'anthropic', async complete(request) {
      const parts = request.system[0]!.text.includes('Independently read')
        ? [{ partId: 'P3B', sourcePage: 1, correct: ['ii'] }]
        : [{ partId: 'P3B', answer: 'ii', correct: ['ii'], sourcePage: 1, sourceQuote: '', steps: [], mistakes: [], prerequisites: [], blanks: [] }];
      return { text: JSON.stringify({ parts }), model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'anthropic' as const };
    } };
    expect(await rewriteKeys(deps, notebookId, tutorialId)).toBe(1);
    expect(tutorialRepo(db).part(savedDoc().docId, 'P3B')!.key.correct).toEqual(['ii']);

    answer('P3B', (part) => pickChoice(part, ['i']));
    expect(await checkPart(deps, { notebookId, fileId: tutorialId, partId: 'P3B' })).toMatchObject({ accepted: true, status: 'correct' });
    expect(turns.at(-1)?.choice).toEqual({
      picked: ['i'], correct: ['i'], source: 'code-verified answer', suppressExplanation: true,
    });
  });

  it('uses a high-confidence worked choice key when no answer PDF exists', async () => {
    await ingested();
    const record = savedDoc();
    const current = tutorialRepo(db).part(record.docId, 'P3B')!.key;
    tutorialRepo(db).setKey(record.docId, 'P3B', {
      ...current, check: undefined, from: 'model', confidence: 'high', correct: ['i'],
    }, '2026-10-03T01:00:00.000Z');
    answer('P3B', (part) => pickChoice(part, ['i']));

    expect(await checkPart(deps, { notebookId, fileId: tutorialId, partId: 'P3B' })).toMatchObject({ accepted: true, status: 'correct' });
    expect(turns.at(-1)?.choice).toEqual({
      picked: ['i'], correct: ['i'], source: 'worked answer', suppressExplanation: false,
    });
  });

  it('checks against the worked answer when a linked partial solutions file has no answer for this part', async () => {
    await ingested();
    const path = join(tmp, 'Desktop', 'Tutorial 9 Solutions.md');
    writeFileSync(path, 'Only Problem 1 has an answer here.');
    await service.addSources(notebookId, [path]);
    await service.whenIdle();
    llm = { kind: 'anthropic', async complete(request) {
      return { text: JSON.stringify({ parts: [] }), model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'anthropic' as const };
    } };
    expect(await rewriteKeys(deps, notebookId, tutorialId)).toBe(0);
    expect(listViews(deps, notebookId)[0]!.parts.find((p) => p.partId === 'P3B')!.solutionNeedsReview).toBe(true);
    answer('P2', (p) => slot(p, para('The relaxed problem ignores delete lists.')));
    await expect(checkPart(deps, { notebookId, fileId: tutorialId, partId: 'P2' })).resolves.toMatchObject({ accepted: true });
  });
});

describe('gaps', () => {
  it('lists taught, uncovered objectives with their lecture pages, in tree order', () => {
    const objectives = [
      objective('o2', 'Second', [3, 2, 9], 2),
      objective('o1', 'First', [1], 1),
      { ...objective('o3', 'Assumed', [], 3), assumedByDeck: true },
      objective('o4', 'Only on the sheet', [9], 4),
    ];
    expect(tutorialGaps(objectives, [{ objectiveIds: ['o1'] }], (p) => p <= 5)).toEqual([
      { objectiveId: 'o2', title: 'Second', pages: [2, 3] },
    ]);
  });
});

describe('a typed reply in a part’s thread, and the parts’ states (2026-10-04)', () => {
  /** A part's own block id and the id of a block inside it. */
  function partBlocks(partId: string): { part: string; inner: string } {
    const { doc } = savedDoc();
    let found: { part: string; inner: string } | null = null;
    doc.forEach((n) => {
      if (n.type.name !== 'tut_part' || n.attrs.partId !== partId) return;
      found = { part: n.attrs.blockId as string, inner: n.firstChild!.attrs.blockId as string };
    });
    return found!;
  }

  it('routes a message on a line inside a part to its tutor as a reply, with the slot as it is now', async () => {
    await ingested();
    answer('P1b', (p) => slot(p, plan(['Move(X, Y, Table)'])));
    const { actor } = await deps.openRoom(notebookId);
    const routed = await replyInPart(
      deps,
      { roomId: 'room_1', threadId: 'span_reply', docId: savedDoc().docId, blockId: partBlocks('P1b').inner, text: 'is the order right?' },
      actor,
    );
    expect(routed).toBe(true);
    expect(turns.at(-1)).toMatchObject({ kind: 'reply', partId: 'P1b', anchorId: 'span_reply', learnerText: 'is the order right?', revealed: false });
    expect(turns.at(-1)!.answer).toContain('Move(X, Y, Table)');
  });

  it('leaves a message on a line outside every part, or on the notes, to the chat as before', async () => {
    await ingested();
    const { actor } = await deps.openRoom(notebookId);
    const { doc, docId } = savedDoc();
    const heading = doc.firstChild!.attrs.blockId as string;
    expect(await replyInPart(deps, { roomId: 'room_1', threadId: 's', docId, blockId: heading, text: 'hi' }, actor)).toBe(false);
    const notesDoc = notesRepo(db).byContentSha(notebookContentKey(notebookId))!.id;
    expect(await replyInPart(deps, { roomId: 'room_1', threadId: 's', docId: notesDoc, blockId: heading, text: 'hi' }, actor)).toBe(false);
    expect(turns).toEqual([]);
  });

  it('lists every part with the blocks inside it, unsolved until checked correct or shown', async () => {
    await ingested();
    const before = tutorialPartStates(deps, notebookId);
    expect(before.length).toBeGreaterThan(1);
    expect(before.every((p) => !p.solved)).toBe(true);
    expect(before.find((p) => p.partId === 'P1b')!.blockIds).toContain(partBlocks('P1b').inner);
    await helpPart(deps, { notebookId, fileId: tutorialId, partId: 'P2', kind: 'reveal' });
    expect(tutorialPartStates(deps, notebookId).find((p) => p.partId === 'P2')!.solved).toBe(true);
  });
});

describe('the tutorial as the main view: what the agents are told (2026-10-04)', () => {
  function innerBlock(partId: string): string {
    const { doc } = savedDoc();
    let found = '';
    doc.forEach((n) => {
      if (n.type.name === 'tut_part' && n.attrs.partId === partId) found = n.firstChild!.attrs.blockId as string;
    });
    return found;
  }

  it('is nothing for a source that is not a tutorial of this notebook', async () => {
    await ingested();
    const lecture = service.get(notebookId)!.sources[0]!.fileId;
    expect(tutorialFocus(deps, { notebookId, fileId: lecture })).toBeNull();
    expect(tutorialFocus(deps, { notebookId, fileId: 'f_nowhere' })).toBeNull();
    expect(tutorialFocus(deps, { notebookId: 'nb_other', fileId: tutorialId })).toBeNull();
  });

  it('says which sheet it is before the sheet has been read', () => {
    expect(tutorialFocus(deps, { notebookId, fileId: tutorialId })).toEqual({
      title: 'Tutorial 9',
      parts: [],
      current: null,
      notes: [],
    });
  });

  it('gives the notebook chat the sheet’s parts, their links, and the lecture notes they draw on', async () => {
    await ingested();
    const focus = tutorialFocus(deps, { notebookId, fileId: tutorialId })!;
    expect(focus.title).toBe('Tutorial 9: Planning practice');
    expect(focus.parts.map((p) => p.solved)).toEqual(focus.parts.map(() => false));
    expect(focus.parts).toHaveLength(5);
    expect(focus.parts[0]!.pages).toEqual([1]);
    expect(focus.current).toBeNull();
    // The notes block the parts link to, as the learner's notes have it.
    expect(focus.notes).toEqual([expect.objectContaining({ blockId: notesBlockId, text: 'Relaxation drops delete lists.' })]);
    // Never a key.
    const text = tutorialFocusText(deps, { notebookId, fileId: tutorialId })!;
    const keys = tutorialRepo(db).parts(tutorialRecord(deps, notebookId, tutorialId)!.id);
    for (const k of keys) if (k.key.answer.length > 12) expect(text).not.toContain(k.key.answer);
    expect(text).toContain('Relaxation drops delete lists.');
  });

  it('puts the part a line is in first, with its problem, its notes and its lecture page’s text', async () => {
    await ingested();
    const focus = tutorialFocus(deps, { notebookId, fileId: tutorialId, blockId: innerBlock('P1b') })!;
    expect(focus.current).not.toBeNull();
    expect(focus.current!.notes.map((n) => n.blockId)).toEqual([notesBlockId]);
    expect(focus.current!.slides.map((s) => s.page)).toEqual([1]);
    expect(focus.current!.slides[0]!.text).toContain('Planning with STRIPS');
    expect(focus.notes).toEqual([]);
  });

  it('marks a part done once it is shown', async () => {
    await ingested();
    await helpPart(deps, { notebookId, fileId: tutorialId, partId: 'P2', kind: 'reveal' });
    const focus = tutorialFocus(deps, { notebookId, fileId: tutorialId })!;
    const p2 = partAnswers(savedDoc().doc).findIndex((a) => a.partId === 'P2');
    expect(focus.parts[p2]!.solved).toBe(true);
  });
});


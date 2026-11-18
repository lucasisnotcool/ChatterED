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
import { logPartsStarted } from './textstart.js';
import { initLogger } from '../log.js';
import { replyInPart, tutorialPartStates } from './reply.js';
import { tutorialFocus, tutorialFocusText } from './focus.js';
import { ingestTutorial, MESSAGES, rewriteKeys, TUTORIAL_MAX_TOKENS, tutorialInFlight } from './ingest.js';
import { CREDIT_USED_UP_MESSAGE } from '../../shared/study.js';
import { REFUSAL_MESSAGE } from '../../room/llm/anthropic.js';
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
    // The first read says it is reading the sheet; a re-read says it is reading it again.
    expect((await ingested()).rereading).toBe(false);
    answer('P2', (p) => slot(p, para('Fewer constraints, so never harder.')));
    await checkPart(deps, { notebookId, fileId: tutorialId, partId: 'P2' });
    expect((await ingested(true)).rereading).toBe(true);
    const { doc } = savedDoc();
    expect(partAnswers(doc).find((a) => a.partId === 'P2')!.text).toBe('Fewer constraints, so never harder.');
    expect(listViews(deps, notebookId)[0]!.parts.find((p) => p.partId === 'P2')!.attempts).toBe(1);
  });
});

/**
 * **A live read, a long sheet** (field study and its red team, 2026-11-18). The sheet is made
 * eight pages long (or as long as a case needs) by a host that says so, and the client answers in
 * the shapes the API path gives: an answer that ran out of tokens comes back `truncated` with a
 * fragment the old unwrapping took for a sheet, a 529 is an error with `status`, and so on.
 */
describe('reading a tutorial (live, long or cut off)', () => {
  let PAGES = 8;
  let base = 0;
  let requests: LlmRequest[];
  let pageText: (k: number) => string;

  /** The host, with the tutorial `PAGES` pages of text long. */
  function longSheet(): void {
    const host = createNotebookHost(db, { absPath: (rel) => service.absPath(rel) });
    base = service.get(notebookId)!.sources[1]!.pageBase;
    const stretch = (subject: ReturnType<typeof host.subject>) =>
      subject && {
        ...subject,
        pageCount: subject.pageCount + PAGES - 1,
        sources: subject.sources.map((x) => (x.fileId === tutorialId ? { ...x, pageCount: PAGES } : x)),
      };
    deps.notebooks = new Proxy(host, {
      get(target, key) {
        if (key === 'subject') return (id: string) => stretch(target.subject(id));
        if (key === 'textFor')
          return (q: { notebookId: string; pageFrom: number; pageTo: number }) => (q.pageFrom > base ? pageText(q.pageFrom - base) : target.textFor(q));
        const v = Reflect.get(target, key) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  }

  const reply = (text: string, extra: Partial<Awaited<ReturnType<LLMClient['complete']>>> = {}) => ({
    text,
    model: 'claude-sonnet-5-5',
    usage: EMPTY_USAGE,
    ttftMs: 1,
    backend: 'anthropic' as const,
    ...extra,
  });
  /** The logged failure: 18,000 output tokens, a 77-character fragment. */
  const cutOff = () =>
    reply('{"type":"heading","page":1,"text":"Expressions and function calls","level":2}', { truncated: true, usage: { ...EMPTY_USAGE, output_tokens: 18_000 } });

  /** The pages a read request owns, or null for any other call. */
  function pagesOf(request: LlmRequest): { from: number; to: number } | null {
    if (request.max_tokens !== TUTORIAL_MAX_TOKENS) return null;
    const m = /THIS CALL READS PAGES? (\d+)(?:–(\d+))? ONLY/.exec(request.messages[0]!.content);
    return m ? { from: Number(m[1]), to: Number(m[2] ?? m[1]) } : { from: 1, to: PAGES };
  }
  const reads = () => requests.filter((r) => pagesOf(r) !== null).map((r) => `${pagesOf(r)!.from}-${pagesOf(r)!.to}`);

  /** One part per owned page, plus a copy of the look-ahead page's, as a careless model gives. */
  function sheetFor(request: LlmRequest, per: (k: number) => Record<string, unknown>[] = (k) => [partBlock(k)], careless = true): string {
    const { from, to } = pagesOf(request)!;
    const shown = /is shown only so you can finish/.test(request.messages[0]!.content);
    const pages = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const ahead = careless && shown ? [to + 1] : [];
    const blocks = [...pages, ...ahead].flatMap(per);
    const parts = blocks.filter((b) => b.type === 'part').map((b) => keyFor(b.id as string));
    return JSON.stringify({ title: 'Finals Practice', blocks, parts });
  }
  const partBlock = (k: number, id = `P${k}`) => ({
    type: 'part', id, label: `Question ${k}`, page: k, prompt: [{ type: 'paragraph', page: k, text: pageText(k) }], answer: { kind: 'code' },
  });
  const keyFor = (partId: string) => ({
    partId, answer: `code for ${partId}`, blanks: [], correct: [], steps: [], mistakes: [], prerequisites: [], formalCheck: null, notesBlockIds: [], pages: [], objectiveIds: [],
  });
  /** A client: `read` answers a read call (default: the careless one-part-per-page model). */
  function client(read: (request: LlmRequest, n: number) => ReturnType<typeof reply> | Promise<ReturnType<typeof reply>> = (r) => reply(sheetFor(r))): LLMClient {
    let n = 0;
    return {
      kind: 'anthropic',
      async complete(request) {
        requests.push(request);
        if (pagesOf(request)) return read(request, n++);
        if (request.system[0]!.text.startsWith('You solve')) return reply(JSON.stringify({ answers: [] }));
        return reply(JSON.stringify({ parts: [] }));
      },
    };
  }

  beforeEach(() => {
    PAGES = 8;
    requests = [];
    pageText = (k) => `Question ${k}. Write a function for case ${k}, and say what it returns for an empty array.`;
    deps.backoffMs = [0];
    longSheet();
  });

  it('asks a window once more when its reply is not a whole answer, then makes it a logged notice, outside "Course admin"', async () => {
    const lines: Record<string, unknown>[] = [];
    initLogger({ sink: { write: (l: string) => void lines.push(JSON.parse(l) as Record<string, unknown>) } });
    try {
      PAGES = 2;
      longSheet();
      // Page 1's window answers "{}"-ish nonsense every time; page 2 answers once badly, then well.
      let page2 = 0;
      llm = client((request) => {
        const { from, to } = pagesOf(request)!;
        if (to - from >= 1 || from === 1) return reply('{"a":1}');
        page2 += 1;
        return page2 === 1 ? reply('{"a":1}') : reply(sheetFor(request, undefined, false));
      });
      await ingested();
      const [view] = listViews(deps, notebookId);
      expect(view!.parts.map((p) => p.partId)).toEqual(['P2']);
      // 1–2 asked twice, then cut into pages; page 1 asked twice, page 2 twice.
      expect([...reads()].sort()).toEqual(['1-1', '1-1', '1-2', '1-2', '2-2', '2-2']);
      const notice = lines.find((l) => l.event === 'tutorial.window.notice');
      expect(notice).toMatchObject({ from: 1, to: 1, reason: 'incomplete' });
      // The notice is a sheet paragraph, not housekeeping folded away.
      const para = (savedDoc().doc.toJSON().content as { attrs?: { reason?: string }; content?: { text?: string }[] }[])
        .find((n) => (n.content ?? []).some((c) => (c.text ?? '').includes('came back incomplete')));
      expect(para?.attrs?.reason).toBe('sheet');
    } finally {
      initLogger({ sink: { write: () => {} } });
    }
  });

  it('shows progress in pages from the first frame', async () => {
    llm = client();
    await ingested();
    const first = pushed.find((c) => c.view?.progress);
    expect(first!.view!.progress).toMatchObject({ done: 0, total: 8 });
  });

  it('asks the model again on Retry after "no questions", for a short sheet and a long one', async () => {
    for (const pages of [1, 8]) {
      PAGES = pages;
      longSheet();
      requests = [];
      llm = client(() => reply(JSON.stringify({ title: 'T', blocks: [], parts: [] })));
      await ingested(true);
      expect(listViews(deps, notebookId)[0]!.error).toBe(MESSAGES.noParts);
      const first = reads().length;
      expect(first).toBeGreaterThan(0);
      await ingested(true);
      expect(reads().length).toBe(first * 2);
    }
  });

  it('kills a CLI window call that never answers, asks it once more, and says it is waiting meanwhile', async () => {
    deps.cliWindowTimeoutMs = 20;
    let asked = 0;
    llm = {
      kind: 'claude-cli',
      complete: (_request, _onDelta, signal) => {
        asked += 1;
        return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('The call was stopped.'), { name: 'LlmAbortedError' }))));
      },
    };
    await ingested();
    const [view] = listViews(deps, notebookId);
    expect(view!.error).toBe("Couldn't finish reading this sheet: the connection to Claude dropped. Retry in a minute; the pages already read are kept.");
    // Two windows in flight, each asked twice.
    expect(asked).toBe(4);
    expect(pushed.some((c) => c.view?.progress?.waiting === true)).toBe(true);
    expect(view!.progress ?? null).toBeNull();
  });

  it.each([
    ['signed out', Object.assign(new Error('Claude Code is installed but not logged in.'), { name: 'ClaudeCliNotLoggedInError' }), /^Claude Code is signed out\. Open Terminal and run claude/],
    ['missing', Object.assign(new Error('The Claude CLI was not found.'), { name: 'ClaudeCliNotFoundError' }), /^Claude Code isn't installed on this Mac/],
    ['at its limit', Object.assign(new Error("The Claude CLI exited 1: You've hit your session limit · resets 3:10am (Asia/Singapore)"), { name: 'CliLimitError' }), /^Your Claude usage limit is reached for now \(it resets 3:10am\)/],
    ['a 400', Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error"}}'), { status: 400 }), /^Claude couldn't accept this request \(error 400\)/],
  ])('says plainly when the backend is %s, and asks once', async (_what, error, sentence) => {
    llm = client(() => {
      throw error;
    });
    await ingested();
    const [view] = listViews(deps, notebookId);
    expect(view!.error).toMatch(sentence);
    expect(view!.error).not.toMatch(/exited 1|\{"type"/);
    expect(reads().sort()).toEqual(['1-5', '6-8']);
  });

  it('reads a long sheet a few pages at a time, halving the window that ran out, into one sheet', async () => {
    llm = client((request) => {
      const { from, to } = pagesOf(request)!;
      // Five pages do not fit; the halves do.
      return to - from >= 4 ? cutOff() : reply(sheetFor(request));
    });
    await ingested();
    const [view] = listViews(deps, notebookId);
    expect(view!.status).toBe('ready');
    expect(view!.parts.map((p) => p.partId)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
    expect(reads()).toEqual(['1-5', '6-8', '1-3', '4-5']);
    const windowed = requests.filter((r) => pagesOf(r));
    // Each window's context is the same cached system block; its own pages are in the message,
    // with the whole page before as context.
    expect(windowed[1]!.system[1]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(windowed[1]!.messages[0]!.content).toContain('[sheet p. 6]');
    expect(windowed[1]!.messages[0]!.content).not.toContain('[sheet p. 5]');
    expect(windowed[1]!.messages[0]!.content).toContain(`PAGE 5 (context only; already read):\n${pageText(5)}`);
    // The progress moved while it read, and the record says three windows at the end.
    expect(pushed.some((c) => c.view?.status === 'pending' && c.view.progress && c.view.progress.total > 1)).toBe(true);
    const record = tutorialRecord(deps, notebookId, tutorialId)!;
    // Progress counts pages, so it never moves back when a window is cut smaller.
    expect([record.windowsDone, record.windowsTotal]).toEqual([8, 8]);
    expect(view!.progress).toBeNull();
  });

  it('lands the rest of the sheet when one page never fits, and says so where that page was', async () => {
    llm = client((request) => {
      const { from, to } = pagesOf(request)!;
      return from <= 3 && 3 <= to ? cutOff() : reply(sheetFor(request, undefined, false));
    });
    await ingested();
    const [view] = listViews(deps, notebookId);
    expect(view!.status).toBe('ready');
    expect(view!.parts.map((p) => p.partId)).toEqual(['P1', 'P2', 'P4', 'P5', 'P6', 'P7', 'P8']);
    // Page 3 cost three cut-off answers (1–5, 1–3, 3), no more.
    expect(reads().filter((r) => { const [a, b] = r.split('-').map(Number); return a! <= 3 && 3 <= b!; })).toEqual(['1-5', '1-3', '3-3']);
    const text = JSON.stringify(savedDoc().doc.toJSON());
    expect(text).toContain('Max could not read page 3 of this sheet');
    expect(text).not.toMatch(/split the PDF/i);
  });

  it('says what happened when no page fits, and never that the sheet has no questions', async () => {
    PAGES = 2;
    longSheet();
    llm = client(() => cutOff());
    await ingested();
    const [view] = listViews(deps, notebookId);
    expect(view!.status).toBe('failed');
    expect(view!.error).not.toBe(MESSAGES.noParts);
    expect(view!.error).toMatch(/^Couldn't read this sheet\. Max could not read pages 1 and 2 of this sheet: each holds more than one answer can carry/);
    expect(view!.error).not.toMatch(/split the PDF/i);
    // The whole sheet, then each page: three answers, no repeat.
    expect(reads()).toEqual(['1-2', '1-1', '2-2']);
  });

  it('keeps the windows read when the transport fails, says so plainly, and a Retry pays only for the rest', async () => {
    const overloaded = Object.assign(new Error('529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'), { status: 529 });
    llm = client((request) => {
      if (pagesOf(request)!.from === 6) throw overloaded;
      return reply(sheetFor(request));
    });
    await ingested();
    let [view] = listViews(deps, notebookId);
    expect(view!.status).toBe('failed');
    expect(view!.error).toBe("Couldn't finish reading this sheet: Claude is overloaded right now. Retry in a minute; the pages already read are kept.");
    // 1–5 once; 6–8 twice (one wait between), never more over a failing transport.
    expect(reads().filter((r) => r === '1-5')).toHaveLength(1);
    expect(reads().filter((r) => r === '6-8')).toHaveLength(2);

    requests = [];
    llm = client();
    await ingested(true);
    [view] = listViews(deps, notebookId);
    expect(view!.status).toBe('ready');
    expect(reads()).toEqual(['6-8']);
    expect(view!.parts).toHaveLength(8);
  });

  it('resumes a read the app quit in the middle of', async () => {
    llm = client((request) => {
      // The quit: the second window never answers, and nothing after it runs.
      if (pagesOf(request)!.from === 6) throw Object.assign(new Error('The Claude CLI exited 1: You have hit your limit'), { name: 'CliLimitError' });
      return reply(sheetFor(request));
    });
    await ingested();
    // On relaunch the row is `pending` with nothing running: the next open reads it again.
    notesRepo(db).setIngest(tutorialRecord(deps, notebookId, tutorialId)!.id, { status: 'pending', error: null }, '2026-10-03T02:00:00.000Z');
    requests = [];
    llm = client();
    await ingested();
    expect(listViews(deps, notebookId)[0]!.status).toBe('ready');
    expect(reads()).toEqual(['6-8']);
    // Landed: a later Read again is a fresh read.
    requests = [];
    await ingested(true);
    expect(reads()).toEqual(['1-5', '6-8']);
  });

  it('waits out a 429 and goes on', async () => {
    llm = client((request, n) => {
      if (n === 0) throw Object.assign(new Error('429 rate_limit_error'), { status: 429 });
      return reply(sheetFor(request));
    });
    await ingested();
    expect(listViews(deps, notebookId)[0]!.status).toBe('ready');
    expect(reads().sort()).toEqual(['1-5', '1-5', '6-8']);
  });

  it('says the credit is used up as the credit says it, and does not ask again', async () => {
    llm = client(() => {
      throw Object.assign(new Error(CREDIT_USED_UP_MESSAGE), { name: 'StudyCreditUsedUpError' });
    });
    await ingested();
    const [view] = listViews(deps, notebookId);
    expect(view!.error).toBe(CREDIT_USED_UP_MESSAGE);
    // Each window in flight asked once; none asked again.
    expect(reads().sort()).toEqual(['1-5', '6-8']);
  });

  it('makes a page Claude declines a notice, without "ask a different way"', async () => {
    llm = client((request) => {
      if (pagesOf(request)!.from === 6) throw new Error(REFUSAL_MESSAGE);
      return reply(sheetFor(request, undefined, false));
    });
    await ingested();
    const [view] = listViews(deps, notebookId);
    expect(view!.status).toBe('ready');
    expect(view!.parts.map((p) => p.partId)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
    const text = JSON.stringify(savedDoc().doc.toJSON());
    expect(text).toContain('Max could not read pages 6–8 of this sheet: Claude declined to work on them.');
    expect(text).not.toContain('different way');
    expect(reads()).toEqual(['1-5', '6-8']);
  });

  it('asks again, once, for a window that came back empty though its pages have words', async () => {
    llm = client((request, n) => {
      if (pagesOf(request)!.from === 6 && !/copied nothing/.test(request.messages[0]!.content)) {
        return reply(JSON.stringify({ title: 'Finals Practice', blocks: [], parts: [] }));
      }
      void n;
      return reply(sheetFor(request));
    });
    await ingested();
    expect(reads()).toEqual(['1-5', '6-8', '6-8']);
    expect(listViews(deps, notebookId)[0]!.parts).toHaveLength(8);
  });

  it('gives a part whose stem is on the page before that stem, to read and to re-solve', async () => {
    pageText = (k) => (k === 5 ? 'Problem 5. long moo(long a[], long n) { while (i < n) { a[i] += a[i-1]; } }' : k === 6 ? '(b) What is a[2] after moo returns?' : `Question ${k}. Write a function.`);
    llm = client((request) =>
      reply(
        sheetFor(request, (k) =>
          k === 5
            ? [{ type: 'heading', page: 5, level: 2, text: 'Problem 5' }, { type: 'code', page: 5, text: 'long moo(long a[], long n) { while (i < n) { a[i] += a[i-1]; } }' }, partBlock(5, 'P5a')]
            : k === 6
              ? [partBlock(6, 'P5b')]
              : [partBlock(k)],
        ),
      ),
    );
    await ingested();
    const second = requests.find((r) => pagesOf(r)?.from === 6)!;
    expect(second.messages[0]!.content).toContain('long moo(long a[], long n)');
    const resolve = requests.find((r) => r.system[0]!.text.startsWith('You solve') && r.messages[0]!.content.includes('PART P5b'))!;
    const p5b = resolve.messages[0]!.content.split('PART P5b')[1]!;
    expect(p5b).toContain('THE PROBLEM, as the sheet sets it out before this part');
    expect(p5b).toContain('long moo(long a[], long n)');
  });

  it('reads a file past the page limit to the limit, and says so at the end of the sheet', async () => {
    PAGES = 70;
    longSheet();
    llm = client();
    await ingested();
    const [view] = listViews(deps, notebookId);
    expect(view!.status).toBe('ready');
    expect(view!.parts).toHaveLength(60);
    expect(Math.max(...reads().map((r) => Number(r.split('-')[1])))).toBe(60);
    expect(JSON.stringify(savedDoc().doc.toJSON())).toContain('This file has 70 pages; Max read the first 60.');
  });

  it('carries a learner\'s answers through a re-read in windows of a sheet read before windows', async () => {
    // Read once, as before this change (the scripted reader, P-style ids), and answered.
    const short = deps.notebooks;
    deps.notebooks = createNotebookHost(db, { absPath: (rel) => service.absPath(rel) });
    llm = null;
    await ingested();
    answer('P2', (p) => slot(p, para('Fewer constraints, so never harder.')));
    deps.notebooks = short;
    llm = client();
    await ingested(true);
    const { doc } = savedDoc();
    expect(partAnswers(doc).find((a) => a.partId === 'P2')!.text).toBe('Fewer constraints, so never harder.');
  });

  it('sends an image tutorial its image, not "no images attached"', async () => {
    const png = join(tmp, 'Desktop', 'Question.png');
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await service.addSources(notebookId, [png]);
    await service.whenIdle();
    const image = service.get(notebookId)!.sources.find((s) => s.name === 'Question.png')!;
    service.setRole({ notebookId, fileId: image.fileId, role: 'tutorial' });
    deps.notebooks = createNotebookHost(db, { absPath: (rel) => service.absPath(rel) });
    llm = client(() => reply(JSON.stringify({ title: 'Q', blocks: [partBlock(1)], parts: [keyFor('P1')] })));
    ingestTutorial(deps, { notebookId, fileId: image.fileId });
    await tutorialInFlight(tutorialContentKey(notebookId, image.fileId));
    const read = requests.find((r) => pagesOf(r))!;
    expect(read.images).toHaveLength(1);
    expect(read.images![0]!.path.startsWith(join(tmp, 'userData', 'notes-pages'))).toBe(true);
    expect(read.messages[0]!.content).toContain('Page images are attached for sheet pages 1');
  });

  it('reads a short sheet in the one call it always made', async () => {
    deps.notebooks = createNotebookHost(db, { absPath: (rel) => service.absPath(rel) });
    llm = client();
    await ingested();
    const one = requests.filter((r) => r.max_tokens === TUTORIAL_MAX_TOKENS);
    expect(one).toHaveLength(1);
    expect(one[0]!.system).toHaveLength(1);
    expect(one[0]!.messages[0]!.content).toMatch(/^TUTORIAL SHEET: Tutorial 9\.md \(1 page\)\. Its pages are numbered 1\.\.1 below/);
    expect(listViews(deps, notebookId)[0]!.status).toBe('ready');
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

  it('writes keys from the solutions in batches, halving a batch that ran out of tokens', async () => {
    await ingested();
    const path = join(tmp, 'Desktop', 'Tutorial 9 Solutions.md');
    writeFileSync(path, 'Worked answers for every part: relaxation ignores delete lists entirely.');
    await service.addSources(notebookId, [path]);
    await service.whenIdle();
    const sizes: number[] = [];
    llm = { kind: 'anthropic', async complete(request) {
      const ids = [...request.messages[0]!.content.matchAll(/^PART (\S+) \(/gm)].map((m) => m[1]!);
      sizes.push(ids.length);
      // More than two parts' keys do not fit.
      if (ids.length > 2) return { text: '{"parts":[{"partId":"P1a"', model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'anthropic' as const, truncated: true as const };
      const keys = ids.map((partId) => ({
        partId, answer: 'Relaxation ignores delete lists', blanks: [], correct: [], steps: [], mistakes: [], prerequisites: [],
        sourcePage: 1, sourceQuote: 'relaxation ignores delete lists entirely',
      }));
      return { text: JSON.stringify({ parts: keys }), model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'anthropic' as const };
    } };
    const rewritten = await rewriteKeys(deps, notebookId, tutorialId);
    const solved = sizes.filter((n) => n <= 2).reduce((a, b) => a + b, 0);
    expect(sizes[0]).toBeGreaterThan(2);
    expect(solved).toBe(sizes[0]);
    // Every part asked got the official key; the choice, which needs the answer sheet's page
    // images (a text source has none), was not asked.
    expect(rewritten).toBe(sizes[0]!);
  });

  it('asks an answer sheet about a part once, keeps what it verified, and settles (no call on the next open)', async () => {
    await ingested();
    const path = join(tmp, 'Desktop', 'Tutorial 9 Solutions.md');
    writeFileSync(path, 'Problem 2: relaxation ignores delete lists entirely, so it is never harder.');
    await service.addSources(notebookId, [path]);
    await service.whenIdle();
    let calls = 0;
    const solving = (fail: boolean): LLMClient => ({ kind: 'anthropic', async complete(request) {
      calls += 1;
      if (fail) throw Object.assign(new Error('network: socket hang up'), { code: 'ECONNRESET' });
      const ids = [...request.messages[0]!.content.matchAll(/^PART (\S+) \(/gm)].map((m) => m[1]!);
      // Only P2 is answered on the sheet; the others come back with no quote, so stay unverified.
      const keys = ids.map((partId) => partId === 'P2'
        ? { partId, answer: 'Relaxation ignores delete lists', blanks: [], correct: [], steps: [], mistakes: [], prerequisites: [], sourcePage: 1, sourceQuote: 'relaxation ignores delete lists entirely' }
        : { partId, answer: 'a guess', blanks: [], correct: [], steps: [], mistakes: [], prerequisites: [], sourcePage: 1, sourceQuote: '' });
      return { text: JSON.stringify({ parts: keys }), model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'anthropic' as const };
    } });
    llm = solving(false);
    expect(await rewriteKeys(deps, notebookId, tutorialId)).toBe(1);
    const first = calls;
    expect(first).toBeGreaterThan(0);
    const verified = () => listViews(deps, notebookId)[0]!.parts.filter((p) => p.verifiedSolution).map((p) => p.partId);
    expect(verified()).toEqual(['P2']);
    // The next opens: nothing to ask, so no call, and P2 stays verified.
    expect(await rewriteKeys(deps, notebookId, tutorialId)).toBe(0);
    expect(await rewriteKeys(deps, notebookId, tutorialId)).toBe(0);
    expect(calls).toBe(first);
    expect(verified()).toEqual(['P2']);

    // A changed answer sheet is asked again; a run that fails takes back nothing it verified.
    const more = join(tmp, 'Desktop', 'Tutorial 9 Solutions (part 2).md');
    writeFileSync(more, 'Problem 3: the answers to the third problem.');
    await service.addSources(notebookId, [more]);
    await service.whenIdle();
    llm = solving(true);
    const record = tutorialRecord(deps, notebookId, tutorialId)!;
    const before = tutorialRepo(db).part(record.id, 'P2')!.key;
    const asked = calls;
    await rewriteKeys(deps, notebookId, tutorialId);
    expect(calls).toBeGreaterThan(asked);
    expect(tutorialRepo(db).part(record.id, 'P2')!.key).toEqual(before);
  });

  it('keeps the official keys through a re-read, and shows each batch only its answers\' pages', async () => {
    await ingested();
    const path = join(tmp, 'Desktop', 'Tutorial 9 Solutions.md');
    writeFileSync(path, 'Problem 2: relaxation ignores delete lists entirely, so it is never harder.');
    await service.addSources(notebookId, [path]);
    await service.whenIdle();
    const solutionsCalls: LlmRequest[] = [];
    llm = { kind: 'anthropic', async complete(request) {
      if (request.max_tokens === TUTORIAL_MAX_TOKENS) {
        // The re-read: the same Problem 2, and a new Problem 4.
        const part = (id: string, label: string, text: string) => ({ type: 'part', id, label, page: 1, prompt: [{ type: 'paragraph', page: 1, text }], answer: { kind: 'text' } });
        const key = (partId: string) => ({ partId, answer: 'model key', blanks: [], correct: [], steps: [], mistakes: [], prerequisites: [], formalCheck: null, notesBlockIds: [], pages: [], objectiveIds: [] });
        return { text: JSON.stringify({ title: 'Tutorial 9', blocks: [part('P2', 'Problem 2', 'Why does ignoring delete lists give an admissible heuristic?'), part('P4', 'Problem 4', 'Name one relaxation.')], parts: [key('P2'), key('P4')] }), model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'anthropic' as const };
      }
      if (request.system[0]!.text.startsWith('You are given')) solutionsCalls.push(request);
      const ids = [...request.messages[0]!.content.matchAll(/^PART (\S+) \(/gm)].map((m) => m[1]!);
      const keys = ids.map((partId) => ({ partId, answer: 'Relaxation ignores delete lists', blanks: [], correct: [], steps: [], mistakes: [], prerequisites: [], sourcePage: 1, sourceQuote: partId === 'P2' ? 'relaxation ignores delete lists entirely' : '' }));
      return { text: JSON.stringify(request.system[0]!.text.startsWith('You solve') ? { answers: [] } : { parts: keys }), model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'anthropic' as const };
    } };
    await rewriteKeys(deps, notebookId, tutorialId);
    const record = tutorialRecord(deps, notebookId, tutorialId)!;
    const official = tutorialRepo(db).part(record.id, 'P2')!.key;
    expect(official.solutionEvidence?.version).toBe(1);

    solutionsCalls.length = 0;
    await ingested(true);
    // P2 kept its official key; only the new P4 was asked about.
    expect(tutorialRepo(db).part(record.id, 'P2')!.key).toEqual(official);
    expect(solutionsCalls).toHaveLength(1);
    expect([...solutionsCalls[0]!.messages[0]!.content.matchAll(/^PART (\S+) \(/gm)].map((m) => m[1])).toEqual(['P4']);
  });

  it('runs one solutions pass at a time per sheet', async () => {
    await ingested();
    const path = join(tmp, 'Desktop', 'Tutorial 9 Solutions.md');
    writeFileSync(path, 'Problem 2: relaxation ignores delete lists entirely.');
    await service.addSources(notebookId, [path]);
    await service.whenIdle();
    let calls = 0;
    llm = { kind: 'anthropic', async complete(request) {
      calls += 1;
      await new Promise((r) => setTimeout(r, 5));
      return { text: JSON.stringify({ parts: [] }), model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'anthropic' as const };
    } };
    const [a, b] = await Promise.all([rewriteKeys(deps, notebookId, tutorialId), rewriteKeys(deps, notebookId, tutorialId)]);
    expect(a).toBe(b);
    const once = calls;
    await rewriteKeys(deps, notebookId, tutorialId);
    // The first pass asked; the shared one did not; a later one finds every part settled.
    expect(once).toBeGreaterThan(0);
    expect(calls).toBe(once);
  });

  it('leaves a choice it could only verify from the answer sheet\'s images until those images are there', async () => {
    await ingested();
    const path = join(tmp, 'Desktop', 'Tutorial 9 Solutions.pdf.md');
    writeFileSync(path, 'Problem 3B is answered with a tick on the scanned page.');
    await service.addSources(notebookId, [path]);
    await service.whenIdle();
    const asked: string[] = [];
    llm = { kind: 'anthropic', async complete(request) {
      asked.push(...[...request.messages[0]!.content.matchAll(/^PART (\S+) \(/gm)].map((m) => m[1]!));
      return { text: JSON.stringify({ parts: [] }), model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'anthropic' as const };
    } };
    await rewriteKeys(deps, notebookId, tutorialId);
    // No page images (a text source has none): the choice P3B is neither asked about nor settled.
    expect(asked).not.toContain('P3B');
    const record = tutorialRecord(deps, notebookId, tutorialId)!;
    expect(tutorialRepo(db).part(record.id, 'P3B')!.key.solutionsTried).toBeUndefined();
    expect(tutorialRepo(db).part(record.id, 'P2')!.key.solutionsTried?.done).toBe(true);
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


describe('the field-study log (docs/group/field-study.md, "What must be added")', () => {
  /** Every line the logger writes during the test, parsed. */
  function captureLog(): Record<string, unknown>[] {
    const lines: Record<string, unknown>[] = [];
    initLogger({ sink: { write: (l: string) => void lines.push(JSON.parse(l) as Record<string, unknown>) } });
    return lines;
  }
  afterEach(() => void initLogger({ sink: { write: () => {} } }));

  it('says whether a help request came with an attempt, by its size and never its words', async () => {
    await ingested();
    const lines = captureLog();
    await helpPart(deps, { notebookId, fileId: tutorialId, partId: 'P2', kind: 'hint' });
    answer('P2', (p) => slot(p, para('Fewer constraints.')));
    await helpPart(deps, { notebookId, fileId: tutorialId, partId: 'P2', kind: 'hint' });
    const help = lines.filter((l) => l.event === 'tutorial.help');
    expect(help.map((l) => [l.attempt_present, l.attempt_chars])).toEqual([
      [false, 0],
      [true, 'Fewer constraints.'.length],
    ]);
    expect(JSON.stringify(lines)).not.toContain('Fewer constraints');
  });

  it('logs the first text in a slot once, with its part and size', async () => {
    await ingested();
    const lines = captureLog();
    const empty = tutorialRecord(deps, notebookId, tutorialId)!;
    answer('P2', (p) => slot(p, para('Fewer constraints.')));
    const once = tutorialRecord(deps, notebookId, tutorialId)!;
    logPartsStarted(empty, once.doc, true);
    answer('P2', (p) => slot(p, para('Fewer constraints, so never harder.')));
    logPartsStarted(once, tutorialRecord(deps, notebookId, tutorialId)!.doc, true);
    const started = lines.filter((l) => l.event === 'tutorial.text_started');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ file_id: tutorialId, part_id: 'P2', attempt_chars: 'Fewer constraints.'.length, learner_touched: true });
    expect(JSON.stringify(lines)).not.toContain('Fewer');
  });
});

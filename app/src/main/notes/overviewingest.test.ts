/**
 * The overview's run (`notebooks.md` §3.5, §2; contract C2, C5, C6; #58), against a fake model, a
 * fake notebook host and a real migrated database.
 */
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openTestDb } from '../../test-support/db.js';
import { notesRepo, type NotesRepo } from '../db/repos/notes.js';
import type { LocalStore } from '../db/store.js';
import type { SqlDatabase } from '../db/driver.js';
import type { DocRoomEvent } from '../../shared/docevents.js';
import { NOTE_SLOT_REASON } from '../../shared/doc/types.js';
import { authorMark, blockAttrs, docFromJson, emptyDoc, notesSchema } from '../../shared/doc/schema.js';
import { notebookContentKey } from '../../shared/notebook.js';
import type { LearningTree } from '../../shared/objectives.js';
import type { LLMClient, LlmRequest } from '../../room/llm/types.js';
import { EMPTY_USAGE } from '../../room/llm/types.js';
import { API_PLAN } from '../../room/llm/models.js';
import { objectiveIdFor } from '../objectives/repair.js';
import { ensureTree } from '../objectives/ingest.js';
import {
  ensureOverview,
  evidentiaryImages,
  isLegacyDoc,
  overviewInFlight,
  setRecommendationStatus,
  updateOverview,
  type OverviewDeps,
} from './overviewingest.js';
import { NOTES_PROMPT_VERSION } from './prompts.js';
import { fakeNotebook, slides, type FakeNotebook } from './fakenotebook.test-support.js';
import { EARLIER_NOTES_HEADING } from './overview.js';
import { storeNotebookPageImages } from './ipc.js';
import { notebookPageLines } from './pagelines.js';
import { clearPageLinesCache } from './pagelines.js';
import { clearPageCache } from '../vault/pagecache.js';
import { pageImageDir } from './pageimages.js';

const NB = 'nb_0123456789ab';
const KEY = notebookContentKey(NB);
const T0 = '2026-10-01T10:00:00.000Z';

/** A clean overview over pages 1..20 of the first source. */
function answer(over: Record<string, unknown> = {}): string {
  const section = (heading: string, pages: number[], rec: unknown = null) => ({
    heading,
    pages,
    takeaway: `The point of ${heading}.`,
    ideas: pages.map((p) => ({ text: `An idea on page ${p}.`, pages: [p] })),
    recommendation: rec,
  });
  return JSON.stringify({
    title: 'Real World Planning and Acting',
    lede: { text: 'Planning when the world is big. Heuristics and abstraction make it tractable.', pages: [1, 2] },
    objectives: [
      { title: 'Explain why h_max is admissible', statement: 's', criteria: ['a', 'b'], quizSeeds: ['Why is h_max admissible?'], pages: [3, 4] },
      { title: 'Compare h_add and h_FF', statement: 's', criteria: ['a', 'b'], quizSeeds: ['How do h_add and h_FF differ?'], pages: [5] },
      { title: 'Describe abstraction in planning', statement: 's', criteria: ['a', 'b'], quizSeeds: ['What does abstraction drop?'], pages: [8] },
      { title: 'Explain hierarchical task networks', statement: 's', criteria: ['a', 'b'], quizSeeds: ['What is an HTN method?'], pages: [12] },
    ],
    sections: [
      section('Heuristics', [3, 4], { kind: 'flashcards', title: 'Planning heuristics', description: 'Cards on h_max, h_add and h_FF.' }),
      section('Relaxed plans', [5, 6]),
      section('Abstraction', [8]),
      section('Hierarchies', [12, 13], { kind: 'diagram', title: 'An HTN decomposition', description: 'A task broken into methods.' }),
      section('Scheduling', [16]),
    ],
    next: null,
    greeting: 'I read the planning slides too. Want to start with heuristics?',
    starterQuestions: ['Why is h_max admissible?', 'What does abstraction drop?', 'What is an HTN?'],
    ...over,
  });
}

interface Harness {
  deps: OverviewDeps;
  repo: NotesRepo;
  store: LocalStore;
  db: SqlDatabase;
  nb: FakeNotebook;
  events: DocRoomEvent[];
  trees: LearningTree[];
  calls: LlmRequest[];
}

function harness(reply: (request: LlmRequest, n: number) => string | Promise<string> = () => answer(), over: Partial<OverviewDeps> = {}): Harness {
  const { db, store } = openTestDb();
  const repo = notesRepo(db);
  const nb = fakeNotebook(NB, [{ fileId: 'f_lecture', name: 'Lecture-complex v4.0.pdf', pageBase: 0, pages: slides(20) }]);
  const events: DocRoomEvent[] = [];
  const trees: LearningTree[] = [];
  const calls: LlmRequest[] = [];
  const llm: LLMClient = {
    kind: 'anthropic',
    async complete(request) {
      calls.push(request);
      const text = await reply(request, calls.length);
      return { text, model: 'claude-sonnet-5', usage: { ...EMPTY_USAGE, output_tokens: 900 }, ttftMs: 1, backend: 'anthropic' };
    },
  };
  const deps: OverviewDeps = {
    repo,
    objectives: store.objectives,
    llm,
    models: API_PLAN,
    mode: 'live',
    userDataDir: '/nonexistent-user-data',
    notebooks: nb.host,
    emit: (e) => events.push(e),
    onTree: (t) => trees.push(t),
    geometry: async () => [],
    now: () => T0,
    requeueMs: 1,
    ...over,
  };
  return { deps, repo, store, db, nb, events, trees, calls };
}

async function run(h: Harness, opts: { force?: boolean } = {}) {
  const record = await ensureOverview(h.deps, { notebookId: NB, roomId: null }, opts);
  await overviewInFlight(KEY);
  return record ? h.repo.byId(record.id) : null;
}

function topLevel(docJson: unknown): { type: string; text: string; pages: number[]; reason: string | null; id: string }[] {
  const out: { type: string; text: string; pages: number[]; reason: string | null; id: string }[] = [];
  docFromJson(docJson).forEach((n) => {
    const a = blockAttrs(n);
    out.push({ type: n.type.name, text: n.textContent, pages: a.pages, reason: a.reason, id: a.blockId });
  });
  return out;
}

beforeEach(() => {
  clearPageCache();
  clearPageLinesCache();
});

describe('the first overview', () => {
  it('creates the row at once, pending, then lands the whole overview in one call', async () => {
    const h = harness();
    const opened = await ensureOverview(h.deps, { notebookId: NB, roomId: null });
    expect(opened!.ingestStatus).toBe('pending');
    expect(opened!.contentSha).toBe(KEY);
    expect(opened!.fileId).toBe(NB);
    await overviewInFlight(KEY);
    const done = h.repo.byId(opened!.id)!;
    expect(done.ingestStatus).toBe('ready');
    expect(done.ingestVersion).toBe(NOTES_PROMPT_VERSION);
    expect(done.title).toBe('Real World Planning and Acting');
    expect(h.calls).toHaveLength(1);
    const call = h.calls[0]!;
    expect(call.model).toBe(API_PLAN.orchestrator);
    expect(call.meta).toMatchObject({ scope: 'notes', costScope: 'notes', fileId: NB });
    expect(call.jsonSchema).toBeDefined();
    expect(call.messages[0]!.content).toContain('[p. 20]');
    expect(call.messages[0]!.content).toMatch(/at most \d+ words/);
    // The status went pending → ready, one step.
    const statuses = h.events.filter((e) => e.type === 'notes.status').map((e) => (e as { ingest: { status: string } }).ingest.status);
    expect(statuses[0]).toBe('pending');
    expect(statuses[statuses.length - 1]).toBe('ready');
    expect(done.windowsTotal).toBe(1);
  });

  it('is in the C6 shape, with the objectives list from the tree and a slot per section', async () => {
    const h = harness();
    const done = (await run(h))!;
    const blocks = topLevel(done.doc);
    expect(blocks[0]).toMatchObject({ type: 'heading', text: 'Real World Planning and Acting', reason: 'title' });
    expect(blocks[1]).toMatchObject({ type: 'paragraph', pages: [1, 2] });
    expect(blocks[2]).toMatchObject({ type: 'heading', text: 'By the end you can', reason: 'objectives' });
    expect(blocks[3]).toMatchObject({ type: 'ordered_list', reason: 'objectives' });
    const tree = h.store.objectives.tree(NB)!;
    const list = docFromJson(done.doc).child(3);
    expect(Array.from({ length: list.childCount }, (_, i) => list.child(i).textContent)).toEqual(tree.objectives.map((o) => o.title));
    expect(blocks.filter((b) => b.type === 'heading' && b.text !== 'By the end you can' && b.reason !== 'title')).toHaveLength(5);
    const slots = blocks.filter((b) => b.reason === NOTE_SLOT_REASON);
    expect(slots).toHaveLength(5);
    expect(slots.every((s) => s.text === '' && s.pages.length > 0)).toBe(true);
    expect(blocks.every((b) => b.pages.length > 0 || b.reason !== null)).toBe(true);
  });

  it('stores the OverviewMeta: fingerprint, greeting, three starters, recommendations on their headings, words against the budget', async () => {
    const h = harness();
    const done = (await run(h))!;
    const meta = done.overview!;
    expect(meta.version).toBe(1);
    expect(meta.fingerprint).toBe(h.nb.subject().fingerprint);
    expect(meta.writtenAt).toBe(T0);
    expect(meta.greeting).toContain('planning slides');
    expect(meta.starterQuestions).toHaveLength(3);
    expect(meta.recommendations.map((r) => [r.kind, r.status])).toEqual([['flashcards', 'offered'], ['diagram', 'offered']]);
    const blocks = topLevel(done.doc);
    expect(blocks.find((b) => b.id === meta.recommendations[0]!.headingBlockId)!.text).toBe('Heuristics');
    expect(blocks.find((b) => b.id === meta.recommendations[1]!.headingBlockId)!.text).toBe('Hierarchies');
    expect(meta.wordBudget).toBe(200);
    expect(meta.words).toBeGreaterThan(30);
  });

  it('writes the notebook\'s tree: flat, stable ids from the content key, refs the objective\'s pages (C5)', async () => {
    const h = harness();
    const done = (await run(h))!;
    const tree = h.store.objectives.tree(NB)!;
    expect(tree.status).toBe('ready');
    expect(tree.contentSha).toBe(KEY);
    expect(tree.objectives).toHaveLength(4);
    expect(tree.objectives.every((o) => o.parentId === null && o.requires.length === 0 && o.fileId === NB)).toBe(true);
    expect(tree.objectives.map((o) => o.order)).toEqual([1, 2, 3, 4]);
    expect(tree.objectives[0]!.id).toBe(objectiveIdFor(KEY, 'Explain why h_max is admissible'));
    expect(tree.objectives[0]!.refs.map((r) => r.page)).toEqual([3, 4]);
    expect(h.trees.at(-1)!.status).toBe('ready');
    // …and the objective → block map, by page intersection.
    expect(h.repo.objectiveBlocks(done.id).length).toBeGreaterThan(0);
  });

  it('never runs the whole-deck objective ingest for a notebook', async () => {
    const h = harness();
    const wrote = await ensureTree(
      { store: h.store, llm: h.deps.llm, models: API_PLAN, mode: 'live' },
      { fileId: NB, contentSha: KEY, title: 't', outline: '', text: 'x', fileName: null },
    );
    expect(wrote).toBe(false);
    expect(h.calls).toHaveLength(0);
    expect(h.store.objectives.tree(NB)).toBeNull();
  });

  it('creates nothing while no ticked source is ready', async () => {
    const h = harness();
    h.nb.sources[0]!.status = 'reading';
    expect(await ensureOverview(h.deps, { notebookId: NB, roomId: null })).toBeNull();
    expect(h.repo.byContentSha(KEY)).toBeNull();
    h.nb.sources[0]!.status = 'ready';
    h.nb.sources[0]!.enabled = false;
    expect(await ensureOverview(h.deps, { notebookId: NB, roomId: null })).toBeNull();
    expect(h.calls).toHaveLength(0);
  });

  it('is not repeated once current, and a learner-touched one is never redone without force', async () => {
    const h = harness();
    const done = (await run(h))!;
    await run(h);
    expect(h.calls).toHaveLength(1);
    h.repo.markLearnerTouched(done.id, T0);
    h.repo.setIngest(done.id, { status: 'failed' }, T0);
    await run(h);
    expect(h.calls).toHaveLength(1);
    await run(h, { force: true });
    expect(h.calls).toHaveLength(2);
  });

  it('keeps a legacy doc exactly as it was: the version bump is not a reason to re-ingest', async () => {
    const h = harness();
    const legacy = h.repo.create(
      {
        id: 'doc_legacy',
        contentSha: KEY,
        fileId: NB,
        title: 'Lecture notes',
        pageCount: 20,
        doc: emptyDoc('Old full notes').toJSON(),
        ingestStatus: 'ready',
        ingestVersion: 3,
        windowsTotal: 6,
        withImages: true,
        model: 'claude-sonnet-5',
      },
      T0,
    );
    expect(isLegacyDoc(legacy)).toBe(true);
    const after = await run(h);
    expect(h.calls).toHaveLength(0);
    expect(after!.doc).toEqual(legacy.doc);
    expect(after!.overview).toBeNull();
  });

  it('turns a run that came back with nothing usable into a failed row with the reason', async () => {
    const h = harness(() => JSON.stringify({ title: 'x', sections: [] }));
    const done = (await run(h))!;
    expect(done.ingestStatus).toBe('failed');
    expect(done.error).toContain('no usable section');
  });

  it('re-queues a pre-empted call rather than failing it', async () => {
    const h = harness((_, n) => {
      if (n === 1) throw Object.assign(new Error('pre-empted'), { name: 'CliPreemptedError' });
      return answer();
    });
    const done = (await run(h))!;
    expect(h.calls).toHaveLength(2);
    expect(done.ingestStatus).toBe('ready');
  });

  it('condenses each source first when the text is truncated, then writes over the outlines (N+1 steps)', async () => {
    const h = harness((request) => (request.jsonSchema ? answer() : '[p. 3] heuristics\n[p. 5] relaxed plans'));
    h.nb.sources.push({ fileId: 'f_notes', name: 'Notes.md', kind: 'text', pageBase: 20, pages: ['my notes page'] });
    h.nb.truncated = true;
    const done = (await run(h))!;
    expect(h.calls).toHaveLength(3);
    expect(h.calls[0]!.jsonSchema).toBeUndefined();
    expect(h.calls[0]!.messages[0]!.content).toContain('[p. 20]');
    expect(h.calls[1]!.messages[0]!.content).toContain('[p. 21]');
    expect(h.calls[2]!.messages[0]!.content).toContain('CONDENSED');
    expect(h.calls[2]!.messages[0]!.content).toContain('=== SOURCE: Notes.md ===');
    expect(done.windowsTotal).toBe(3);
    expect(done.windowsDone).toBe(3);
  });
});

describe('Update overview (§2)', () => {
  /** Write learner text into the first section's slot and a learner paragraph, and keep an Ellie line. */
  function edit(h: Harness, docId: string): { mine: unknown; slot: unknown } {
    const record = h.repo.byId(docId)!;
    const doc = docFromJson(record.doc);
    const nodes: ReturnType<typeof doc.child>[] = [];
    doc.forEach((n) => nodes.push(n));
    const slotAt = nodes.findIndex((n) => blockAttrs(n).reason === NOTE_SLOT_REASON);
    const mark = (by: 'user' | 'ellie', editId: string | null = null) => [authorMark(by, editId, 1)];
    const slot = notesSchema.nodes.paragraph!.create({ ...nodes[slotAt]!.attrs }, notesSchema.text('My own **note** on heuristics.', mark('user')));
    const mine = notesSchema.nodes.paragraph!.create({ blockId: 'b_mine', pages: [9], reason: null, objectiveIds: [] }, notesSchema.text('A thought about nothing in particular.', mark('user')));
    const kept = notesSchema.nodes.paragraph!.create({ blockId: 'b_kept', pages: [3], reason: null, objectiveIds: [] }, notesSchema.text('Ellie: kept line.', mark('ellie', 'e_kept')));
    const applied = notesSchema.nodes.paragraph!.create({ blockId: 'b_applied', pages: [3], reason: null, objectiveIds: [] }, notesSchema.text('Ellie: never kept.', mark('ellie', 'e_applied')));
    nodes.splice(slotAt, 1, kept, applied, slot);
    // A paragraph after the lede, under no section: it can only go under Earlier notes.
    nodes.splice(2, 0, mine);
    const next = notesSchema.nodes.doc!.create(null, nodes);
    const saved = h.repo.save({ docId, baseVersion: record.version, doc: next.toJSON(), learnerTouched: true }, T0);
    expect(saved.ok).toBe(true);
    h.db
      .prepare(
        `INSERT INTO notes_doc_edits (edit_id, doc_id, room_id, author, cause, ops_json, why, status, block_ids, doc_version, created_at)
         VALUES ('e_kept', @doc, NULL, 'ellie', 'block_action', '[]', '', 'kept', '["b_kept"]', 1, 'now'),
                ('e_applied', @doc, NULL, 'ellie', 'block_action', '[]', '', 'applied', '["b_applied"]', 1, 'now')`,
      )
      .run({ doc: docId });
    return { mine: mine.toJSON(), slot: slot.toJSON() };
  }

  it('rewrites the overview from the sources ticked now and carries what the learner owns', async () => {
    const h = harness((_, n) => (n === 1 ? answer() : answer({ title: 'Planning, updated' })));
    const first = (await run(h))!;
    const { mine, slot } = edit(h, first.id);
    h.nb.sources.push({ fileId: 'f_notes', name: 'Notes.md', kind: 'text', pageBase: 20, pages: ['my notes'] });

    const result = await updateOverview(h.deps, { notebookId: NB, roomId: null });
    expect(result).toEqual({ started: true, reason: null });
    await overviewInFlight(KEY);
    const updated = h.repo.byId(first.id)!;
    expect(updated.ingestStatus).toBe('ready');
    expect(updated.title).toBe('Planning, updated');
    expect(updated.overview!.fingerprint).toBe(h.nb.subject().fingerprint);
    expect(updated.overview!.fingerprint).not.toBe(first.overview!.fingerprint);
    expect(h.calls[1]!.messages[0]!.content).toContain('Notes.md');

    const doc = docFromJson(updated.doc);
    const json: unknown[] = [];
    doc.forEach((n) => json.push(n.toJSON()));
    // The learner's words, byte-identical.
    const carriedSlot = json.find((n) => JSON.stringify(n).includes('My own')) as { content: unknown };
    expect(carriedSlot.content).toEqual((slot as { content: unknown }).content);
    expect(json).toContainEqual(mine);
    const blocks = topLevel(updated.doc);
    // The slot stands in the new Heuristics section; the kept line is just above it.
    const heur = blocks.findIndex((b) => b.text === 'Heuristics');
    const keptAt = blocks.findIndex((b) => b.id === 'b_kept');
    const slotAt = blocks.findIndex((b) => b.text.startsWith('My own'));
    expect(keptAt).toBeGreaterThan(heur);
    expect(slotAt).toBe(keptAt + 1);
    expect(blocks[slotAt + 1]!.type).toBe('heading');
    // The never-kept edit is gone, from the doc and from the edits table.
    expect(blocks.some((b) => b.id === 'b_applied')).toBe(false);
    expect(h.repo.edits(first.id).map((e) => e.editId)).toEqual(['e_kept']);
    // The unmatched learner paragraph is under a final Earlier notes.
    const earlier = blocks.findIndex((b) => b.text === EARLIER_NOTES_HEADING);
    expect(earlier).toBeGreaterThan(slotAt);
    expect(blocks[earlier + 1]!.id).toBe('b_mine');
    // learnerTouched is kept: an update is not a reason to forget the learner wrote here.
    expect(updated.learnerTouched).toBe(true);
  });

  it('keeps the progress of objectives whose titles survive', async () => {
    const h = harness();
    const first = (await run(h))!;
    const id = h.store.objectives.tree(NB)!.objectives[0]!.id;
    h.store.objectives.setLevel({ fileId: NB, objectiveId: id, level: 2, movedAt: T0 });
    await updateOverview(h.deps, { notebookId: NB, roomId: null });
    await overviewInFlight(KEY);
    expect(h.store.objectives.state(NB, id)!.level).toBe(2);
    expect(h.repo.byId(first.id)!.ingestStatus).toBe('ready');
  });

  it('turns a legacy doc into an overview, carrying the learner\'s text', async () => {
    const h = harness();
    const old = notesSchema.nodes.doc!.create(null, [
      notesSchema.nodes.heading!.create({ blockId: 'b_t', level: 1, pages: [], reason: 'title', objectiveIds: [] }, notesSchema.text('Old', [authorMark('ingest', null, 1)])),
      notesSchema.nodes.heading!.create({ blockId: 'b_h', level: 2, pages: [3], reason: null, objectiveIds: [] }, notesSchema.text('Heuristics', [authorMark('ingest', null, 1)])),
      notesSchema.nodes.paragraph!.create({ blockId: 'b_old', pages: [3], reason: null, objectiveIds: [] }, notesSchema.text('Long old ingest prose.', [authorMark('ingest', null, 1)])),
      notesSchema.nodes.paragraph!.create({ blockId: 'b_me', pages: [3], reason: null, objectiveIds: [] }, notesSchema.text('I wrote this.', [authorMark('user', null, 1)])),
    ]);
    const legacy = h.repo.create(
      { id: 'doc_legacy', contentSha: KEY, fileId: NB, title: 'Old', pageCount: 20, doc: old.toJSON(), ingestStatus: 'ready', ingestVersion: 3, windowsTotal: 6, withImages: false, model: 'm' },
      T0,
    );
    await updateOverview(h.deps, { notebookId: NB, roomId: null });
    await overviewInFlight(KEY);
    const now = h.repo.byId(legacy.id)!;
    expect(now.overview).not.toBeNull();
    expect(isLegacyDoc(now)).toBe(false);
    const blocks = topLevel(now.doc);
    expect(blocks.some((b) => b.id === 'b_old')).toBe(false);
    const heur = blocks.findIndex((b) => b.text === 'Heuristics');
    expect(blocks.findIndex((b) => b.id === 'b_me')).toBeGreaterThan(heur);
  });

  it('refuses while a run is in flight, with nothing ticked, and with no doc', async () => {
    const h = harness();
    expect(await updateOverview(h.deps, { notebookId: NB, roomId: null })).toEqual({ started: false, reason: 'no_doc' });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = harness(async () => {
      await gate;
      return answer();
    });
    await ensureOverview(slow.deps, { notebookId: NB, roomId: null });
    expect(await updateOverview(slow.deps, { notebookId: NB, roomId: null })).toEqual({ started: false, reason: 'in_flight' });
    release();
    await overviewInFlight(KEY);
    slow.nb.sources[0]!.enabled = false;
    expect(await updateOverview(slow.deps, { notebookId: NB, roomId: null })).toEqual({ started: false, reason: 'no_sources' });
  });

  it('leaves the doc as it was, ready, with the reason, when the update fails', async () => {
    const h = harness((_, n) => {
      if (n === 1) return answer();
      throw new Error('the API said no');
    });
    const first = (await run(h))!;
    await updateOverview(h.deps, { notebookId: NB, roomId: null });
    await overviewInFlight(KEY);
    const after = h.repo.byId(first.id)!;
    expect(after.ingestStatus).toBe('ready');
    expect(after.error).toContain('the API said no');
    expect(after.doc).toEqual(first.doc);
    expect(after.overview).toEqual(first.overview);
  });
});

describe('recommendations (§5.3)', () => {
  it('marks one added or dismissed and returns the new metadata', async () => {
    const h = harness();
    const done = (await run(h))!;
    const [a, b] = done.overview!.recommendations;
    const added = setRecommendationStatus(h.deps, { docId: done.id, recommendationId: a!.id, status: 'added' })!;
    expect(added.recommendations.map((r) => r.status)).toEqual(['added', 'offered']);
    const dismissed = setRecommendationStatus(h.deps, { docId: done.id, recommendationId: b!.id, status: 'dismissed' })!;
    expect(dismissed.recommendations.map((r) => r.status)).toEqual(['added', 'dismissed']);
    expect(h.repo.byId(done.id)!.overview!.recommendations.map((r) => r.status)).toEqual(['added', 'dismissed']);
    expect(setRecommendationStatus(h.deps, { docId: 'doc_nope', recommendationId: a!.id, status: 'added' })).toBeNull();
  });
});

describe('the scripted backend (no live model)', () => {
  it('writes the Critique 1 overview through the same gate, at notebook pages', async () => {
    const h = harness(undefined, { mode: 'scripted', llm: null });
    h.nb.sources.splice(0, 1, { fileId: 'f_other', name: 'Other.pdf', pageBase: 0, pages: slides(3) });
    h.nb.sources.push({ fileId: 'f_c1', name: 'A0282987E_LohZhengLucas_Critique1_slides (1).pdf', pageBase: 3, pages: slides(7, 'btw') });
    const done = (await ensureOverview(h.deps, { notebookId: NB, roomId: null }))!;
    expect(done.ingestStatus).toBe('ready');
    expect(done.model).toBe('fixture');
    expect(done.title).toBe('/btw: whispering with your agent');
    const meta = done.overview!;
    expect(meta.starterQuestions).toHaveLength(3);
    expect(meta.greeting.length).toBeGreaterThan(0);
    expect(meta.recommendations.map((r) => r.kind)).toEqual(['diagram', 'flashcards']);
    const blocks = topLevel(done.doc);
    // Page 2 of the deck is notebook page 5.
    expect(blocks.find((b) => b.text === 'What /btw is')!.pages).toEqual([4, 5]);
    expect(blocks.filter((b) => b.reason === NOTE_SLOT_REASON)).toHaveLength(6);
    expect(h.store.objectives.tree(NB)!.objectives).toHaveLength(4);
  });

  it('writes an honest placeholder for anything else, and a live model supersedes it', async () => {
    const scripted = harness(undefined, { mode: 'scripted', llm: null });
    const placeholder = (await ensureOverview(scripted.deps, { notebookId: NB, roomId: null }))!;
    expect(placeholder.model).toBe('fixture');
    expect(placeholder.overview!.starterQuestions).toHaveLength(3);
    expect(placeholder.overview!.recommendations).toHaveLength(1);
    expect(topLevel(placeholder.doc)[1]!.reason).toBeTruthy();
    // The same database, now with a live model: the placeholder is redone.
    const live = { ...scripted.deps, mode: 'live' as const, llm: harness().deps.llm };
    const record = await ensureOverview(live, { notebookId: NB, roomId: null });
    await overviewInFlight(KEY);
    expect(scripted.repo.byId(record!.id)!.model).toBe(API_PLAN.orchestrator);
  });
});

describe('pages by notebook page (C1)', () => {
  it('stores each page image under its source\'s bytes and its own page', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'chattered-nb-images-'));
    const nb = fakeNotebook(NB, [
      { fileId: 'f_a', name: 'A.pdf', pageBase: 0, pages: slides(3) },
      { fileId: 'f_b', name: 'B.pdf', pageBase: 5, pages: slides(2) },
    ]);
    const image = (page: number) => ({ page, mime: 'image/jpeg' as const, width: 10, height: 10, bytes: new Uint8Array([1, 2, 3]) });
    const out = await storeNotebookPageImages({ notebooks: nb.host, userDataDir: userData }, NB, [image(2), image(6), image(7), image(4)]);
    expect(out).toEqual({ stored: 3, unplaced: 1 });
    expect(readdirSync(pageImageDir(userData, 'sha-f_a'))).toEqual(['p-2.jpg']);
    expect(readdirSync(pageImageDir(userData, 'sha-f_b')).sort()).toEqual(['p-1.jpg', 'p-2.jpg']);
  });

  it('reads a notebook page\'s lines from its source at its own page, numbered as asked', async () => {
    const nb = fakeNotebook(NB, [
      { fileId: 'f_a', name: 'A.pdf', pageBase: 0, pages: slides(2) },
      { fileId: 'f_n', name: 'Notes.md', kind: 'text', pageBase: 2, pages: ['text'] },
      { fileId: 'f_b', name: 'B.pdf', pageBase: 3, pages: slides(2) },
    ]);
    const asked: string[] = [];
    const extractor = async (path: string) => {
      asked.push(path);
      return [1, 2].map((page) => ({
        page,
        width: 960,
        height: 540,
        textBoxes: [{ text: `Line on local page ${page}`, x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.15, fontPt: 14, fontName: 'f' }],
        inkBoxes: [],
        chrome: [false],
        imageCount: 0,
      }));
    };
    const view = await notebookPageLines({ notebooks: nb.host }, NB, 5, extractor);
    expect(view.page).toBe(5);
    expect(view.lines.map((l) => l.text)).toEqual(['Line on local page 2']);
    expect(asked[0]).toContain('f_b');
    // A text source and a gap: empty, never a throw.
    expect(await notebookPageLines({ notebooks: nb.host }, NB, 3, extractor)).toEqual({ page: 3, width: 0, height: 0, lines: [], items: [] });
    expect(await notebookPageLines({ notebooks: nb.host }, NB, 99, extractor)).toEqual({ page: 99, width: 0, height: 0, lines: [], items: [] });
  });

  it('sends the images of the slides that leave a blank first, then the figures', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'chattered-nb-blanks-'));
    const nb = fakeNotebook(NB, [{ fileId: 'f_a', name: 'A.pdf', pageBase: 0, pages: slides(5) }]);
    const image = (page: number) => ({ page, mime: 'image/jpeg' as const, width: 10, height: 10, bytes: new Uint8Array([1]) });
    await storeNotebookPageImages({ notebooks: nb.host, userDataDir: userData }, NB, [1, 2, 3, 4, 5].map(image));
    // As Lecture-complex extracts: p. 2's "h_FF : ?" garbled mid-line, p. 3's "Max(Cost) =", p. 5
    // a drawn figure, and the rest plain text.
    const text: Record<number, string> = {
      1: 'Planning',
      2: 'Action(Slide)•ℎ:?12%%Precond: On t',
      3: 'Max(Cost) =',
      4: 'What are the estimates?',
      5: 'Air cargo',
    };
    const geometry = async () =>
      [1, 2, 3, 4, 5].map((page) => ({
        page,
        width: 960,
        height: 540,
        textBoxes: [{ text: text[page]!, x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.15, fontPt: 14, fontName: 'f' }],
        inkBoxes: page === 5 ? [{ kind: 'path' as const, x0: 0.1, y0: 0.3, x1: 0.8, y1: 0.9 }] : [],
        chrome: [false],
        imageCount: 0,
      }));
    const images = await evidentiaryImages({ notebooks: nb.host, userDataDir: userData, geometry }, NB, nb.subject().sources);
    expect(images.map((i) => i.page)).toEqual([2, 3, 5]);
  });
});


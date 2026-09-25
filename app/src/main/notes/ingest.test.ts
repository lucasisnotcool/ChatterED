/**
 * The two-pass ingest (#48, `collab-doc.md` §2), against a fake model and synthetic geometry.
 *
 * No network and no pdf.js: pass 1 has its own fixture-deck test (`extract.test.ts`), and what
 * is worth testing here is the run — that windows land in order and only ever append, that a
 * block with no provenance never reaches the document, that a learner's edits survive a better
 * prompt, and that the three ways a run is interrupted (pre-emption, a failure, an app quit) all
 * leave something the next open can continue from.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openTestDb } from '../../test-support/db.js';
import { notesRepo, type NotesRepo } from '../db/repos/notes.js';
import type { DocRoomEvent } from '../../shared/docevents.js';
import type { DocBlockDraft } from '../../shared/doc/types.js';
import { docFromJson, eachBlock, blockAttrs, notesSchema } from '../../shared/doc/schema.js';
import type { LearningTree } from '../../shared/objectives.js';
import type { PageGeometry } from '../../shared/segment/types.js';
import type { LLMClient, LlmRequest, LlmResult } from '../../room/llm/types.js';
import { EMPTY_USAGE } from '../../room/llm/types.js';
import { API_PLAN } from '../../room/llm/models.js';
import {
  ensureNotes,
  ingestInFlight,
  applyWindow,
  placeholderSuperseded,
  type NotesIngestDeps,
  type NotesIngestInput,
} from './ingest.js';
import { EditorState } from 'prosemirror-state';
import { Node as PmNode } from 'prosemirror-model';
import { appendNodes } from '../../shared/doc/ops.js';

const T0 = '2026-09-20T10:00:00.000Z';

/** A deck of `n` plain slides, enough for pass 1 to produce a title and a line per page. */
function deck(n: number): PageGeometry[] {
  return Array.from({ length: n }, (_, i) => ({
    page: i + 1,
    width: 960,
    height: 540,
    textBoxes: [
      { text: `Slide ${i + 1}`, x0: 0.08, y0: 0.08, x1: 0.6, y1: 0.16, fontPt: 32, fontName: 'f1' },
      { text: `Body of slide ${i + 1}`, x0: 0.08, y0: 0.3, x1: 0.8, y1: 0.35, fontPt: 14, fontName: 'f2' },
    ],
    inkBoxes: [],
    chrome: [false, false],
    imageCount: 0,
  }));
}

/** Blocks a window "wrote", all with clean provenance. */
function blocksFor(page: number): DocBlockDraft[] {
  return [
    { kind: 'heading', level: 2, text: `Section from p. ${page}`, prov: { pages: [page], reason: null } },
    { kind: 'paragraph', text: `Prose about slide ${page}.`, prov: { pages: [page], reason: null } },
  ];
}

interface Harness {
  deps: NotesIngestDeps;
  repo: NotesRepo;
  events: DocRoomEvent[];
  calls: LlmRequest[];
  objectivesFired: string[];
}

function harness(
  answer: (request: LlmRequest, call: number) => string | Promise<string>,
  over: Partial<NotesIngestDeps> = {},
): Harness {
  const { db } = openTestDb();
  const repo = notesRepo(db);
  const events: DocRoomEvent[] = [];
  const calls: LlmRequest[] = [];
  const objectivesFired: string[] = [];

  const llm: LLMClient = {
    kind: 'anthropic',
    async complete(request): Promise<LlmResult> {
      calls.push(request);
      const text = await answer(request, calls.length);
      return { text, model: 'claude-sonnet-5', usage: { ...EMPTY_USAGE }, ttftMs: 1, backend: 'anthropic' };
    },
  };

  const deps: NotesIngestDeps = {
    repo,
    llm,
    models: API_PLAN,
    mode: 'live',
    userDataDir: '/nonexistent-user-data',
    emit: (e) => events.push(e),
    geometry: async () => deck(20),
    ensureObjectives: (fileId) => objectivesFired.push(fileId),
    objectivesTree: () => null,
    now: () => T0,
    ...over,
  };
  return { deps, repo: deps.repo, events, calls, objectivesFired };
}

const INPUT: NotesIngestInput = {
  fileId: 'f_deck',
  contentSha: 'sha-deck',
  pageCount: 20,
  title: 'Lecture 4',
  filePath: '/decks/lecture4.pdf',
  fileName: 'lecture4.pdf',
  roomId: null,
};

/** Every window answers with two clean blocks for its first page. */
const twoCleanBlocks = (request: LlmRequest): string => {
  const page = Number(/pages (\d+)/.exec(request.messages[0]!.content)?.[1] ?? 1);
  return JSON.stringify({ blocks: blocksFor(page) });
};

async function run(h: Harness, input = INPUT, opts: { force?: boolean } = {}) {
  const record = await ensureNotes(h.deps, input, opts);
  await ingestInFlight(input.contentSha);
  return h.repo.byId(record.id)!;
}

function blockTexts(doc: unknown): string[] {
  const out: string[] = [];
  eachBlock(docFromJson(doc), (node) => {
    if (node.isTextblock && node.textContent.length > 0) out.push(node.textContent);
  });
  return out;
}

beforeEach(() => vi.restoreAllMocks());

describe('a whole run', () => {
  it('opens the document immediately and fills it in behind the windows', async () => {
    const h = harness(twoCleanBlocks);
    const opened = await ensureNotes(h.deps, INPUT);
    // §2: the doc row exists before a single token has been asked for.
    expect(opened.ingestStatus).toBe('pending');
    expect(h.calls).toHaveLength(0);
    expect(blockTexts(opened.doc)).toEqual(['Lecture 4']);

    await ingestInFlight(INPUT.contentSha);
    const done = h.repo.byId(opened.id)!;
    expect(done.ingestStatus).toBe('ready');
    expect(done.windowsDone).toBe(done.windowsTotal);
    // 20 pages at 12 max ⇒ two windows of 10.
    expect(done.windowsTotal).toBe(2);
    expect(h.calls).toHaveLength(2);
    expect(blockTexts(done.doc)).toEqual([
      'Lecture 4',
      'Section from p. 1',
      'Prose about slide 1.',
      'Section from p. 11',
      'Prose about slide 11.',
    ]);
  });

  it('emits a window event that only ever appends after the previous window’s last block', async () => {
    const h = harness(twoCleanBlocks);
    await run(h);
    const windows = h.events.filter((e) => e.type === 'notes.window');
    expect(windows).toHaveLength(2);
    // The first window has no predecessor; the second names a block the first created.
    expect(windows[0]).toMatchObject({ afterBlockId: null });
    const second = windows[1] as Extract<DocRoomEvent, { type: 'notes.window' }>;
    expect(typeof second.afterBlockId).toBe('string');
    expect(second.afterBlockId).not.toBe('');
  });

  it('moves the status from pending through streaming to ready', async () => {
    const h = harness(twoCleanBlocks);
    await run(h);
    const statuses = h.events
      .filter((e): e is Extract<DocRoomEvent, { type: 'notes.status' }> => e.type === 'notes.status')
      .map((e) => e.ingest.status);
    expect(statuses[0]).toBe('pending');
    expect(statuses).toContain('streaming');
    expect(statuses.at(-1)).toBe('ready');
  });

  it('gives every window a running outline of what has already been written', async () => {
    const h = harness(twoCleanBlocks);
    await run(h);
    expect(h.calls[0]!.messages[0]!.content).toContain('These are the opening slides');
    // Derived from the document, not asked of the model, so it cannot drift from what was written.
    expect(h.calls[1]!.messages[0]!.content).toContain('## Section from p. 1');
  });

  it('derives the objective tree after window 1, not before it', async () => {
    const h = harness(twoCleanBlocks);
    const record = await ensureNotes(h.deps, INPUT);
    expect(h.objectivesFired).toEqual([]);
    await ingestInFlight(INPUT.contentSha);
    expect(h.objectivesFired).toEqual(['f_deck']);
    expect(h.repo.byId(record.id)!.ingestStatus).toBe('ready');
  });

  it('runs on the background lane with the notes cost scope, on the orchestrator model', async () => {
    const h = harness(twoCleanBlocks);
    await run(h);
    expect(h.calls[0]!.meta).toMatchObject({ scope: 'notes', costScope: 'notes', fileId: 'f_deck' });
    expect(h.calls[0]!.model).toBe(API_PLAN.orchestrator);
    expect(h.calls[0]!.jsonSchema).toBeTruthy();
    // No images on disk here, so the ingest runs on text and geometry alone — and says so.
    expect(h.calls[0]!.images).toBeUndefined();
    expect(h.repo.byContentSha('sha-deck')!.withImages).toBe(false);
  });
});

describe('what never reaches the document', () => {
  it('rejects a block with neither pages nor reason, and keeps the rest of the window', async () => {
    const h = harness(() =>
      JSON.stringify({
        blocks: [
          { kind: 'paragraph', text: 'Invented, from nowhere.', prov: { pages: [], reason: null } },
          { kind: 'paragraph', text: 'Grounded in slide 2.', prov: { pages: [2], reason: null } },
        ],
      }),
    );
    const done = await run(h);
    const texts = blockTexts(done.doc);
    expect(texts).not.toContain('Invented, from nowhere.');
    expect(texts).toContain('Grounded in slide 2.');
  });

  it('keeps a bridging block that says it is bridging', async () => {
    const h = harness(() =>
      JSON.stringify({
        blocks: [
          { kind: 'paragraph', text: 'A sentence the deck implies.', prov: { pages: [], reason: 'bridges p. 2 and p. 3' } },
        ],
      }),
    );
    const done = await run(h);
    expect(blockTexts(done.doc)).toContain('A sentence the deck implies.');
    let reason: string | null = null;
    eachBlock(docFromJson(done.doc), (node) => {
      if (node.textContent === 'A sentence the deck implies.') reason = blockAttrs(node).reason;
    });
    expect(reason).toBe('bridges p. 2 and p. 3');
  });

  it('survives a window that produced nothing usable, rather than losing the deck', async () => {
    const h = harness((request, call) => (call === 1 ? JSON.stringify({ blocks: [] }) : twoCleanBlocks(request)));
    const done = await run(h);
    expect(done.ingestStatus).toBe('ready');
    expect(blockTexts(done.doc)).toContain('Section from p. 11');
  });
});

describe('the three ways a run is interrupted', () => {
  it('re-queues a window the learner took the lane back from', async () => {
    let preempts = 0;
    const h = harness((request, call) => {
      if (call === 1) {
        preempts += 1;
        const err = new Error('pre-empted');
        err.name = 'CliPreemptedError';
        throw err;
      }
      return twoCleanBlocks(request);
    });
    const done = await run(h);
    // The window was killed once and retried — not lost, which is the whole point of #48's
    // difference from the disposable concept ingest.
    expect(preempts).toBe(1);
    expect(done.ingestStatus).toBe('ready');
    expect(blockTexts(done.doc)).toContain('Section from p. 1');
  }, 20_000);

  it('records a failure as a reason on the row and keeps the windows that landed', async () => {
    const h = harness((request, call) => {
      if (call <= 2) return twoCleanBlocks(request);
      throw new Error('the CLI did not answer within 600s');
    }, { geometry: async () => deck(36) });
    const done = await run(h, { ...INPUT, pageCount: 36 });
    expect(done.ingestStatus).toBe('failed');
    expect(done.error).toContain('did not answer');
    // Window 1 is still in the document: a failure is not a rollback.
    expect(blockTexts(done.doc)).toContain('Section from p. 1');
  });

  it('resumes at the window it was interrupted on, with the outline it had', async () => {
    const first = harness((request, call) => {
      if (call >= 2) throw new Error('boom');
      return twoCleanBlocks(request);
    });
    const failed = await run(first);
    expect(failed.ingestStatus).toBe('failed');
    expect(failed.ingestState).toMatchObject({ done: 1 });

    // A second open, on the same database, against a model that now answers.
    const second = harness(twoCleanBlocks, { repo: first.repo });
    const done = await run(second);
    expect(done.ingestStatus).toBe('ready');
    // Only the missing window was asked for; window 1 was not paid for twice.
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0]!.messages[0]!.content).toContain('## Section from p. 1');
    expect(blockTexts(done.doc)).toEqual([
      'Lecture 4',
      'Section from p. 1',
      'Prose about slide 1.',
      'Section from p. 11',
      'Prose about slide 11.',
    ]);
  });
});

describe('when an ingest may not run', () => {
  it('is a SQLite read on a document that is already current', async () => {
    const h = harness(twoCleanBlocks);
    await run(h);
    const again = harness(twoCleanBlocks, { repo: h.repo });
    await run(again);
    expect(again.calls).toHaveLength(0);
  });

  it('never runs over a document the learner has edited, and does on an explicit force', async () => {
    const h = harness(twoCleanBlocks);
    const done = await run(h);
    h.repo.markLearnerTouched(done.id, T0);
    // Even a prompt-version bump is not a reason to throw the learner's words away.
    h.repo.setIngest(done.id, { status: 'failed', error: 'stale prompt' }, T0);

    const again = harness(twoCleanBlocks, { repo: h.repo });
    await run(again);
    expect(again.calls).toHaveLength(0);

    const forced = harness(twoCleanBlocks, { repo: h.repo });
    await run(forced, INPUT, { force: true });
    expect(forced.calls).toHaveLength(2);
    expect(h.repo.byId(done.id)!.learnerTouched).toBe(false);
  });

  it('writes a canned document rather than an error when there is no live backend', async () => {
    const h = harness(twoCleanBlocks, { mode: 'scripted', llm: null });
    const done = await run(h, { ...INPUT, fileName: 'A0282987E_LohZhengLucas_Critique1_slides (1).pdf' });
    expect(done.ingestStatus).toBe('ready');
    expect(done.model).toBe('fixture');
    expect(blockTexts(done.doc)).toContain('What /btw is');
    expect(h.calls).toHaveLength(0);
    expect(h.events.some((e) => e.type === 'notes.window')).toBe(true);
  });
});

/**
 * Release review P1-6: the placeholder written before a model was set up says the real notes come
 * once one is. With a live backend, opening the deck again must write them — without touching the
 * learner's words or the scripted demo's canned notes.
 */
describe('placeholder notes, once a model is set up', () => {
  it('points at Settings and Regenerate, not at "reopen this document"', async () => {
    const h = harness(twoCleanBlocks, { mode: 'scripted', llm: null });
    const done = await run(h);
    const text = blockTexts(done.doc).join(' ');
    expect(text).toContain('Settings (Claude Code, or an API key)');
    expect(text).toContain('Regenerate');
  });

  it('are re-ingested on the next open with a live backend', async () => {
    const scripted = harness(twoCleanBlocks, { mode: 'scripted', llm: null });
    const placeholder = await run(scripted);
    expect(placeholder.model).toBe('fixture');
    expect(placeholderSuperseded(placeholder, { live: true, fileName: INPUT.fileName, contentSha: INPUT.contentSha })).toBe(true);

    const live = harness(twoCleanBlocks, { repo: scripted.repo });
    const real = await run(live);
    expect(live.calls.length).toBeGreaterThan(0);
    expect(real.id).toBe(placeholder.id);
    expect(real.model).not.toBe('fixture');
    expect(real.ingestStatus).toBe('ready');
    expect(blockTexts(real.doc).join(' ')).not.toContain('placeholder notes');
  });

  it('stay while there is still no live backend', async () => {
    const h = harness(twoCleanBlocks, { mode: 'scripted', llm: null });
    const first = await run(h);
    expect(placeholderSuperseded(first, { live: false, fileName: INPUT.fileName, contentSha: INPUT.contentSha })).toBe(false);
  });

  it('are never re-ingested over the learner’s own words', async () => {
    const scripted = harness(twoCleanBlocks, { mode: 'scripted', llm: null });
    const placeholder = await run(scripted);
    scripted.repo.markLearnerTouched(placeholder.id, T0);
    const live = harness(twoCleanBlocks, { repo: scripted.repo });
    await run(live);
    expect(live.calls).toHaveLength(0);
    expect(scripted.repo.byId(placeholder.id)!.model).toBe('fixture');
  });

  it('leave the scripted demo’s canned notes for its own deck alone', async () => {
    const demo = { ...INPUT, fileName: 'A0282987E_LohZhengLucas_Critique1_slides (1).pdf' };
    const scripted = harness(twoCleanBlocks, { mode: 'scripted', llm: null });
    const canned = await run(scripted, demo);
    const live = harness(twoCleanBlocks, { repo: scripted.repo });
    await run(live, demo);
    expect(live.calls).toHaveLength(0);
    expect(blockTexts(scripted.repo.byId(canned.id)!.doc)).toContain('What /btw is');
  });
});

describe('objectives to blocks', () => {
  it('maps an objective to every block carrying one of its pages', async () => {
    const tree: LearningTree = {
      fileId: 'f_deck',
      contentSha: 'sha-deck',
      generatedAt: T0,
      model: 'sonnet',
      version: 2,
      status: 'ready',
      objectives: [
        {
          id: 'o_1', fileId: 'f_deck', title: 'Understand slide one', kind: 'objective',
          statement: 's', criteria: ['a', 'b'], quizSeeds: ['q'], refs: [{ page: 1 }],
          parentId: null, requires: [], assumedByDeck: false, order: 0,
        },
      ],
    };
    const h = harness(twoCleanBlocks, { objectivesTree: () => tree });
    const done = await run(h);
    const rows = h.repo.objectiveBlocks(done.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.objectiveId === 'o_1')).toBe(true);
    // And the titles were offered to the model as a hint, never as a plan.
    expect(h.calls[0]!.messages[0]!.content).toContain('Understand slide one');
  });
});

describe('applying one window', () => {
  it('appends at the end when there is no previous window, and after the block when there is', () => {
    const empty = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'b_seed', pages: [], reason: null, objectiveIds: [] } }] };
    const first = applyWindow(empty, null, blocksFor(1));
    expect(first.lastBlockId).toBeTruthy();
    const second = applyWindow(first.doc, first.lastBlockId, blocksFor(2));
    expect(blockTexts(second.doc)).toEqual([
      'Section from p. 1', 'Prose about slide 1.', 'Section from p. 2', 'Prose about slide 2.',
    ]);
  });

  it('is a no-op for an empty window, and keeps the anchor for the next one', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'b_seed', pages: [], reason: null, objectiveIds: [] } }] };
    expect(applyWindow(doc, 'b_seed', [])).toEqual({ doc, lastBlockId: 'b_seed', nodes: [] });
  });

  /**
   * **A window lands once** (2026-09-23). The renderer used to re-derive the window's nodes from
   * the drafts and mint its own block ids; its next save then rebased main's copy in beside it.
   * The nodes handed back here are the ones in the stored document, ids included, and inserting
   * them into an editor holding the same starting document gives the stored document exactly.
   */
  it('hands back the inserted nodes with the stored ids, so the open editor inserts the same blocks', () => {
    const empty = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'b_seed', pages: [], reason: null, objectiveIds: [] } }] };
    const applied = applyWindow(empty, null, blocksFor(1));
    const storedIds = (applied.doc as { content: { attrs: { blockId: string } }[] }).content.map((n) => n.attrs.blockId);
    const sentIds = (applied.nodes as { attrs: { blockId: string } }[]).map((n) => n.attrs.blockId);
    expect(sentIds.length).toBeGreaterThan(0);
    expect(storedIds).toEqual(expect.arrayContaining(sentIds));

    const editor = EditorState.create({ schema: notesSchema, doc: docFromJson(empty) });
    const tr = appendNodes(editor, null, applied.nodes.map((json) => PmNode.fromJSON(notesSchema, json)));
    expect(editor.apply(tr).doc.toJSON()).toEqual(applied.doc);
  });
});

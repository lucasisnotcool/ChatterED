/**
 * **The overview on the bench** (`docs/research/notebooks.md`): the notes dev harness's notebook
 * mode. It puts the C6 fixture (`lib/pm/overviewfixture.ts`) behind the bridge calls the editor
 * makes for a notebook — `notesGet`, `openDocument` per source, the save, `notesBlockAction`,
 * `notesGenerateBlock`, `notesSetRecommendation`, `notesUpdateOverview` — and answers them the
 * way main will: an accepted action is followed by the agent's cursor and its one-line edit on
 * the ordinary `doc.edit` path, so what the harness shows is the real renderer path.
 *
 * Dev only, never shipped: imported by `DevHarness.svelte` alone. It patches the **mock** bridge
 * object in place (and puts the originals back on teardown), because the mock is N5's file.
 */
import type { ChatterEdApi } from '../../../../shared/ipc.js';
import type { RoomEvent } from '../../../../shared/types.js';
import type { NotesDocView, OverviewMeta } from '../../../../shared/doc/types.js';
import { bridge } from '../../../lib/bridge.js';
import {
  FIXTURE_DOC_ID,
  FIXTURE_NOTEBOOK_ID,
  FIXTURE_NOTES_TEXT,
  fixtureOverviewDoc,
  fixtureOverviewMeta,
} from '../../../lib/pm/overviewfixture.js';

const ROOM = 'room_bench_overview';

export interface OverviewBench {
  /** The overview to serve on the next open (null: a legacy doc with no overview). */
  setOverview(meta: OverviewMeta | null): void;
  /** The fingerprint the next Update writes (the notebook's, as main would). */
  setFingerprint(fingerprint: string): void;
  /** False: the notebook has no doc yet, until the editor asks for one with `notesIngest`. */
  setHasDoc(exists: boolean): void;
  teardown(): void;
}

export function installOverviewBench(options: {
  /** Every event the bench fires goes here (the harness hands it to the stores). */
  emit: (event: RoomEvent) => void;
  log: (line: string) => void;
  /** The lecture PDF's bytes, when the harness can fetch the real deck. */
  lectureBytes: () => Promise<Uint8Array | null>;
}): OverviewBench {
  const api = bridge() as unknown as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  const patch = <K extends keyof ChatterEdApi>(name: K, fn: ChatterEdApi[K]): void => {
    if (!saved.has(name)) saved.set(name, api[name]);
    api[name] = fn;
  };
  const original = <K extends keyof ChatterEdApi>(name: K): ChatterEdApi[K] => saved.get(name) as ChatterEdApi[K];

  let overview: OverviewMeta | null = fixtureOverviewMeta();
  let fingerprint = overview.fingerprint;
  let version = 1;
  let stored: unknown = fixtureOverviewDoc();
  let seq = 0;
  let hasDoc = true;

  const view = (): NotesDocView => ({
    docId: FIXTURE_DOC_ID,
    fileId: FIXTURE_NOTEBOOK_ID,
    contentSha: `nb:${FIXTURE_NOTEBOOK_ID}`,
    title: 'Real World Planning and Acting',
    pageCount: 55,
    version,
    doc: structuredClone(stored),
    ingest: { status: 'ready', windowsDone: 1, windowsTotal: 1, withImages: true, error: null },
    frozen: false,
    edits: [],
    suggestions: [],
    overview: overview ? structuredClone(overview) : null,
  });

  const later = (ms: number, fn: () => void): void => {
    setTimeout(fn, ms);
  };

  patch('notesGet', async (input) =>
    input.fileId === FIXTURE_NOTEBOOK_ID ? (hasDoc ? view() : null) : original('notesGet')(input),
  );
  patch('notesIngest', async (input) => {
    if (input.fileId !== FIXTURE_NOTEBOOK_ID) return original('notesIngest')(input);
    options.log('notes:ingest — the overview, written in one call');
    hasDoc = true;
    return view();
  });
  patch('openDocument', async (input) => {
    if (input.fileId === 'file_notes' || input.fileId === 'file_lecture') {
      const bytes = input.fileId === 'file_lecture' ? await options.lectureBytes() : null;
      return {
        fileId: input.fileId,
        name: input.fileId === 'file_notes' ? 'Week 2 notes.md' : 'Lecture-complex v4.0.pdf',
        relPath: '',
        absPath: '',
        kind: input.fileId === 'file_notes' ? 'markdown' : 'pdf',
        ext: input.fileId === 'file_notes' ? 'md' : 'pdf',
        size: 0,
        pageCount: null,
        text: input.fileId === 'file_notes' ? FIXTURE_NOTES_TEXT : null,
        bytes,
        error: input.fileId === 'file_lecture' && !bytes ? 'no deck on the bench' : null,
      };
    }
    return original('openDocument')(input);
  });
  patch('notesSave', async (input) => {
    if (input.docId !== FIXTURE_DOC_ID) return original('notesSave')(input);
    version = input.baseVersion + 1;
    stored = input.doc;
    return { ok: true, version };
  });
  patch('notesBlockAction', async (input) => {
    if (input.docId !== FIXTURE_DOC_ID) return original('notesBlockAction')(input);
    const author = input.kind === 'quiz' ? 'max' : 'ellie';
    options.log(`notes:blockAction ${input.kind} on ${input.blockId}`);
    options.emit({ type: 'doc.cursor', roomId: ROOM, docId: FIXTURE_DOC_ID, author, blockId: input.blockId, state: 'thinking' });
    later(1_400, () => {
      seq += 1;
      const editId = `edit_bench_${String(seq)}`;
      options.emit({ type: 'doc.cursor', roomId: ROOM, docId: FIXTURE_DOC_ID, author, blockId: input.blockId, state: 'typing' });
      options.emit({
        type: 'doc.edit',
        roomId: ROOM,
        docId: FIXTURE_DOC_ID,
        batch:
          input.kind === 'quiz'
            ? {
                editId,
                author: 'max',
                cause: 'q_block',
                focusBlockId: input.blockId,
                why: 'You asked to be quizzed on this line.',
                ops: [
                  {
                    op: 'insert_q',
                    anchorBlockId: input.blockId,
                    questionId: `q_bench_${String(seq)}`,
                    objectiveId: null,
                    text: 'Why can h_FF overestimate the true cost, when h_max never does?',
                    prov: { pages: [17, 18], reason: null },
                  },
                ],
              }
            : {
                editId,
                author: 'ellie',
                cause: 'block_action',
                focusBlockId: input.blockId,
                why: input.kind === 'explain' ? 'The point most worth keeping from the explanation.' : 'The example, in brief.',
                ops: [
                  {
                    op: 'insert_after',
                    anchorBlockId: input.blockId,
                    blocks: [
                      {
                        kind: 'paragraph',
                        text:
                          input.kind === 'explain'
                            ? 'A greedy relaxed plan can be longer than the optimal relaxed plan, so h_FF can overestimate.'
                            : 'Two stacks, A on B and C on D: h_FF counts both stack actions, so it gives 2.',
                        prov: { pages: [18], reason: null },
                      },
                    ],
                  },
                ],
              },
      });
    });
    return { accepted: true, roomId: ROOM, threadId: null, reason: null };
  });
  patch('notesGenerateBlock', async (input) => {
    if (input.docId !== FIXTURE_DOC_ID) return original('notesGenerateBlock')(input);
    options.log(`notes:generateBlock ${input.kind} after ${input.blockId}`);
    seq += 1;
    const editId = `edit_bench_${String(seq)}`;
    later(900, () =>
      options.emit({
        type: 'doc.edit',
        roomId: ROOM,
        docId: FIXTURE_DOC_ID,
        batch: {
          editId,
          author: 'ellie',
          cause: 'answer_missing',
          focusBlockId: input.blockId,
          why: input.instruction ?? 'A block you asked for.',
          ops: [
            {
              op: 'insert_after',
              anchorBlockId: input.blockId,
              blocks: [
                {
                  kind: 'flashcards',
                  title: 'Relaxed-plan heuristics',
                  cards: [
                    { front: 'What does h_max count?', back: 'The costliest single subgoal.' },
                    { front: 'Is h_add admissible?', back: 'No: it double-counts shared actions.' },
                    { front: 'What does h_FF count?', back: 'The actions in a greedy relaxed plan.' },
                  ],
                  prov: { pages: [17, 18], reason: null },
                },
              ],
            },
          ],
        },
      }),
    );
    return { inserted: true, editId, reason: null };
  });
  patch('notesSetRecommendation', async (input) => {
    if (input.docId !== FIXTURE_DOC_ID || !overview) return original('notesSetRecommendation')(input);
    options.log(`notes:setRecommendation ${input.recommendationId} → ${input.status}`);
    overview = {
      ...overview,
      recommendations: overview.recommendations.map((r) => (r.id === input.recommendationId ? { ...r, status: input.status } : r)),
    };
    return structuredClone(overview);
  });
  patch('notesUpdateOverview', async (input) => {
    if (input.fileId !== FIXTURE_NOTEBOOK_ID) return original('notesUpdateOverview')(input);
    options.log('notes:updateOverview — rewriting from the ticked sources');
    later(1_500, () => {
      overview = { ...(overview ?? fixtureOverviewMeta()), fingerprint, writtenAt: new Date().toISOString() };
      options.emit({
        type: 'notes.status',
        roomId: null,
        fileId: FIXTURE_NOTEBOOK_ID,
        docId: FIXTURE_DOC_ID,
        ingest: { status: 'ready', windowsDone: 1, windowsTotal: 1, withImages: true, error: null },
      });
    });
    return { started: true, reason: null };
  });
  // Bookkeeping main would do; the bench has nothing to record.
  patch('notesEditResolved', async (input) => {
    if (input.docId !== FIXTURE_DOC_ID) await original('notesEditResolved')(input);
  });
  patch('notesDocText', async (input) =>
    input.docId === FIXTURE_DOC_ID ? { assessed: false, threadId: null, reason: null } : original('notesDocText')(input),
  );

  return {
    setOverview(meta) {
      overview = meta;
      stored = fixtureOverviewDoc();
    },
    setFingerprint(next) {
      fingerprint = next;
    },
    setHasDoc(exists) {
      hasDoc = exists;
    },
    teardown() {
      for (const [name, fn] of saved) api[name] = fn;
      saved.clear();
    },
  };
}

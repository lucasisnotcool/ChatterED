/**
 * A `DocHost` and a `RoomActor` that exist only in a test (#48, track T6).
 *
 * `DocHost` is the whole of what the collab-doc modules may ask of the app, which makes it also
 * the whole of what a handler test has to stand up. Everything here is the narrowest thing that
 * satisfies the port: a real migrated database and store (the handlers genuinely write rows), and
 * spies for the four things that leave the process — the actor, the event stream, the vault's
 * text and the objective tree.
 *
 * Not a `*.test.ts`, so vitest does not collect it as a suite.
 */

import type { Node } from 'prosemirror-model';
import type { RoomEvent } from '../../shared/types.js';
import type { LearningObjective, LearningObjectiveState, LearningTree } from '../../shared/objectives.js';
import type { PrivateTurnView, ThreadView } from '../../shared/doc/types.js';
import type { SqlDatabase } from '../db/driver.js';
import type { LocalStore } from '../db/store.js';
import type { ConfirmRequest, DocHost, IpcHandle } from '../dochost.js';
import { openTestDb, seedRoom } from '../../test-support/db.js';
import type { DocActorMethods } from './actorport.js';

export const SHA = 'sha-deck';
export const FILE_ID = 'f_deck';
export const DOC_ID = 'doc_deck';

export interface ActorCall {
  method: string;
  args: unknown[];
}

/** The actor's side of the nine agreed signatures, recorded rather than run. */
export class FakeActor {
  calls: ActorCall[] = [];
  threads: ThreadView[] = [];
  privateTurns: PrivateTurnView[] = [];
  /** Methods to pretend T3 has not written yet. */
  missing = new Set<string>();

  #record(method: string, args: unknown[]): void {
    if (this.missing.has(method)) throw new Error(`method ${method} is missing in this fixture`);
    this.calls.push({ method, args });
  }

  last(method: string): ActorCall | undefined {
    return [...this.calls].reverse().find((c) => c.method === method);
  }

  sendMessage: DocActorMethods['sendMessage'] = async (...args) => {
    this.#record('sendMessage', args);
  };
  noteSpanThread: DocActorMethods['noteSpanThread'] = (...args) => {
    this.#record('noteSpanThread', args);
  };
  noteTutorialFocus: DocActorMethods['noteTutorialFocus'] = (...args) => {
    this.#record('noteTutorialFocus', args);
  };
  pass: DocActorMethods['pass'] = async (...args) => {
    this.#record('pass', args);
    return { released: true, refused: null };
  };
  startLesson: DocActorMethods['startLesson'] = async (...args) => {
    this.#record('startLesson', args);
  };
  assessDocText: DocActorMethods['assessDocText'] = async (...args) => {
    this.#record('assessDocText', args);
  };
  /** What `answerInPlace` answers with. A test sets it to a refusal to drive that path. */
  inPlaceResult: Awaited<ReturnType<DocActorMethods['answerInPlace']>> = { accepted: true, threadId: 'doc', reason: null };
  answerInPlace: DocActorMethods['answerInPlace'] = async (...args) => {
    this.#record('answerInPlace', args);
    return this.inPlaceResult;
  };
  markOwnQuestion: DocActorMethods['markOwnQuestion'] = async (...args) => {
    this.#record('markOwnQuestion', args);
    return { accepted: true, reason: null };
  };
  generateBlock: DocActorMethods['generateBlock'] = async (...args) => {
    this.#record('generateBlock', args);
    return { inserted: true, editId: 'edit_gen', reason: null };
  };
  /** What `blockAction` answers with. A test sets it to a refusal to drive that path. */
  blockActionResult: { accepted: boolean; threadId: string | null; reason: 'no_doc' | 'busy' | 'question_open' | null } | null = null;
  blockAction: DocActorMethods['blockAction'] = async (...args) => {
    this.#record('blockAction', args);
    const result = this.blockActionResult ?? { accepted: true, threadId: args[0].anchorId, reason: null };
    return { ...result, turn: Promise.resolve() };
  };
  openPrivate: DocActorMethods['openPrivate'] = (...args) => {
    this.#record('openPrivate', args);
    return { threadId: 'wthread_1', turns: this.privateTurns };
  };
  sendPrivate: DocActorMethods['sendPrivate'] = async (...args) => {
    this.#record('sendPrivate', args);
  };
  insertPrivateIntoDoc: DocActorMethods['insertPrivateIntoDoc'] = async (...args) => {
    this.#record('insertPrivateIntoDoc', args);
    return { editId: 'edit_1' };
  };
  docThreads: DocActorMethods['docThreads'] = () => this.threads;
  closeOpenQuestion: DocActorMethods['closeOpenQuestion'] = async (...args) => {
    this.#record('closeOpenQuestion', args);
  };
  /** The room this actor is on; set by `fakeHost`. */
  roomId = '';
  snapshot = (): { roomId: string } => ({ roomId: this.roomId });
  /** A sitting with nothing in it, so a test can tell it was saved. */
  flowSnapshot = () => ({ session: null, taught: [], pendingQuiz: null, answers: [] });

  /** Drop a method from the object, the way a build where T3 has not landed would have it. */
  omit(...methods: (keyof DocActorMethods)[]): this {
    for (const method of methods) {
      delete (this as unknown as Record<string, unknown>)[method];
      this.missing.add(method);
    }
    return this;
  }
}

export interface FakeHost {
  host: DocHost;
  db: SqlDatabase;
  store: LocalStore;
  actor: FakeActor;
  events: RoomEvent[];
  roomId: string;
  /** Rooms this host has been asked to open, in order. Empty ⟹ no read created one. */
  opened: string[];
  /** Set to null to make the file look like it has never been spoken to. */
  roomExists: boolean;
  setTree(objectives: LearningObjective[], status?: LearningTree['status']): void;
  setStates(states: LearningObjectiveState[]): void;
  ensureCalls: string[];
  pageText: string;
  /** What the learner answers the next confirm sheet with. Defaults to yes. */
  confirmAnswer: boolean;
  /** Every confirm sheet shown, in order. */
  confirms: ConfirmRequest[];
  /** Every `retireFlowRoom` call, in order. */
  retired: { roomId: string; reason: string }[];
  /** What `notebooks.textFor` answers (contract C2), and every read it was asked for. */
  notebookPageText: string;
  notebookReads: { notebookId: string; pageFrom: number; pageTo: number }[];
  /** Every `vault.textFor` read, so a test can tell a notebook id never reached the vault. */
  vaultReads: { fileId: string; pageFrom: number; pageTo: number }[];
}

export interface FakeHostOptions {
  /** Written into `notes_docs` as the file's document. Omit for a file with no notes doc. */
  doc?: Node;
  docId?: string;
  fileId?: string;
  contentSha?: string;
}

/** A migrated database, a seeded room, and a `DocHost` over the two. */
export function fakeHost(opts: FakeHostOptions = {}): FakeHost {
  const { db, store } = openTestDb();
  const seeded = seedRoom(store);
  const actor = new FakeActor();
  actor.roomId = seeded.roomId;
  const events: RoomEvent[] = [];
  const fileId = opts.fileId ?? FILE_ID;
  const contentSha = opts.contentSha ?? SHA;
  const docId = opts.docId ?? DOC_ID;

  if (opts.doc) {
    db.prepare(
      `INSERT INTO notes_docs
         (id, content_sha, file_id, title, page_count, version, doc_json, ingest_status,
          ingest_version, created_at, updated_at)
       VALUES (@id, @sha, @file, 'Notes', 12, 1, @json, 'ready', 1, @now, @now)`,
    ).run({
      id: docId,
      sha: contentSha,
      file: fileId,
      json: JSON.stringify(opts.doc.toJSON()),
      now: '2026-09-19T10:00:00.000Z',
    });
  }

  const state: {
    tree: LearningTree | null;
    states: LearningObjectiveState[];
    ensureCalls: string[];
    opened: string[];
    roomExists: boolean;
    pageText: string;
    confirmAnswer: boolean;
    confirms: ConfirmRequest[];
    retired: { roomId: string; reason: string }[];
    notebookPageText: string;
    notebookReads: { notebookId: string; pageFrom: number; pageTo: number }[];
    vaultReads: { fileId: string; pageFrom: number; pageTo: number }[];
  } = {
    tree: null,
    states: [],
    ensureCalls: [],
    opened: [],
    roomExists: false,
    pageText: 'The page the block came from.',
    confirmAnswer: true,
    confirms: [],
    retired: [],
    notebookPageText: 'The notebook pages the block came from.',
    notebookReads: [],
    vaultReads: [],
  };

  const room = { roomId: seeded.roomId, actor: actor as unknown as never };

  const host = {
    db,
    store,
    userDataDir: '/tmp/chattered-test',
    vault: {
      textFor: async (input: { fileId: string; pageFrom: number; pageTo: number }) => {
        state.vaultReads.push(input);
        return state.pageText;
      },
      deckText: async () => ({ text: 'The whole deck.', pages: 12, truncated: false }),
      topPages: () => [],
    },
    segments: {},
    /** `DocHost.notebooks` (contract C2): pages are notebook pages, read by notebook id. */
    notebooks: {
      subject: () => null,
      deckText: () => ({ text: 'The notebook deck: [p. 1] … [p. 12] …', truncated: false }),
      textFor: (input: { notebookId: string; pageFrom: number; pageTo: number }) => {
        state.notebookReads.push(input);
        return state.notebookPageText;
      },
      locate: () => null,
    },
    emit: (event: RoomEvent) => {
      events.push(event);
    },
    backend: () => ({}),
    llm: () => ({}),
    openFlowRoom: async (id: string) => {
      state.opened.push(id);
      state.roomExists = true;
      return { ...room, created: true };
    },
    roomForFile: async () => (state.roomExists ? room : null),
    actorFor: () => room.actor,
    currentActor: () => room.actor,
    fileForRoom: () => fileId,
    persistFlow: () => {},
    objectivesTree: () => state.tree,
    objectivesStates: () => state.states,
    ensureObjectives: (id: string) => {
      state.ensureCalls.push(id);
    },
    fileBytesKey: async () => ({ contentSha, pageCount: 12 }),
    confirm: async (request: ConfirmRequest) => {
      state.confirms.push(request);
      return state.confirmAnswer;
    },
    retireFlowRoom: (roomId: string, reason: string) => {
      state.retired.push({ roomId, reason });
      state.roomExists = false;
    },
  } as unknown as DocHost;

  return {
    host,
    db,
    store,
    actor,
    events,
    roomId: seeded.roomId,
    get opened() {
      return state.opened;
    },
    get roomExists() {
      return state.roomExists;
    },
    set roomExists(value: boolean) {
      state.roomExists = value;
    },
    get ensureCalls() {
      return state.ensureCalls;
    },
    get confirmAnswer() {
      return state.confirmAnswer;
    },
    set confirmAnswer(value: boolean) {
      state.confirmAnswer = value;
    },
    get confirms() {
      return state.confirms;
    },
    get retired() {
      return state.retired;
    },
    get pageText() {
      return state.pageText;
    },
    get notebookPageText() {
      return state.notebookPageText;
    },
    set notebookPageText(value: string) {
      state.notebookPageText = value;
    },
    get notebookReads() {
      return state.notebookReads;
    },
    get vaultReads() {
      return state.vaultReads;
    },
    set pageText(value: string) {
      state.pageText = value;
    },
    setTree(objectives, status = 'ready') {
      state.tree = {
        fileId,
        contentSha,
        generatedAt: '2026-09-19T09:00:00.000Z',
        model: 'sonnet',
        version: 1,
        objectives,
        status,
      };
    },
    setStates(states) {
      state.states = states;
    },
  };
}

/** The handler table `register*Ipc` fills in, and the call that runs one. */
export function handlerTable(): { handle: IpcHandle; call: <T>(channel: string, payload?: unknown) => Promise<T> } {
  const handlers = new Map<string, (payload: unknown) => unknown>();
  const handle: IpcHandle = <T>(channel: string, fn: (payload: T) => unknown) => {
    handlers.set(channel, fn as (payload: unknown) => unknown);
  };
  return {
    handle,
    call: async <T>(channel: string, payload: unknown = {}): Promise<T> => {
      const fn = handlers.get(channel);
      if (!fn) throw new Error(`no handler for ${channel}`);
      return (await fn(payload)) as T;
    },
  };
}

/** An objective, with only the fields the progress view reads spelled out. */
export function objective(id: string, over: Partial<LearningObjective> = {}): LearningObjective {
  return {
    id,
    fileId: FILE_ID,
    title: `Objective ${id}`,
    kind: 'objective',
    statement: 'What the learner must be able to say.',
    criteria: ['names it', 'says why'],
    quizSeeds: [`Explain ${id}.`],
    refs: [{ page: 1 }],
    parentId: null,
    requires: [],
    assumedByDeck: false,
    order: 1,
    ...over,
  };
}

/**
 * **The simulation harness: the real app, headless** (`sim/README.md`).
 *
 * Everything below the renderer is the shipped code: `AppService`, the notebook host, the
 * doc-room IPC handlers, `RoomActor`, the prompts and the Claude CLI client the app resolves
 * from its own settings. What this file adds is the renderer's half, done without a window:
 *
 *  - a **copy** of the app's database, so a run can never write to the learner's own;
 *  - a reset of one notebook on that copy (no Q blocks, no outcomes, no open room), so every
 *    run starts where a learner who has read the notes and pressed nothing would;
 *  - the doc-edit loop the renderer runs (`docstore.svelte.ts`): apply the agent's batch with
 *    `applyBatch`, report it on `notes:editResolved`, save on `notes:save`;
 *  - a recorder around every LLM call, so a bad turn can be traced to the exact prompt.
 *
 * Known gap: the learner's answer is sent the way the Q block's Submit sends it, but its text
 * is not written into the Q block in the document, so the outline a later turn reads does not
 * show it as the learner's writing there. The transcript does.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EditorState } from 'prosemirror-state';
import type { Node } from 'prosemirror-model';
import { AppService } from '../src/main/ipc.js';
import { openTestDatabase, type SqlDatabase } from '../src/main/db/driver.js';
import { runMigrations } from '../src/main/db/migrations.js';
import { createStore, type LocalStore } from '../src/main/db/store.js';
import { registerNotesIpc } from '../src/main/notes/ipc.js';
import { registerDocRoomIpc } from '../src/main/docroom/ipc.js';
import { registerProgressIpc } from '../src/main/docroom/progress.js';
import { openNotesDoc } from '../src/main/docroom/doc.js';
import { fileSink, initLogger } from '../src/main/log.js';
import { applyBatch } from '../src/shared/doc/ops.js';
import { blockAttrs, docFromJson, docOutline, eachBlock, notesSchema } from '../src/shared/doc/schema.js';
import type { AgentDocOpBatch, OutlineEntry, ThreadView } from '../src/shared/doc/types.js';
import type { LLMClient, LlmRequest } from '../src/room/llm/types.js';
import type { RoomEvent } from '../src/shared/types.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../src/main/db/migrations', import.meta.url));

export interface SimOpenOptions {
  /** The app's live database (`~/Library/Application Support/ChatterED/app.db`). Only read. */
  sourceDb: string;
  /** The app's userData dir; its `notebooks/` folder (the sources) is copied. */
  sourceUserData: string;
  notebookId: string;
  /** Where this run writes: the db copy, the logs, the transcript. */
  outDir: string;
}

/** One LLM call as the actor made it, and what came back. */
export interface RecordedCall {
  n: number;
  at: string;
  scope: string;
  agentKey: string | null;
  turnId: string | null;
  scriptCue: string | null;
  model: string;
  system: string;
  messages: { role: string; content: string }[];
  reply: string | null;
  error: string | null;
  ms: number;
}

/** What the learner can see of one chat message. */
export interface SimMessage {
  seq: number;
  who: string;
  role: 'learner' | 'ellie' | 'max' | 'other';
  body: string;
  threadId: string | null;
  decidedBy: string | null;
  kind: string | null;
  at: string;
}

type Handler = (payload: unknown) => unknown;

export class SimRoom {
  readonly notebookId: string;
  readonly outDir: string;
  readonly calls: RecordedCall[] = [];
  readonly events: RoomEvent[] = [];
  readonly #app: AppService;
  readonly #db: SqlDatabase;
  readonly #store: LocalStore;
  readonly #handlers = new Map<string, Handler>();
  #inFlight = 0;
  #edits: Promise<void> = Promise.resolve();
  #editsPending = 0;
  #lastActivity = Date.now();

  private constructor(app: AppService, db: SqlDatabase, store: LocalStore, notebookId: string, outDir: string) {
    this.#app = app;
    this.#db = db;
    this.#store = store;
    this.notebookId = notebookId;
    this.outDir = outDir;
  }

  /** Copy the database and the sources, reset the notebook, and build the app over the copy. */
  static async open(opts: SimOpenOptions): Promise<SimRoom> {
    mkdirSync(opts.outDir, { recursive: true });
    const userData = join(opts.outDir, 'userData');
    rmSync(userData, { recursive: true, force: true });
    mkdirSync(userData, { recursive: true });
    const dbPath = join(opts.outDir, 'app.db');
    rmSync(dbPath, { force: true });
    // `.backup` reads a consistent snapshot of a WAL database the running app may be writing.
    execFileSync('sqlite3', [opts.sourceDb, `.backup '${dbPath}'`]);
    const sources = join(opts.sourceUserData, 'notebooks');
    if (existsSync(sources)) cpSync(sources, join(userData, 'notebooks'), { recursive: true });

    const db = openTestDatabase(dbPath);
    runMigrations(db, MIGRATIONS_DIR);
    const store = createStore(db);
    resetNotebook(db, opts.notebookId);

    initLogger({ sink: fileSink(opts.outDir, 'main.log') });

    let room: SimRoom | null = null;
    const recorder = (client: LLMClient): LLMClient => (room ? room.#record(client) : client);
    class SimService extends AppService {
      override llm(...args: Parameters<AppService['llm']>): LLMClient {
        return recorder(super.llm(...args));
      }
    }
    const app = new SimService({
      db,
      store,
      appVersion: '0.0.0-sim',
      osVersion: 'darwin sim',
      userDataDir: userData,
      logDir: join(opts.outDir, 'logs'),
      getWindow: () =>
        ({
          webContents: {
            send: (_channel: string, payload: unknown) => room?.receive(payload as RoomEvent),
          },
        }) as never,
    });
    room = new SimRoom(app, db, store, opts.notebookId, opts.outDir);
    app.startNotebooks();
    await app.notebooks.whenIdle();
    const host = app.docHost();
    const handle = <T>(channel: string, fn: (payload: T) => unknown) => {
      room!.#handlers.set(channel, fn as Handler);
    };
    registerNotesIpc(host, handle);
    registerDocRoomIpc(host, handle);
    registerProgressIpc(host, handle);
    return room;
  }

  /** What the renderer would call over IPC. */
  async call<T>(channel: string, payload: unknown): Promise<T> {
    const fn = this.#handlers.get(channel);
    if (!fn) throw new Error(`no handler for ${channel}`);
    this.#lastActivity = Date.now();
    return (await fn(payload)) as T;
  }

  // ── the document ──────────────────────────────────────────────────────────

  doc(): { docId: string; version: number; node: Node } {
    const opened = openNotesDoc(this.#db, { contentSha: null, fileId: this.notebookId });
    if (!opened?.doc) throw new Error(`notebook ${this.notebookId} has no notes doc`);
    return { docId: opened.row.docId, version: opened.row.version, node: opened.doc };
  }

  outline(): OutlineEntry[] {
    return docOutline(this.doc().node);
  }

  /** The first block whose text contains `needle` (case- and space-insensitive). */
  findBlock(needle: string): OutlineEntry {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const want = norm(needle);
    const hit = this.outline().find((e) => norm(e.text).includes(want));
    if (!hit) throw new Error(`no block contains "${needle}"`);
    return hit;
  }

  /** The Q block carrying `questionId`, once the agent's edit has been applied. */
  qBlockFor(questionId: string): { blockId: string; question: string } | null {
    let found: { blockId: string; question: string } | null = null;
    eachBlock(this.doc().node, (node) => {
      if (found || node.type.name !== 'q_block' || node.attrs.questionId !== questionId) return;
      found = { blockId: blockAttrs(node).blockId ?? '', question: node.firstChild?.textContent ?? '' };
    });
    return found;
  }

  /** The notes as the learner reads them: one line per block, headings marked. */
  docText(): string {
    return this.outline()
      .map((e) => (e.kind === 'heading' ? `\n## ${e.text}` : `${e.kind === 'q_block' ? '[Q] ' : ''}${e.text}`))
      .join('\n');
  }

  /**
   * The agents' calls since `since`, as the app's own cost recorder logged them (`llm_usage`):
   * tokens, and the API-equivalent estimate from its rate card. The copy also holds the learner's
   * real history, hence the time bound.
   */
  usageSince(since: string): { calls: number; inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number; estUsd: number } {
    return usageIn(this.#db, since);
  }

  /** The notes doc's stored overview record: words written, the budget, and the policy. */
  overviewMeta(): { words?: number; wordBudget?: number; genre?: string; writtenAt?: string } | null {
    const row = this.#db
      .prepare('SELECT overview_json FROM notes_docs WHERE file_id = @file')
      .get<{ overview_json: string | null }>({ file: this.notebookId });
    return row?.overview_json ? (JSON.parse(row.overview_json) as { words?: number; wordBudget?: number; genre?: string; writtenAt?: string }) : null;
  }

  /** **Update overview**, as the button runs it, and wait for the rewritten overview to land. */
  async updateOverview(timeoutMs = 600_000): Promise<{ started: boolean; reason: string | null }> {
    const before = this.overviewMeta()?.writtenAt ?? null;
    const started = await this.call<{ started: boolean; reason: string | null }>('notes:updateOverview', { fileId: this.notebookId });
    if (!started.started) return started;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1_000));
      const row = this.#db
        .prepare('SELECT ingest_status, error FROM notes_docs WHERE file_id = @file')
        .get<{ ingest_status: string; error: string | null }>({ file: this.notebookId });
      if (row?.ingest_status === 'failed') return { started: true, reason: `failed: ${row.error ?? ''}` };
      if (row?.ingest_status === 'ready' && (this.overviewMeta()?.writtenAt ?? null) !== before) return started;
    }
    return { started: true, reason: 'timed out' };
  }

  /** The notebook's learning objectives, as the progress bar's lesson cards list them. */
  async objectives(): Promise<{ objectiveId: string; title: string }[]> {
    const view = await this.call<{ objectives: { objectiveId: string; title: string }[] }>('progress:get', { fileId: this.notebookId });
    return view.objectives;
  }

  // ── the chat ──────────────────────────────────────────────────────────────

  roomId(): string | null {
    const row = this.#db
      .prepare(
        `SELECT r.id FROM rooms r JOIN materials m ON m.id = r.material_id
          WHERE m.file_id = @file AND r.state IN ('open','agent_scheduled','agent_speaking')
          ORDER BY r.created_at DESC LIMIT 1`,
      )
      .get<{ id: string }>({ file: this.notebookId });
    return row?.id ?? null;
  }

  messages(threadId?: string | null): SimMessage[] {
    const roomId = this.roomId();
    if (!roomId) return [];
    const participants = new Map(this.#store.participants.forRoom(roomId).map((p) => [p.id, p]));
    return this.#store.messages
      .forRoom(roomId)
      .filter((m) => threadId === undefined || (m.anchor_id ?? null) === threadId)
      .map((m) => {
        const p = participants.get(m.participant_id);
        const key = p?.agent_key ?? '';
        const role: SimMessage['role'] =
          p?.kind === 'student' ? 'learner' : key.startsWith('peer') ? 'ellie' : key.startsWith('challenger') ? 'max' : 'other';
        return {
          seq: m.seq,
          who: p?.kind === 'student' ? 'Learner' : (p?.display_name ?? 'Agent'),
          role,
          body: m.body,
          threadId: m.anchor_id ?? null,
          decidedBy: m.decided_by ?? m.model ?? null,
          kind: m.kind ?? null,
          at: m.created_at,
        };
      });
  }

  async threads(): Promise<ThreadView[]> {
    const view = await this.call<{ threads: ThreadView[] }>('chat:threads', { fileId: this.notebookId });
    return view.threads;
  }

  async thread(threadId: string): Promise<ThreadView | null> {
    return (await this.threads()).find((t) => t.threadId === threadId) ?? null;
  }

  // ── waiting ───────────────────────────────────────────────────────────────

  /**
   * Until the room is quiet: no LLM call in flight, no doc edit being applied, no turn scheduled
   * or speaking, and nothing new for `settleMs`. The ledger and the doc line run after a reply,
   * so "the reply landed" is not "the turn is over".
   */
  async idle(opts: { settleMs?: number; timeoutMs?: number } = {}): Promise<void> {
    const settle = opts.settleMs ?? 3_000;
    const deadline = Date.now() + (opts.timeoutMs ?? 240_000);
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
      const roomId = this.roomId();
      const room = roomId ? this.#store.rooms.get(roomId) : null;
      const busy =
        this.#inFlight > 0 ||
        this.#editsPending > 0 ||
        (room !== null && room !== undefined && (room.state !== 'open' || room.pending_turn_id !== null));
      if (busy) continue;
      if (Date.now() - this.#lastActivity >= settle) return;
    }
    throw new Error('timed out waiting for the room to go quiet');
  }

  dispose(): void {
    try {
      this.#app.dispose();
    } catch {
      /* a disposed app */
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  #record(client: LLMClient): LLMClient {
    const calls = this.calls;
    return {
      kind: client.kind,
      complete: async (request: LlmRequest, onDelta, signal) => {
        const n = calls.length + 1;
        const started = Date.now();
        this.#inFlight += 1;
        this.#lastActivity = started;
        const entry: RecordedCall = {
          n,
          at: new Date(started).toISOString(),
          scope: request.meta.scope,
          agentKey: request.meta.agentKey ?? null,
          turnId: request.meta.turnId ?? null,
          scriptCue: request.meta.scriptCue ?? null,
          model: request.model,
          system: request.system.map((b) => b.text).join('\n\n----\n\n'),
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          reply: null,
          error: null,
          ms: 0,
        };
        calls.push(entry);
        try {
          const result = await client.complete(request, onDelta, signal);
          entry.reply = result.text;
          return result;
        } catch (err) {
          entry.error = err instanceof Error ? err.message : String(err);
          throw err;
        } finally {
          entry.ms = Date.now() - started;
          this.#inFlight -= 1;
          this.#lastActivity = Date.now();
          appendFileSync(join(this.outDir, 'calls.jsonl'), `${JSON.stringify(entry)}\n`);
        }
      },
    };
  }

  /** The renderer's event stream: recorded, and `doc.edit` applied. */
  receive(event: RoomEvent): void {
    this.#lastActivity = Date.now();
    this.events.push(event);
    appendFileSync(join(this.outDir, 'events.jsonl'), `${JSON.stringify(event)}\n`);
    if (event.type === 'doc.edit') {
      const batch = (event as { batch: AgentDocOpBatch }).batch;
      this.#editsPending += 1;
      this.#edits = this.#edits
        .then(() => this.#applyEdit(batch))
        .catch((err) => appendFileSync(join(this.outDir, 'errors.log'), `doc.edit: ${String(err)}\n`))
        .finally(() => {
          this.#editsPending -= 1;
          this.#lastActivity = Date.now();
        });
    }
  }

  /** `docstore.svelte.ts`'s `doc.edit` path, without the view. */
  async #applyEdit(batch: AgentDocOpBatch): Promise<void> {
    const { docId, version, node } = this.doc();
    const state = EditorState.create({ schema: notesSchema, doc: node });
    const result = applyBatch(state, batch, { frozen: false, docId, now: new Date().toISOString() });
    if (!result.tr || result.status !== 'applied') {
      await this.call('notes:editResolved', {
        docId,
        editId: batch.editId,
        status: 'rejected_guard',
        blockIds: result.blockIds,
        docVersion: version,
        suggestion: result.suggestion,
      });
      return;
    }
    const next = state.apply(result.tr);
    await this.call('notes:editResolved', {
      docId,
      editId: batch.editId,
      status: 'applied',
      blockIds: result.blockIds,
      docVersion: version,
      suggestion: result.suggestion,
    });
    const saved = await this.call<{ ok: boolean }>('notes:save', {
      docId,
      baseVersion: version,
      doc: next.doc.toJSON(),
      learnerTouched: false,
    });
    if (!saved.ok) appendFileSync(join(this.outDir, 'errors.log'), `notes:save refused for ${batch.editId}\n`);
  }
}

/**
 * **A clean start for one notebook, on the copy.** No Q blocks in its notes, no recorded
 * outcomes, objective states back to untouched, and no open room, so the first action opens a
 * new sitting exactly as New Conversation would.
 */
export function resetNotebook(db: SqlDatabase, notebookId: string): void {
  const row = db
    .prepare('SELECT id, content_sha, doc_json, version FROM notes_docs WHERE file_id = @file')
    .get<{ id: string; content_sha: string; doc_json: string; version: number }>({ file: notebookId });
  if (!row) throw new Error(`notebook ${notebookId} has no notes doc in the copy`);
  const json = JSON.parse(row.doc_json) as { content?: unknown[] };
  // Who wrote a block's text, by its author marks: a block written only by Ellie or Max after the
  // ingest is an addition from an earlier sitting, and goes with the reset.
  const authors = (node: unknown, acc = new Set<string>()): Set<string> => {
    const n = node as { marks?: { type?: string; attrs?: { by?: string } }[]; content?: unknown[] };
    for (const m of n.marks ?? []) if (m.type === 'author' && m.attrs?.by) acc.add(m.attrs.by);
    for (const c of n.content ?? []) authors(c, acc);
    return acc;
  };
  const agentsOnly = (node: unknown): boolean => {
    const by = authors(node);
    return by.size > 0 && [...by].every((a) => a === 'ellie' || a === 'max');
  };
  const strip = (nodes: unknown[] | undefined): unknown[] | undefined =>
    nodes
      ?.filter((n) => (n as { type?: string }).type !== 'q_block' && !agentsOnly(n))
      .map((n) => {
        const node = n as { content?: unknown[] };
        return node.content ? { ...node, content: strip(node.content) } : node;
      });
  json.content = strip(json.content);
  // Round-trip through the schema, so a doc this cannot parse fails here and not mid-run.
  docFromJson(json);
  const now = new Date().toISOString();
  db.prepare('UPDATE notes_docs SET doc_json = @doc, version = @version, updated_at = @now WHERE id = @id').run({
    doc: JSON.stringify(json),
    version: row.version + 1,
    now,
    id: row.id,
  });
  db.prepare('DELETE FROM quiz_outcomes WHERE content_sha = @sha').run({ sha: row.content_sha });
  db.prepare(
    "UPDATE learning_objective_states SET level = 0, evidence_message_ids = '[]', last_moved_at = NULL, taught_at = NULL WHERE file_id = @file",
  ).run({ file: notebookId });
  db.prepare(
    `UPDATE rooms SET state = 'closed', closed_at = @now, pending_turn_id = NULL, pending_turn_due_ts = NULL
      WHERE material_id IN (SELECT id FROM materials WHERE file_id = @file) AND state != 'closed'`,
  ).run({ now, file: notebookId });
}

export function usageIn(
  db: SqlDatabase,
  since: string,
): { calls: number; inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number; estUsd: number } {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS inputTokens, COALESCE(SUM(output_tokens),0) AS outputTokens,
              COALESCE(SUM(cache_write_tokens),0) AS cacheWriteTokens, COALESCE(SUM(cache_read_tokens),0) AS cacheReadTokens,
              COALESCE(SUM(estimated_cost_usd),0) AS estUsd
         FROM llm_usage WHERE created_at >= @since`,
    )
    .get<{ calls: number; inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number; estUsd: number }>({ since });
  return row ?? { calls: 0, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, estUsd: 0 };
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

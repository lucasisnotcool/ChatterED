/**
 * **The research export, readable without SQLite.**
 *
 * Written from the *anonymised copy*, so every scrub the database got, these files got too. The
 * database file in the export stays the complete record; these are the views a researcher opens
 * first. Every section tolerates a missing table or column — an export from an older install, or
 * a newer one, must still come out.
 *
 *   readable/transcripts/<room_id>.json   one per room: its threads, in order, each with its turns
 *   readable/notes/<doc_id>.json           one per notes document: plain text, the doc, its edits
 *   readable/progress.json                 objective trees and states, quiz outcomes, the old ledger
 *   readable/usage.csv                     the cost ledger, via `cost/export.ts` `toCsv`
 *   readable/events.jsonl                  the room event log, one event per line
 *   readable/files.json                    which file id is which file name
 *   readable/settings.json                 settings, secrets already removed
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SqlDatabase } from '../db/driver.js';
import { toCsv } from '../cost/export.js';
import type { UsageRow } from '../cost/ledger.js';
import { hasColumn, listTables, quoteIdent } from './anonymise.js';

type Row = Record<string, unknown>;

/** A JSON column, parsed when it parses; the raw string when it does not. */
function json(value: unknown): unknown {
  if (typeof value !== 'string' || value === '') return value ?? null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** File names come from ids we minted, but an id is still not a path: keep it to a safe charset. */
function safeName(id: string): string {
  return id.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120) || 'unnamed';
}

function write(path: string, body: string): void {
  writeFileSync(path, body, 'utf8');
}

function writeJson(path: string, value: unknown): void {
  write(path, `${JSON.stringify(value, null, 2)}\n`);
}

class Reader {
  readonly #tables: Set<string>;
  constructor(readonly db: SqlDatabase) {
    this.#tables = new Set(listTables(db));
  }
  has(table: string): boolean {
    return this.#tables.has(table);
  }
  col(table: string, column: string): boolean {
    return this.has(table) && hasColumn(this.db, table, column);
  }
  /** `SELECT * FROM table [ORDER BY …]`, or nothing when the table is not there. */
  all(table: string, orderBy?: string): Row[] {
    if (!this.has(table)) return [];
    const order = orderBy ? ` ORDER BY ${orderBy}` : '';
    try {
      return this.db.prepare(`SELECT * FROM ${quoteIdent(table)}${order}`).all<Row>();
    } catch {
      return this.db.prepare(`SELECT * FROM ${quoteIdent(table)}`).all<Row>();
    }
  }
}

// ── Notes documents ──────────────────────────────────────────────────────────────────────────

interface PmNode {
  type?: string;
  text?: string;
  content?: PmNode[];
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
  attrs?: Record<string, unknown>;
}

const BLOCKS = new Set(['paragraph', 'heading', 'code_block', 'blockquote', 'list_item', 'figure', 'math_block']);

/**
 * The document as plain text, one block per paragraph, and how many characters each author wrote
 * (`author` mark `by`: `ingest`, `ellie`, `max`, `user`; unmarked text counts as `unmarked`).
 */
export function docPlainText(doc: unknown): { text: string; charsByAuthor: Record<string, number> } {
  const blocks: string[] = [];
  const charsByAuthor: Record<string, number> = {};
  let current = '';
  const walk = (node: PmNode): void => {
    if (typeof node.text === 'string') {
      current += node.text;
      const by = node.marks?.find((m) => m.type === 'author')?.attrs?.by;
      const key = typeof by === 'string' ? by : 'unmarked';
      charsByAuthor[key] = (charsByAuthor[key] ?? 0) + node.text.length;
      return;
    }
    const isBlock = BLOCKS.has(node.type ?? '');
    if (isBlock && current.trim()) {
      blocks.push(current.trim());
      current = '';
    }
    if (node.type === 'heading') current += `${'#'.repeat(Number(node.attrs?.level ?? 1) || 1)} `;
    if (node.type === 'list_item') current += '- ';
    if (node.type === 'hard_break') current += '\n';
    for (const child of node.content ?? []) walk(child);
    if (isBlock && current.trim()) {
      blocks.push(current.trim());
      current = '';
    }
  };
  if (doc && typeof doc === 'object') walk(doc as PmNode);
  if (current.trim()) blocks.push(current.trim());
  return { text: blocks.join('\n\n'), charsByAuthor };
}

// ── The writer ───────────────────────────────────────────────────────────────────────────────

export interface ReadableReport {
  transcripts: number;
  notesDocs: number;
  usageRows: number;
  events: number;
}

export function writeReadable(db: SqlDatabase, outDir: string): ReadableReport {
  const r = new Reader(db);
  const dir = join(outDir, 'readable');
  mkdirSync(join(dir, 'transcripts'), { recursive: true });
  mkdirSync(join(dir, 'notes'), { recursive: true });

  // Files: the id → name map every other section refers to.
  const files = r.all('files', 'rel_path').map((f) => ({
    id: f.id,
    name: f.name,
    relPath: f.rel_path,
    kind: f.kind,
    pageCount: f.page_count ?? null,
    topicId: f.topic_id ?? null,
    sha256: f.sha256 ?? null,
  }));
  writeJson(join(dir, 'files.json'), { files, topics: r.all('topics', 'sort_order'), vaults: r.all('vaults') });

  // ── Transcripts ──
  const participants = new Map(r.all('participants').map((p) => [p.id as string, p]));
  const materials = new Map(r.all('materials').map((m) => [m.id as string, m]));
  const threadRows = r.all('notes_threads', 'created_at');
  const messages = r.all('messages', 'room_id, seq');
  const whispers = r.all('whispers', 'room_id, thread_id, seq');
  const rooms = r.all('rooms', 'created_at');
  const sessions = r.all('sessions', 'started_at');

  for (const room of rooms) {
    const roomId = String(room.id);
    const material = materials.get(String(room.material_id));
    const roomMessages = messages.filter((m) => m.room_id === roomId);
    const registry = threadRows.filter((t) => t.room_id === roomId);

    // A thread id IS a `messages.anchor_id` (repos/threads.ts). Order: registry first, then any
    // anchor the registry does not know (the older flow's segments), then the unanchored turns.
    const anchors: (string | null)[] = [];
    for (const t of registry) if (!anchors.includes(String(t.thread_id))) anchors.push(String(t.thread_id));
    for (const m of roomMessages) {
      const a = (m.anchor_id as string | null) ?? null;
      if (!anchors.includes(a)) anchors.push(a);
    }

    const threads = anchors
      .map((anchor) => {
        const reg = registry.find((t) => t.thread_id === anchor);
        const turns = roomMessages
          .filter((m) => ((m.anchor_id as string | null) ?? null) === anchor)
          .map((m) => {
            const p = participants.get(String(m.participant_id));
            return {
              seq: m.seq,
              id: m.id,
              at: m.created_at,
              releasedAt: m.released_at ?? null,
              author: p?.display_name ?? null,
              authorKind: p?.kind ?? null,
              agentKey: p?.agent_key ?? null,
              kind: m.kind ?? null,
              text: m.body,
              model: m.model ?? null,
              turnId: m.turn_id ?? null,
              objectiveId: m.objective_id ?? null,
              stopped: m.stopped ?? null,
            };
          });
        return {
          threadId: anchor,
          kind: reg?.kind ?? (anchor === null ? 'unanchored' : 'anchor'),
          blockId: reg?.block_id ?? null,
          quote: reg?.span_quote ?? null,
          agentKey: reg?.agent_key ?? null,
          objectiveId: reg?.objective_id ?? null,
          createdAt: reg?.created_at ?? turns[0]?.at ?? null,
          resolvedAt: reg?.resolved_at ?? null,
          turns,
        };
      })
      .filter((t) => t.turns.length > 0 || t.kind !== 'unanchored');

    const privateThreads = new Map<string, Row[]>();
    for (const w of whispers.filter((x) => x.room_id === roomId)) {
      const k = String(w.thread_id);
      privateThreads.set(k, [...(privateThreads.get(k) ?? []), w]);
    }

    writeJson(join(dir, 'transcripts', `${safeName(roomId)}.json`), {
      room: {
        id: roomId,
        topic: room.topic ?? null,
        state: room.state ?? null,
        createdAt: room.created_at ?? null,
        closedAt: room.closed_at ?? null,
        material: material
          ? { id: material.id, title: material.title, fileId: material.file_id ?? null, pageFrom: material.page_from, pageTo: material.page_to }
          : null,
      },
      sessions: sessions.filter((s) => s.room_id === roomId),
      threads,
      privateThreads: [...privateThreads.entries()].map(([threadId, turns]) => {
        const reg = registry.find((t) => t.thread_id === threadId);
        return {
          threadId,
          agentKey: reg?.agent_key ?? participants.get(String(turns[0]?.agent_participant_id))?.agent_key ?? null,
          turns: turns.map((w) => ({
            seq: w.seq,
            at: w.created_at,
            sender: w.sender,
            text: w.body,
            turnId: w.turn_id ?? null,
            promotedMessageId: w.promoted_message_id ?? null,
          })),
        };
      }),
    });
  }

  // ── Notes documents ──
  const edits = r.all('notes_doc_edits', 'created_at');
  const suggestions = r.all('notes_suggestions', 'created_at');
  const docs = r.all('notes_docs', 'created_at');
  for (const d of docs) {
    const doc = json(d.doc_json);
    const plain = docPlainText(doc);
    writeJson(join(dir, 'notes', `${safeName(String(d.id))}.json`), {
      id: d.id,
      title: d.title,
      fileId: d.file_id ?? null,
      contentSha: d.content_sha ?? null,
      version: d.version ?? null,
      ingestStatus: d.ingest_status ?? null,
      model: d.model ?? null,
      frozen: d.frozen ?? null,
      learnerTouched: d.learner_touched ?? null,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      charsByAuthor: plain.charsByAuthor,
      text: plain.text,
      edits: edits
        .filter((e) => e.doc_id === d.id)
        .map((e) => ({ ...e, ops_json: json(e.ops_json), block_ids: json(e.block_ids) })),
      suggestions: suggestions.filter((s) => s.doc_id === d.id),
      objectiveBlocks: r.all('notes_objective_blocks').filter((b) => b.doc_id === d.id),
      doc,
    });
  }

  // ── Progress ──
  writeJson(join(dir, 'progress.json'), {
    learningTrees: r.all('learning_trees', 'created_at').map((t) => ({ ...t, json: json(t.json) })),
    objectiveStates: r
      .all('learning_objective_states', 'file_id, objective_id')
      .map((s) => ({ ...s, evidence_message_ids: json(s.evidence_message_ids) })),
    quizOutcomes: r.all('quiz_outcomes', 'created_at'),
    ledger: r.all('ledger', 'session_id, element_id'),
    ledgerHistory: r.all('ledger_history', 'id'),
    turnDecisions: r.all('turn_decisions', 'created_at'),
  });

  // ── Usage ──
  const usage = r.all('llm_usage', 'created_at') as unknown as UsageRow[];
  write(join(dir, 'usage.csv'), toCsv(usage));

  // ── The event log ──
  const events = r.all('events', 'id');
  write(
    join(dir, 'events.jsonl'),
    events.map((e) => JSON.stringify({ ...e, envelope: json(e.envelope), payload: json(e.payload) })).join('\n') +
      (events.length ? '\n' : ''),
  );

  // ── Settings ──
  const settings = r.col('settings', 'key') ? r.all('settings', 'key') : [];
  writeJson(
    join(dir, 'settings.json'),
    Object.fromEntries(settings.map((s) => [String(s.key), s.value])),
  );

  return { transcripts: rooms.length, notesDocs: docs.length, usageRows: usage.length, events: events.length };
}

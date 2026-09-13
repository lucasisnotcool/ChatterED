/**
 * Typed queries for everything except whispers (which live in their own module so the
 * whisper invariant can be enforced by import restriction — architecture-mac.md §D.4).
 */
import type {
  AgentsRepo,
  EventsRepo,
  LedgerRepo,
  MaterialsRepo,
  MessagesRepo,
  OutboxRepo,
  ParticipantsRepo,
  RoomsRepo,
  SessionsRepo,
  TurnDecisionsRepo,
  UsersRepo,
} from '../../../room/ports.js';
import type {
  AgentRow,
  EventRow,
  LedgerHistoryRow,
  LedgerRow,
  MaterialRow,
  MessageRow,
  OutboxRow,
  ParticipantRow,
  RoomRow,
  SessionRow,
  UserRow,
} from '../../../room/records.js';
import type { SqlDatabase } from '../driver.js';
import { insert, plain, plainAll, updateById } from '../sql.js';

export function usersRepo(db: SqlDatabase): UsersRepo {
  return {
    get: (id) => plain(db.prepare('SELECT * FROM users WHERE id = @id').get<UserRow>({ id })),
    ensure(row) {
      const existing = plain(db.prepare('SELECT * FROM users WHERE id = @id').get<UserRow>({ id: row.id }));
      if (existing) return existing;
      insert(db, 'users', row as unknown as Record<string, unknown>);
      return row;
    },
  };
}

export function materialsRepo(db: SqlDatabase): MaterialsRepo {
  return {
    get: (id) => plain(db.prepare('SELECT * FROM materials WHERE id = @id').get<MaterialRow>({ id })),
    insert: (row) => insert(db, 'materials', row as unknown as Record<string, unknown>),
    confirmPack: (id, confirmedAt) => updateById(db, 'materials', id, { pack_confirmed_at: confirmedAt }),
  };
}

export function roomsRepo(db: SqlDatabase): RoomsRepo {
  return {
    get: (id) => plain(db.prepare('SELECT * FROM rooms WHERE id = @id').get<RoomRow>({ id })),
    insert: (row) => insert(db, 'rooms', row as unknown as Record<string, unknown>),
    openOrScheduled: () =>
      plainAll(
        db
          .prepare(`SELECT * FROM rooms WHERE state IN ('open','agent_scheduled','agent_speaking')`)
          .all<RoomRow>(),
      ),
    update: (id, patch) => updateById(db, 'rooms', id, patch as Record<string, unknown>),
  };
}

export function messagesRepo(db: SqlDatabase): MessagesRepo {
  return {
    insert: (row) => insert(db, 'messages', row as unknown as Record<string, unknown>),
    forRoom: (roomId) =>
      plainAll(db.prepare('SELECT * FROM messages WHERE room_id = @r ORDER BY seq').all<MessageRow>({ r: roomId })),
    forRoomUpToSeq: (roomId, seq) =>
      plainAll(
        db
          .prepare('SELECT * FROM messages WHERE room_id = @r AND seq <= @s ORDER BY seq')
          .all<MessageRow>({ r: roomId, s: seq }),
      ),
    tail: (roomId, n) =>
      plainAll(
        db
          .prepare('SELECT * FROM messages WHERE room_id = @r ORDER BY seq DESC LIMIT @n')
          .all<MessageRow>({ r: roomId, n }),
      ).reverse(),
    bodyAtSeq: (roomId, seq) =>
      db.prepare('SELECT body FROM messages WHERE room_id = @r AND seq = @s').get<{ body: string }>({
        r: roomId,
        s: seq,
      })?.body,
    get: (id) => plain(db.prepare('SELECT * FROM messages WHERE id = @id').get<MessageRow>({ id })),
    maxSeq: (roomId) =>
      db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM messages WHERE room_id = @r').get<{ m: number }>({
        r: roomId,
      })?.m ?? 0,
  };
}

export function participantsRepo(db: SqlDatabase): ParticipantsRepo {
  return {
    forRoom: (roomId) =>
      plainAll(
        db.prepare('SELECT * FROM participants WHERE room_id = @r ORDER BY joined_at').all<ParticipantRow>({
          r: roomId,
        }),
      ),
    insert: (row) => insert(db, 'participants', row as unknown as Record<string, unknown>),
    student: (roomId) =>
      plain(
        db
          .prepare(`SELECT * FROM participants WHERE room_id = @r AND kind = 'student' LIMIT 1`)
          .get<ParticipantRow>({ r: roomId }),
      ),
    byAgentKey: (roomId, agentKey) =>
      plain(
        db
          .prepare('SELECT * FROM participants WHERE room_id = @r AND agent_key = @k LIMIT 1')
          .get<ParticipantRow>({ r: roomId, k: agentKey }),
      ),
    get: (id) => plain(db.prepare('SELECT * FROM participants WHERE id = @id').get<ParticipantRow>({ id })),
  };
}

export function sessionsRepo(db: SqlDatabase): SessionsRepo {
  return {
    get: (id) => plain(db.prepare('SELECT * FROM sessions WHERE id = @id').get<SessionRow>({ id })),
    forRoom: (roomId) =>
      plain(
        db
          .prepare('SELECT * FROM sessions WHERE room_id = @r ORDER BY started_at DESC LIMIT 1')
          .get<SessionRow>({ r: roomId }),
      ),
    insert: (row) => insert(db, 'sessions', row as unknown as Record<string, unknown>),
    end: (id, endedAt, reason) => updateById(db, 'sessions', id, { ended_at: endedAt, end_reason: reason }),
    recent: (limit) =>
      plainAll(db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT @n').all<SessionRow>({ n: limit })),
  };
}

export function ledgerRepo(db: SqlDatabase): LedgerRepo {
  return {
    forSession: (sessionId) =>
      plainAll(
        db.prepare('SELECT * FROM ledger WHERE session_id = @s ORDER BY element_id').all<LedgerRow>({ s: sessionId }),
      ),
    upsert(row) {
      const existing = db
        .prepare('SELECT id FROM ledger WHERE session_id = @s AND element_id = @e')
        .get<{ id: string }>({ s: row.session_id, e: row.element_id });
      if (existing) {
        const { id: _id, ...patch } = row;
        updateById(db, 'ledger', existing.id, patch as unknown as Record<string, unknown>);
      } else {
        insert(db, 'ledger', row as unknown as Record<string, unknown>);
      }
    },
    appendHistory: (row) => insert(db, 'ledger_history', row as unknown as Record<string, unknown>),
    historyForSession: (sessionId) =>
      plainAll(
        db
          .prepare('SELECT * FROM ledger_history WHERE session_id = @s ORDER BY id')
          .all<LedgerHistoryRow>({ s: sessionId }),
      ),
  };
}

export function eventsRepo(db: SqlDatabase): EventsRepo {
  return {
    append(row) {
      const seq = row.seq ?? this.nextSeq(row.session_id ?? null);
      insert(db, 'events', { ...row, seq } as unknown as Record<string, unknown>);
    },
    forSession: (sessionId) =>
      plainAll(db.prepare('SELECT * FROM events WHERE session_id = @s ORDER BY seq').all<EventRow>({ s: sessionId })),
    nextSeq: (sessionId) =>
      (db
        .prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM events WHERE session_id IS @s')
        .get<{ m: number }>({ s: sessionId })?.m ?? 0) + 1,
  };
}

export function outboxRepo(db: SqlDatabase): OutboxRepo {
  return {
    enqueue: (row) => insert(db, 'outbox', { ...row, attempts: 0 } as unknown as Record<string, unknown>),
    pending: (limit = 200) =>
      plainAll(
        db.prepare('SELECT * FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT @n').all<OutboxRow>({ n: limit }),
      ),
    markSent: (id, sentAt) => db.prepare('UPDATE outbox SET sent_at = @t WHERE id = @id').run({ t: sentAt, id }),
    markFailed: (id, error) =>
      db.prepare('UPDATE outbox SET attempts = attempts + 1, last_error = @e WHERE id = @id').run({ e: error, id }),
  };
}

export function turnDecisionsRepo(db: SqlDatabase): TurnDecisionsRepo {
  return {
    insert: (row) => insert(db, 'turn_decisions', row as unknown as Record<string, unknown>),
    forRoom: (roomId) =>
      plainAll(
        db.prepare('SELECT * FROM turn_decisions WHERE room_id = @r ORDER BY created_at').all({ r: roomId }),
      ),
  };
}

export function agentsRepo(db: SqlDatabase): AgentsRepo {
  return {
    all: () => plainAll(db.prepare('SELECT * FROM agents ORDER BY key').all<AgentRow>()),
    upsert(row) {
      const existing = db.prepare('SELECT key FROM agents WHERE key = @k').get<{ key: string }>({ k: row.key });
      if (existing) updateById(db, 'agents', row.key, row as unknown as Record<string, unknown>, 'key');
      else insert(db, 'agents', row as unknown as Record<string, unknown>);
    },
  };
}

export interface SettingsRepo {
  get(key: string): string | undefined;
  set(key: string, value: string, now: string): void;
  all(): Record<string, string>;
}

export function settingsRepo(db: SqlDatabase): SettingsRepo {
  return {
    get: (key) => db.prepare('SELECT value FROM settings WHERE key = @k').get<{ value: string }>({ k: key })?.value,
    set(key, value, now) {
      db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (@k, @v, @t)
           ON CONFLICT(key) DO UPDATE SET value = @v, updated_at = @t`,
      ).run({ k: key, v: value, t: now });
    },
    all() {
      const rows = db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },
  };
}

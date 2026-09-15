/**
 * The ports the room package depends on. Nothing here imports Electron, a SQLite driver or
 * Firebase — that is the portability rule from architecture-mac.md §B.1, and it is what makes
 * a Windows build, a Tauri port or a server rehost an adapter rather than a rewrite.
 */

import type { RoomEvent } from '../shared/types.js';
import type {
  AgentRow,
  EventRow,
  LedgerHistoryRow,
  LedgerRow,
  MaterialRow,
  MessageRefRow,
  MessageRow,
  OutboxRow,
  ParticipantRow,
  RoomRow,
  SessionRow,
  TurnDecisionRow,
  UserRow,
  WhisperRow,
} from './records.js';

/** Injected so every timer test can run on a fake clock (architecture-mac.md §H.1). */
export interface Clock {
  now(): number;
  /** Returns a cancel function. The production clock uses a 1 s wall-clock tick. */
  setInterval(fn: () => void, ms: number): () => void;
  setTimeout(fn: () => void, ms: number): () => void;
}

export interface UsersRepo {
  get(id: string): UserRow | undefined;
  /** Creates the single local user on first run if it is not there yet. */
  ensure(row: UserRow): UserRow;
}

export interface MaterialsRepo {
  get(id: string): MaterialRow | undefined;
  insert(row: MaterialRow): void;
  /** The newest material for these bytes of this file — the flow's "reopen, don't duplicate". */
  forFile(fileId: string, sha: string): MaterialRow | undefined;
  confirmPack(id: string, confirmedAt: string): void;
}

export interface MessagesRepo {
  insert(row: MessageRow): void;
  forRoom(roomId: string): MessageRow[];
  forRoomUpToSeq(roomId: string, seq: number): MessageRow[];
  /** One segment's thread, in `seq` order (migration 010's index). */
  forAnchor(roomId: string, anchorId: string): MessageRow[];
  tail(roomId: string, n: number): MessageRow[];
  bodyAtSeq(roomId: string, seq: number): string | undefined;
  get(id: string): MessageRow | undefined;
  maxSeq(roomId: string): number;
}

/**
 * Documents the learner has shown the room (issue #22 decision 4).
 *
 * Unlike whispers, this IS group scope: a reference is a public act, posted into the thread by
 * the learner, and the agents are meant to see it. It therefore belongs in `GroupStore` — the
 * whisper invariant is about whispers, not about everything that carries text.
 */
export interface MessageRefsRepo {
  insert(row: MessageRefRow): void;
  forRoom(roomId: string): MessageRefRow[];
  forMessage(messageId: string): MessageRefRow | undefined;
}

/**
 * PRIVATE. Only src/room/context.ts may import a module that exposes this, and the group
 * branch of the context builder is handed a store view that does not carry it at all
 * (architecture-mac.md §D.4).
 */
export interface WhispersRepo {
  insert(row: WhisperRow): void;
  forThread(threadId: string): WhisperRow[];
  get(id: string): WhisperRow | undefined;
  openThread(roomId: string, agentParticipantId: string): string | undefined;
  markPromoted(whisperId: string, messageId: string): void;
  maxSeq(threadId: string): number;
}

export interface ParticipantsRepo {
  forRoom(roomId: string): ParticipantRow[];
  insert(row: ParticipantRow): void;
  student(roomId: string): ParticipantRow | undefined;
  byAgentKey(roomId: string, agentKey: string): ParticipantRow | undefined;
  get(id: string): ParticipantRow | undefined;
}

export interface RoomsRepo {
  get(id: string): RoomRow | undefined;
  insert(row: RoomRow): void;
  openOrScheduled(): RoomRow[];
  update(id: string, patch: Partial<RoomRow>): void;
}

export interface SessionsRepo {
  get(id: string): SessionRow | undefined;
  forRoom(roomId: string): SessionRow | undefined;
  insert(row: SessionRow): void;
  end(id: string, endedAt: string, reason: string): void;
  recent(limit: number): SessionRow[];
}

export interface LedgerRepo {
  forSession(sessionId: string): LedgerRow[];
  upsert(row: LedgerRow): void;
  appendHistory(row: LedgerHistoryRow): void;
  historyForSession(sessionId: string): LedgerHistoryRow[];
}

export interface EventsRepo {
  append(row: Omit<EventRow, 'seq'> & { seq?: number }): void;
  forSession(sessionId: string): EventRow[];
  nextSeq(sessionId: string | null): number;
}

export interface OutboxRepo {
  enqueue(row: Omit<OutboxRow, 'id' | 'attempts' | 'sent_at'>): void;
  pending(limit?: number): OutboxRow[];
  markSent(id: number, sentAt: string): void;
  markFailed(id: number, error: string): void;
}

export interface TurnDecisionsRepo {
  insert(row: TurnDecisionRow): void;
  forRoom(roomId: string): TurnDecisionRow[];
}

export interface AgentsRepo {
  all(): AgentRow[];
  upsert(row: AgentRow): void;
}

/**
 * The store view that a GROUP-scope prompt is allowed to see. It has no `whispers` member,
 * so a group context builder cannot reach whisper rows even by accident.
 */
export interface GroupStore {
  materials: MaterialsRepo;
  rooms: RoomsRepo;
  messages: MessagesRepo;
  participants: ParticipantsRepo;
  messageRefs: MessageRefsRepo;
}

/** The whisper-scope view: the group view plus the private thread. */
export interface WhisperStore extends GroupStore {
  whispers: WhispersRepo;
}

export interface Store extends WhisperStore {
  users: UsersRepo;
  sessions: SessionsRepo;
  ledger: LedgerRepo;
  events: EventsRepo;
  outbox: OutboxRepo;
  turnDecisions: TurnDecisionsRepo;
  agents: AgentsRepo;
  transaction<T>(fn: () => T): T;
}

/** How the room actor talks to the outside world (the renderer, in this build). */
export interface Transport {
  emit(event: RoomEvent): void;
}

/** The Firestore mirror, stubbed for M0/M1 (architecture-mac.md §D.2). */
export interface Mirror {
  readonly enabled: boolean;
  flush(): Promise<{ docs: number; failures: number }>;
}

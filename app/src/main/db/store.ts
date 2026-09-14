/**
 * The composition root for the local store. This is the ONLY module outside
 * `src/room/context.whisper.ts` that is allowed to import the whispers repository, and it
 * exists so that everything downstream can be handed a *narrowed* view of the store.
 *
 * `groupView(store)` is that narrowing: the object it returns has no `whispers` member, so a
 * group-scope prompt assembler cannot reach a whisper row even by reflection. That is the
 * runtime half of the invariant in architecture-mac.md §D.4; the static half is the import
 * restriction in eslint.config.mjs plus the import-graph assertion in context.test.ts.
 */
import type { GroupStore, Store } from '../../room/ports.js';
import type { SqlDatabase } from './driver.js';
import {
  agentsRepo,
  eventsRepo,
  ledgerRepo,
  materialsRepo,
  messageRefsRepo,
  messagesRepo,
  outboxRepo,
  participantsRepo,
  roomsRepo,
  sessionsRepo,
  settingsRepo,
  turnDecisionsRepo,
  usersRepo,
  type SettingsRepo,
} from './repos/core.js';
// eslint-disable-next-line no-restricted-imports -- composition root; see the note above.
import { whispersRepo } from './repos/whispers.js';

export interface LocalStore extends Store {
  settings: SettingsRepo;
}

export function createStore(db: SqlDatabase): LocalStore {
  return {
    users: usersRepo(db),
    materials: materialsRepo(db),
    rooms: roomsRepo(db),
    messages: messagesRepo(db),
    messageRefs: messageRefsRepo(db),
    participants: participantsRepo(db),
    whispers: whispersRepo(db),
    sessions: sessionsRepo(db),
    ledger: ledgerRepo(db),
    events: eventsRepo(db),
    outbox: outboxRepo(db),
    turnDecisions: turnDecisionsRepo(db),
    agents: agentsRepo(db),
    settings: settingsRepo(db),
    transaction<T>(fn: () => T): T {
      db.exec('BEGIN');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

/** Strip the store down to what a group-scope prompt may see. */
export function groupView(store: Store): GroupStore {
  return {
    materials: store.materials,
    rooms: store.rooms,
    messages: store.messages,
    participants: store.participants,
    messageRefs: store.messageRefs,
  };
}

/**
 * The whispers repository. PRIVATE by construction.
 *
 * Only two modules may import this file: `src/room/context.whisper.ts` (the whisper-scope
 * context builder) and `src/main/db/store.ts` (the composition root, which assembles the
 * Store and hands the group-scope builder a *narrowed* view with no `whispers` member at all).
 * ESLint enforces the import restriction; `src/room/context.test.ts` enforces the rest, both
 * at runtime and by walking the static import graph. See architecture-mac.md §D.4.
 */
import type { WhispersRepo } from '../../../room/ports.js';
import type { WhisperRow } from '../../../room/records.js';
import type { SqlDatabase } from '../driver.js';
import { insert, plain, plainAll, updateById } from '../sql.js';

export function whispersRepo(db: SqlDatabase): WhispersRepo {
  return {
    insert(row) {
      insert(db, 'whispers', row as unknown as Record<string, unknown>);
    },
    forThread(threadId) {
      return plainAll(
        db
          .prepare('SELECT * FROM whispers WHERE thread_id = @t ORDER BY seq')
          .all<WhisperRow>({ t: threadId }),
      );
    },
    get(id) {
      return plain(db.prepare('SELECT * FROM whispers WHERE id = @id').get<WhisperRow>({ id }));
    },
    openThread(roomId, agentParticipantId) {
      const row = db
        .prepare(
          `SELECT thread_id FROM whispers
            WHERE room_id = @r AND agent_participant_id = @a
            ORDER BY created_at DESC LIMIT 1`,
        )
        .get<{ thread_id: string }>({ r: roomId, a: agentParticipantId });
      return row?.thread_id;
    },
    markPromoted(whisperId, messageId) {
      updateById(db, 'whispers', whisperId, { promoted_message_id: messageId });
    },
    maxSeq(threadId) {
      const row = db
        .prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM whispers WHERE thread_id = @t')
        .get<{ m: number }>({ t: threadId });
      return row?.m ?? 0;
    },
  };
}

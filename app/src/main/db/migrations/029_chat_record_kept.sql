-- 029 — the conversation record is never deleted (2026-10-06).
--
-- What a learner said to Ellie and Max, and what they said back, is the study's data. Until now
-- that was kept by convention: New Conversation (`chat:reset`) retires the room and leaves its
-- rows, and deleting a notebook keeps its room the same way. No code path deleted a message.
-- This makes the convention a property of the database, so that a later code path cannot break it
-- by accident either.
--
--   * **No DELETE** on `rooms`, `sessions`, `participants`, `messages`, `whispers` (the private
--     threads with Ellie and Max), `turn_decisions`, `events` and `ledger_history`. A delete
--     aborts with an error. FK cascades fire triggers, so deleting a room is refused too.
--   * **A whisper's body is never rewritten.** Nothing rewrites one today.
--   * **A message's body may change** (a regenerated summary card replaces its text; a doc-edit
--     note is appended to a reply), so the text it had is copied to `message_revisions` first.
--     `replaced_at` is when the new text was written.
--   * **`notes_threads`**: an empty thread that a refused or failed block action registered is
--     still discarded (`docroom/ipc.ts`). A thread with any message or whisper in it is not: that
--     delete is skipped silently, so the discard path cannot mask the error it is cleaning up after.
--
-- The research export anonymises a *copy* of this database, and drops these triggers on that copy
-- before it rewrites text (`research/anonymise.ts`). A later migration that rebuilds one of these
-- tables (copy, DROP, RENAME) drops its triggers with it and must create them again;
-- `chatrecord.test.ts` fails if one is missing.
-- 001-028 are not touched.

CREATE TABLE message_revisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id   TEXT NOT NULL,
  room_id      TEXT NOT NULL,
  body         TEXT NOT NULL,
  released_at  TEXT,
  replaced_at  TEXT NOT NULL
);
CREATE INDEX idx_message_revisions_message ON message_revisions (message_id, id);

CREATE TRIGGER message_body_revision
AFTER UPDATE OF body ON messages
WHEN OLD.body IS NOT NEW.body
BEGIN
  INSERT INTO message_revisions (message_id, room_id, body, released_at, replaced_at)
  VALUES (OLD.id, OLD.room_id, OLD.body, OLD.released_at,
          COALESCE(NEW.released_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
END;

CREATE TRIGGER whisper_body_kept
BEFORE UPDATE OF body ON whispers
WHEN OLD.body IS NOT NEW.body
BEGIN
  SELECT RAISE(ABORT, 'chat record: a private message is never rewritten');
END;

CREATE TRIGGER rooms_kept BEFORE DELETE ON rooms
BEGIN SELECT RAISE(ABORT, 'chat record: rooms are never deleted'); END;

CREATE TRIGGER sessions_kept BEFORE DELETE ON sessions
BEGIN SELECT RAISE(ABORT, 'chat record: sessions are never deleted'); END;

CREATE TRIGGER participants_kept BEFORE DELETE ON participants
BEGIN SELECT RAISE(ABORT, 'chat record: participants are never deleted'); END;

CREATE TRIGGER messages_kept BEFORE DELETE ON messages
BEGIN SELECT RAISE(ABORT, 'chat record: messages are never deleted'); END;

CREATE TRIGGER message_revisions_kept BEFORE DELETE ON message_revisions
BEGIN SELECT RAISE(ABORT, 'chat record: message revisions are never deleted'); END;

CREATE TRIGGER whispers_kept BEFORE DELETE ON whispers
BEGIN SELECT RAISE(ABORT, 'chat record: private messages are never deleted'); END;

CREATE TRIGGER turn_decisions_kept BEFORE DELETE ON turn_decisions
BEGIN SELECT RAISE(ABORT, 'chat record: turn decisions are never deleted'); END;

CREATE TRIGGER events_kept BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'chat record: events are never deleted'); END;

CREATE TRIGGER ledger_history_kept BEFORE DELETE ON ledger_history
BEGIN SELECT RAISE(ABORT, 'chat record: ledger history is never deleted'); END;

CREATE TRIGGER notes_threads_kept_when_used
BEFORE DELETE ON notes_threads
WHEN EXISTS (SELECT 1 FROM messages WHERE room_id = OLD.room_id AND anchor_id = OLD.thread_id)
  OR EXISTS (SELECT 1 FROM whispers WHERE room_id = OLD.room_id AND thread_id = OLD.thread_id)
BEGIN
  SELECT RAISE(IGNORE);
END;

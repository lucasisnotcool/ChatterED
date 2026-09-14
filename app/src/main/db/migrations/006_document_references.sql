-- Issue #22 decisions 4 and 5 — "Show the room", and the topic the room is in.
--
-- A room has exactly one `material` (001_init.sql) and `rooms.material_id` is a single FK, so
-- there is nowhere to put the second, third, nth document a learner brings over mid-session.
-- Mutating `materials` would be worse than nowhere: `materials.prefix_sha256` is frozen at pack
-- confirmation and asserted on every turn (architecture-mac.md §E.3 L1119), and editing the row
-- the prefix was hashed from is exactly the drift that check exists to catch.
--
-- So a reference is its own row, attached to the learner's own message. It is the learner
-- saying "look at this", recorded the way everything else the learner says is recorded.

CREATE TABLE message_refs (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  -- The vault file id. Nullable, and deliberately not a foreign key: a re-scan may remove the
  -- row the learner referenced, and the transcript must still say what they showed the room.
  file_id     TEXT,
  file_name   TEXT NOT NULL,
  rel_path    TEXT NOT NULL,
  kind        TEXT NOT NULL,
  page_from   INTEGER,
  page_to     INTEGER,
  -- What the learner had selected, capped at 1,500 characters before it gets here.
  selection   TEXT,
  -- The extracted page text the agents are given as context. Local-only, like every other copy
  -- of lecture material in this database (§D.3 L862: it is copyrighted).
  page_text   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX message_refs_by_message ON message_refs (message_id);
CREATE INDEX message_refs_by_room ON message_refs (room_id, created_at);

-- Issue #22 decision 5: the agents should know which module folder they are in.
--
-- It goes on `materials` rather than being assembled per turn, because `sharedBlock()` is
-- rebuilt from this row on every single turn and must come out **byte-identical** every time
-- (§E.2 L1077). A topic name and file list read live from the vault would change the moment the
-- learner saved a file into that folder, silently invalidating the cached prefix mid-session.
-- Frozen here at session creation, sorted and capped, it cannot.
ALTER TABLE materials ADD COLUMN topic_context TEXT NOT NULL DEFAULT '';

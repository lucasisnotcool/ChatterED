-- ChatterED local data model — architecture-mac.md §D.1, ported from §C.2 of architecture-options.md.
-- SQLite is the authoritative store; Firestore (not in M0/M1) is downstream of it, never upstream.
-- No column anywhere may hold a name, matric number or NUSNET id.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,          -- 'P1'..'Pn' — the only human-facing handle
  firebase_uid  TEXT UNIQUE,
  programme     TEXT,
  year_of_study INTEGER,
  gender        TEXT,
  is_test       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE consents (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  study_id     TEXT NOT NULL,
  version      TEXT NOT NULL,                  -- sha256 of the consent text actually shown
  method       TEXT NOT NULL,
  scope        TEXT NOT NULL,
  granted_at   TEXT NOT NULL,
  withdrawn_at TEXT
);

CREATE TABLE materials (
  id             TEXT PRIMARY KEY,
  module_code    TEXT NOT NULL,
  title          TEXT NOT NULL,
  source_kind    TEXT NOT NULL CHECK (source_kind IN ('pdf_pages','pasted_text')),
  file_path      TEXT,
  file_sha256    TEXT,
  file_mtime     TEXT,
  page_from      INTEGER,
  page_to        INTEGER,
  page_count     INTEGER,
  extracted_text TEXT NOT NULL,
  extract_engine TEXT NOT NULL CHECK (extract_engine IN ('pdfjs','claude-pdf','paste')),
  padding_text   TEXT NOT NULL DEFAULT '',
  concept_pack   TEXT NOT NULL,                -- json, progress-tracking.md §3
  pack_provenance TEXT NOT NULL CHECK (pack_provenance IN ('fixed','elicited')),
  pack_confirmed_at TEXT,
  token_count    INTEGER NOT NULL,
  -- Haiku 4.5's cache floor is 4,096 tokens. A material under it still works; it is recorded
  -- as cache_ineligible so the 3x cost is visible rather than mysterious (architecture-mac.md §E.2).
  cache_eligible INTEGER NOT NULL DEFAULT 1,
  prefix_sha256  TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  CHECK (source_kind <> 'pdf_pages' OR (file_path IS NOT NULL AND page_from IS NOT NULL)),
  CHECK (cache_eligible = 0 OR token_count >= 4096)
);

CREATE TABLE agents (
  key             TEXT PRIMARY KEY,            -- 'peer.ellie' | 'challenger.max' | 'tutee.theo' | 'whisper'
  role            TEXT NOT NULL CHECK (role IN ('peer','challenger','tutee','whisper')),
  display_name    TEXT NOT NULL,
  colour          TEXT NOT NULL,
  prompt_version  TEXT NOT NULL,
  model           TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
  latency_profile TEXT NOT NULL
);

CREATE TABLE rooms (
  id                      TEXT PRIMARY KEY,
  module_code             TEXT NOT NULL,
  material_id             TEXT NOT NULL REFERENCES materials(id),
  topic                   TEXT NOT NULL,
  state                   TEXT NOT NULL CHECK (state IN ('open','agent_scheduled','agent_speaking','closed')),
  turn_seq                INTEGER NOT NULL DEFAULT 0,
  expects_reply           INTEGER NOT NULL DEFAULT 0,
  last_activity_ts        TEXT,
  deadline_ts             TEXT,                -- R2: the row IS the timer
  cumulative_idle_ms      INTEGER NOT NULL DEFAULT 0,
  window_extension_ms     INTEGER NOT NULL DEFAULT 0,
  timer_epoch             INTEGER NOT NULL DEFAULT 0,
  consecutive_agent_turns INTEGER NOT NULL DEFAULT 0,
  agreement_run           INTEGER NOT NULL DEFAULT 0,
  last_speaker_id         TEXT,
  pending_turn_id         TEXT,
  pending_turn_due_ts     TEXT,
  nudge_fires_this_round  INTEGER NOT NULL DEFAULT 0,
  nudges_paused           INTEGER NOT NULL DEFAULT 0,
  config                  TEXT NOT NULL,
  created_at              TEXT NOT NULL,
  closed_at               TEXT
);

CREATE TABLE participants (
  id           TEXT PRIMARY KEY,
  room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('student','agent')),
  user_id      TEXT REFERENCES users(id),
  agent_key    TEXT REFERENCES agents(key),
  display_name TEXT NOT NULL,
  joined_at    TEXT NOT NULL,
  left_at      TEXT,
  CHECK ((kind = 'student') = (user_id IS NOT NULL))
);
CREATE INDEX idx_participants_room ON participants (room_id);

CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  room_id         TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  study_id        TEXT,
  condition       TEXT,
  latency_profile TEXT NOT NULL,
  silence_ms      INTEGER NOT NULL,
  app_version     TEXT NOT NULL,
  os_version      TEXT NOT NULL,
  started_at      TEXT NOT NULL,
  ended_at        TEXT,
  end_reason      TEXT,
  summary_text    TEXT,
  summary_usage   TEXT
);
CREATE INDEX idx_sessions_room ON sessions (room_id);

-- GROUP transcript only. Whispers live in their own table and are never joined into this one.
CREATE TABLE messages (
  id                    TEXT PRIMARY KEY,
  room_id               TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  participant_id        TEXT NOT NULL REFERENCES participants(id),
  seq                   INTEGER NOT NULL,
  body                  TEXT NOT NULL,
  turn_decision_id      TEXT,
  model                 TEXT,
  usage                 TEXT,
  latency_target_ms     INTEGER,
  ttft_actual_ms        INTEGER,
  released_at           TEXT,
  promoted_from_whisper TEXT,                  -- provenance for the relay; never rendered as a badge
  divider_cause         TEXT,
  disagreement          TEXT,
  created_at            TEXT NOT NULL,
  UNIQUE (room_id, seq)
);

-- PRIVATE. Never joined into group context. See src/room/context.ts and its canary test.
CREATE TABLE whispers (
  id                     TEXT PRIMARY KEY,
  room_id                TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  thread_id              TEXT NOT NULL,
  student_participant_id TEXT NOT NULL REFERENCES participants(id),
  agent_participant_id   TEXT NOT NULL REFERENCES participants(id),
  seq                    INTEGER NOT NULL,
  sender                 TEXT NOT NULL CHECK (sender IN ('student','agent')),
  body                   TEXT NOT NULL,
  group_seq_snapshot     INTEGER NOT NULL,
  relay_offer            TEXT,
  promoted_message_id    TEXT REFERENCES messages(id),
  usage                  TEXT,
  created_at             TEXT NOT NULL,
  UNIQUE (thread_id, seq)
);
CREATE INDEX idx_whispers_thread ON whispers (thread_id, seq);

CREATE TABLE turn_decisions (
  id                    TEXT PRIMARY KEY,
  room_id               TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  trigger               TEXT NOT NULL,
  chosen_participant_id TEXT REFERENCES participants(id),   -- NULL = deliberate silence
  move_type             TEXT,
  target_element_id     TEXT,
  probe_type            TEXT,
  rationale             TEXT,
  decided_by            TEXT NOT NULL,
  usage                 TEXT,
  created_at            TEXT NOT NULL
);

CREATE TABLE ledger (
  id               TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  element_id       TEXT NOT NULL,
  level            INTEGER NOT NULL CHECK (level BETWEEN 0 AND 4),
  level_proposed   INTEGER NOT NULL,
  confidence       REAL,
  evidence_text    TEXT,                       -- MUST be a verbatim substring of a student message
  evidence_msg_id  TEXT REFERENCES messages(id),
  evidence_seq     INTEGER,
  defended_against TEXT,
  revisit          INTEGER NOT NULL DEFAULT 0,
  contested        INTEGER NOT NULL DEFAULT 0,
  misconceptions_open     TEXT NOT NULL DEFAULT '[]',
  misconceptions_resolved TEXT NOT NULL DEFAULT '[]',
  updated_at       TEXT NOT NULL,
  UNIQUE (session_id, element_id)
);

CREATE TABLE ledger_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id     TEXT NOT NULL,
  element_id     TEXT NOT NULL,
  level_before   INTEGER NOT NULL,
  level_proposed INTEGER NOT NULL,
  level_after    INTEGER NOT NULL,
  gate           TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_ledger_history_session ON ledger_history (session_id, id);

CREATE TABLE rubric_scores (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  dimension     TEXT NOT NULL,
  score         INTEGER NOT NULL CHECK (score BETWEEN 0 AND 3),
  justification TEXT NOT NULL,
  scored_by     TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- Append-only. Never UPDATE, never DELETE. evaluation-plan.md §7.1 vocabulary.
CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id    TEXT REFERENCES rooms(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  actor      TEXT NOT NULL,
  type       TEXT NOT NULL,
  envelope   TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}',
  client_ts  TEXT,
  server_ts  TEXT NOT NULL
);
CREATE INDEX idx_events_session ON events (session_id, seq);

-- The whole sync design, in one table. The mirror worker is stubbed for M0/M1.
CREATE TABLE outbox (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  collection  TEXT NOT NULL,
  doc_path    TEXT NOT NULL,                   -- deterministic → idempotent set()
  op          TEXT NOT NULL CHECK (op IN ('set','merge','delete')),
  body        TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  enqueued_at TEXT NOT NULL,
  sent_at     TEXT
);
CREATE INDEX idx_outbox_pending ON outbox (sent_at, id) WHERE sent_at IS NULL;

-- Local-only key/value for app settings. The Anthropic API key is NOT here: it lives in the
-- OS keychain via Electron safeStorage (issue #15), and only a ciphertext blob is ever on disk.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

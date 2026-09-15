/**
 * Test fixtures: a migrated in-memory database and a seeded room.
 * Test-only — this directory is excluded from the main-process build.
 */
import { fileURLToPath } from 'node:url';
import { openTestDatabase, type SqlDatabase } from '../main/db/driver.js';
import { runMigrations } from '../main/db/migrations.js';
import { createStore, type LocalStore } from '../main/db/store.js';
import { PSD_HESSIAN_CONVEXITY_V1, PSD_HESSIAN_SLIDE_TEXT } from '../room/concepts/psd-hessian-convexity-v1.js';
import { rosterFor } from '../room/agents.js';
import { PROMPT_VERSION, stableJson } from '../room/prompts.js';
import type { RoomConfig } from '../room/records.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../main/db/migrations', import.meta.url));

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  silence_ms: 45_000,
  stage_two_ms: 90_000,
  window_extension_cap_ms: 120_000,
  latency_scale: 1,
  whisper_enabled: true,
  mode: 'scripted',
};

/** The migrated database *and* the store over it — AppService needs both (issue #22). */
export function openTestDb(): { db: SqlDatabase; store: LocalStore } {
  const db = openTestDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  return { db, store: createStore(db) };
}

export function openTestStore(): LocalStore {
  return openTestDb().store;
}

export interface SeededRoom {
  store: LocalStore;
  roomId: string;
  sessionId: string;
  materialId: string;
  userId: string;
  studentParticipantId: string;
  peerParticipantId: string;
  challengerParticipantId: string;
  /** 'peer' is the Teacher and 'challenger' is the Tester: the stored strings are unchanged (#32). */
  agentKeys: { peer: string; challenger: string };
}

const T0 = '2026-09-13T10:00:00.000Z';

export function seedRoom(store: LocalStore = openTestStore(), messages: string[] = []): SeededRoom {
  const roster = rosterFor('ellie_peer');
  const userId = 'u_test';
  const materialId = 'mat_test';
  const roomId = 'room_test';
  const sessionId = 'sess_test';

  store.transaction(() => {
    store.agents.upsert({
      key: 'system',
      role: 'whisper',
      display_name: 'system',
      colour: '#000000',
      prompt_version: PROMPT_VERSION,
      model: 'claude-haiku-4-5',
      latency_profile: '{}',
    });
    for (const a of roster) {
      store.agents.upsert({
        key: a.key,
        role: a.role,
        display_name: a.displayName,
        colour: a.colour,
        prompt_version: PROMPT_VERSION,
        model: a.model,
        latency_profile: stableJson(a.latency),
      });
    }

    store.users.ensure({
      id: userId,
      code: 'P0',
      firebase_uid: null,
      programme: null,
      year_of_study: null,
      gender: null,
      is_test: 1,
      created_at: T0,
    });

    store.materials.insert({
      id: materialId,
      module_code: 'MA3236',
      title: 'Convexity and the Hessian',
      source_kind: 'pasted_text',
      file_path: null,
    file_id: null,
      file_sha256: null,
      file_mtime: null,
      page_from: null,
      page_to: null,
      page_count: null,
      extracted_text: PSD_HESSIAN_SLIDE_TEXT,
      extract_engine: 'paste',
      padding_text: '',
      topic_context: '',
      concept_pack: stableJson(PSD_HESSIAN_CONVEXITY_V1),
      pack_provenance: 'fixed',
      pack_confirmed_at: T0,
      token_count: 4600,
      cache_eligible: 1,
      prefix_sha256: 'test-prefix',
      created_at: T0,
    });

    store.rooms.insert({
      id: roomId,
      module_code: 'MA3236',
      material_id: materialId,
      topic: 'convexity and the Hessian',
      state: 'open',
      turn_seq: 0,
      expects_reply: 0,
      last_activity_ts: T0,
      deadline_ts: null,
      cumulative_idle_ms: 0,
      window_extension_ms: 0,
      timer_epoch: 0,
      consecutive_agent_turns: 0,
      agreement_run: 0,
      last_speaker_id: null,
      pending_turn_id: null,
      pending_turn_due_ts: null,
      nudge_fires_this_round: 0,
      nudges_paused: 0,
      config: stableJson(DEFAULT_ROOM_CONFIG),
      created_at: T0,
      closed_at: null,
    });

    store.participants.insert({
      id: 'p_student',
      room_id: roomId,
      kind: 'student',
      user_id: userId,
      agent_key: null,
      display_name: 'You',
      joined_at: T0,
      left_at: null,
    });
    for (const a of roster) {
      store.participants.insert({
        id: `p_${a.role}`,
        room_id: roomId,
        kind: 'agent',
        user_id: null,
        agent_key: a.key,
        display_name: a.displayName,
        joined_at: T0,
        left_at: null,
      });
    }

    store.sessions.insert({
      id: sessionId,
      room_id: roomId,
      user_id: userId,
      study_id: null,
      condition: null,
      latency_profile: 'considered',
      silence_ms: DEFAULT_ROOM_CONFIG.silence_ms,
      app_version: '0.1.0-test',
      os_version: 'test',
      started_at: T0,
      ended_at: null,
      end_reason: null,
      summary_text: null,
      summary_usage: null,
      llm_backend: null,
      agent_model: null,
      orchestrator_model: null,
    });

    for (const e of PSD_HESSIAN_CONVEXITY_V1.elements) {
      store.ledger.upsert({
        id: `led_${e.id}`,
        session_id: sessionId,
        element_id: e.id,
        level: 0,
        level_proposed: 0,
        confidence: null,
        evidence_text: null,
        evidence_msg_id: null,
        evidence_seq: null,
        defended_against: null,
        revisit: 0,
        contested: 0,
        misconceptions_open: '[]',
        misconceptions_resolved: '[]',
        updated_at: T0,
      });
    }

    messages.forEach((body, i) => {
      const seq = i + 1;
      const fromStudent = i % 2 === 1;
      store.messages.insert({
        id: `m_${seq}`,
        room_id: roomId,
        participant_id: fromStudent ? 'p_student' : 'p_peer',
        seq,
        body,
        turn_decision_id: null,
        model: null,
        backend: null,
        usage: null,
        latency_target_ms: null,
        ttft_actual_ms: null,
        released_at: null,
        promoted_from_whisper: null,
        divider_cause: null,
        disagreement: null,
        created_at: T0,
      });
    });
    if (messages.length > 0) store.rooms.update(roomId, { turn_seq: messages.length });
  });

  return {
    store,
    roomId,
    sessionId,
    materialId,
    userId,
    studentParticipantId: 'p_student',
    peerParticipantId: 'p_peer',
    challengerParticipantId: 'p_challenger',
    agentKeys: {
      peer: roster[0]!.key,
      challenger: roster[1]!.key,
    },
  };
}

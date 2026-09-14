/**
 * Row shapes as they exist in SQLite (architecture-mac.md §D.1), expressed as plain TypeScript.
 * This module is part of the portable `room` package: it knows the schema, not the driver.
 *
 * Column names are snake_case to match the DDL exactly, so a query written against the brief
 * still reads. Booleans are 0/1 integers, timestamps are ISO-8601 strings, json is a string.
 */

import type { AgentRole, LedgerLevel, RelayAttribution } from '../shared/types.js';

export interface UserRow {
  id: string;
  code: string;
  firebase_uid: string | null;
  programme: string | null;
  year_of_study: number | null;
  gender: string | null;
  is_test: number;
  created_at: string;
}

export interface MaterialRow {
  id: string;
  module_code: string;
  title: string;
  source_kind: 'pdf_pages' | 'pasted_text';
  file_path: string | null;
  file_sha256: string | null;
  file_mtime: string | null;
  page_from: number | null;
  page_to: number | null;
  page_count: number | null;
  extracted_text: string;
  extract_engine: 'pdfjs' | 'claude-pdf' | 'paste';
  padding_text: string;
  /** json — progress-tracking.md §3 Concept Pack */
  concept_pack: string;
  pack_provenance: 'fixed' | 'elicited';
  pack_confirmed_at: string | null;
  token_count: number;
  cache_eligible: number;
  prefix_sha256: string;
  created_at: string;
}

export interface ConceptElement {
  id: string;
  label: string;
  learner_label: string;
  criteria: Record<'1' | '2' | '3' | '4', string>;
  misconceptions: { id: string; text: string }[];
  probe_seeds: {
    clarification: string;
    reasons_evidence: string;
    assumptions: string;
    implications: string;
    alternatives: string;
  };
}

export interface ConceptPack {
  concept_id: string;
  title: string;
  source: string;
  target_level: LedgerLevel;
  elements: ConceptElement[];
}

export type RoomStateValue = 'open' | 'agent_scheduled' | 'agent_speaking' | 'closed';

export interface RoomRow {
  id: string;
  module_code: string;
  material_id: string;
  topic: string;
  state: RoomStateValue;
  turn_seq: number;
  expects_reply: number;
  last_activity_ts: string | null;
  /** R2: authoritative. Written BEFORE the timer is armed. */
  deadline_ts: string | null;
  cumulative_idle_ms: number;
  window_extension_ms: number;
  timer_epoch: number;
  consecutive_agent_turns: number;
  agreement_run: number;
  last_speaker_id: string | null;
  pending_turn_id: string | null;
  pending_turn_due_ts: string | null;
  nudge_fires_this_round: number;
  nudges_paused: number;
  /** json: { silence_ms, stage_two_ms, latency_scale, whisper_enabled, mode } */
  config: string;
  created_at: string;
  closed_at: string | null;
}

export interface RoomConfig {
  silence_ms: number;
  stage_two_ms: number;
  window_extension_cap_ms: number;
  latency_scale: number;
  whisper_enabled: boolean;
  mode: 'scripted' | 'live';
}

export interface ParticipantRow {
  id: string;
  room_id: string;
  kind: 'student' | 'agent';
  user_id: string | null;
  agent_key: string | null;
  display_name: string;
  joined_at: string;
  left_at: string | null;
}

export interface AgentRow {
  key: string;
  role: AgentRole;
  display_name: string;
  colour: string;
  prompt_version: string;
  model: string;
  /** json {ttft_min_ms, ttft_max_ms} */
  latency_profile: string;
}

export interface SessionRow {
  id: string;
  room_id: string;
  user_id: string;
  study_id: string | null;
  condition: string | null;
  latency_profile: string;
  silence_ms: number;
  app_version: string;
  os_version: string;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
  summary_text: string | null;
  summary_usage: string | null;
  /** 'claude_cli' | 'anthropic' | 'scripted' — the backend this session was opened on (#19). */
  llm_backend: string | null;
  /** The resolved model ids, recorded per session so a transcript can say what produced it. */
  agent_model: string | null;
  orchestrator_model: string | null;
}

export interface MessageRow {
  id: string;
  room_id: string;
  participant_id: string;
  seq: number;
  body: string;
  turn_decision_id: string | null;
  model: string | null;
  /** Which backend produced this row: 'claude_cli' | 'anthropic' | 'scripted' | null (#19). */
  backend: string | null;
  usage: string | null;
  latency_target_ms: number | null;
  ttft_actual_ms: number | null;
  released_at: string | null;
  promoted_from_whisper: string | null;
  divider_cause: string | null;
  disagreement: string | null;
  created_at: string;
}

export interface WhisperRow {
  id: string;
  room_id: string;
  thread_id: string;
  student_participant_id: string;
  agent_participant_id: string;
  seq: number;
  sender: 'student' | 'agent';
  body: string;
  /** Exactly what the group had said by then (critique1-btw.txt T1–T3). */
  group_seq_snapshot: number;
  relay_offer: string | null;
  promoted_message_id: string | null;
  usage: string | null;
  created_at: string;
}

export interface TurnDecisionRow {
  id: string;
  room_id: string;
  trigger: 'student_message' | 'silence' | 'open' | 'promote';
  chosen_participant_id: string | null;
  move_type: string | null;
  target_element_id: string | null;
  probe_type: string | null;
  rationale: string | null;
  decided_by: string;
  /** json array: every element this probe put under test (migration 002). */
  challenged_element_ids: string;
  usage: string | null;
  created_at: string;
}

export interface LedgerRow {
  id: string;
  session_id: string;
  element_id: string;
  level: LedgerLevel;
  level_proposed: LedgerLevel;
  confidence: number | null;
  evidence_text: string | null;
  evidence_msg_id: string | null;
  evidence_seq: number | null;
  defended_against: string | null;
  revisit: number;
  contested: number;
  misconceptions_open: string;
  misconceptions_resolved: string;
  updated_at: string;
}

export type LedgerGate =
  | 'evidence_check_failed'
  | 'low_confidence'
  | 'agreement_not_evidence'
  | 'monotonic'
  | 'downgrade_capped'
  | 'defended_requires_challenge';

export interface LedgerHistoryRow {
  id?: number;
  session_id: string;
  message_id: string;
  element_id: string;
  level_before: LedgerLevel;
  level_proposed: LedgerLevel;
  level_after: LedgerLevel;
  gate: LedgerGate | null;
  created_at: string;
}

export interface EventRow {
  id?: number;
  room_id: string | null;
  session_id: string | null;
  seq: number;
  actor: string;
  type: string;
  /** json: condition, concept_id, prompt_version, app_version */
  envelope: string;
  payload: string;
  client_ts: string | null;
  server_ts: string;
}

export interface OutboxRow {
  id?: number;
  collection: string;
  doc_path: string;
  op: 'set' | 'merge' | 'delete';
  body: string;
  attempts: number;
  last_error: string | null;
  enqueued_at: string;
  sent_at: string | null;
}

export interface RelayRequest {
  roomId: string;
  threadId: string;
  whisperId: string;
  attribution: RelayAttribution;
  text: string;
}

/**
 * Session setup: pasted text (or, later, a PDF page range) → a material with a confirmed
 * Concept Pack → a room with participants and a ledger at level 0.
 *
 * The room cannot open until `pack_confirmed_at` is set (architecture-mac.md §E.3): confirming
 * the claims is the learner's first act of ownership, and it is the moment the cached prefix
 * is frozen and hashed.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { ConceptDraft, CreateSessionInput, RolePairing } from '../shared/types.js';
import { rosterFor } from '../room/agents.js';
import { FIXED_PACKS, PSD_HESSIAN_CONVEXITY_V1 } from '../room/concepts/psd-hessian-convexity-v1.js';
import type { LLMClient } from '../room/llm/types.js';
import { PROMPT_VERSION, sharedBlock, stableJson, topicContextBlock } from '../room/prompts.js';
import type { ConceptPack, MaterialRow, RoomConfig } from '../room/records.js';
import { API_PLAN, type ModelPlan } from '../room/llm/models.js';
import type { LocalStore } from './db/store.js';

/** Haiku 4.5's minimum cacheable prefix (architecture-mac.md §E.2). */
export const CACHE_FLOOR_TOKENS = 4096;
export const CACHE_TARGET_TOKENS = 4600;

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * A planning estimate at ~1.3 tokens/word. The real number must come from
 * `client.messages.count_tokens` (never tiktoken — it is a different tokenizer and it is wrong
 * in exactly the 3,900–4,200 band where it matters). That call is M2; until then the estimate
 * decides `cache_eligible` and the app says so rather than pretending.
 */
export function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.round(words * 1.3);
}

export interface CreatedSession {
  roomId: string;
  sessionId: string;
  materialId: string;
  pack: ConceptPack;
  config: RoomConfig;
}

export interface CreateSessionDeps {
  store: LocalStore;
  pairing: RolePairing;
  appVersion: string;
  osVersion: string;
  mode: 'scripted' | 'live';
  /** Which backend and models this session is being opened on (issue #19). Recorded on the row. */
  backend?: string;
  models?: ModelPlan;
  silenceMs?: number;
  now?: () => string;
}

export function createSession(deps: CreateSessionDeps, input: CreateSessionInput): CreatedSession {
  const now = deps.now ?? (() => new Date().toISOString());
  const models = deps.models ?? API_PLAN;
  const roster = rosterFor(deps.pairing, models.agent);
  const pack = packFor(input);
  const materialId = newId('mat');
  const roomId = newId('room');
  const sessionId = newId('sess');
  const userId = ensureLocalUser(deps.store, now());

  const config: RoomConfig = {
    silence_ms: deps.silenceMs ?? 45_000,
    stage_two_ms: 90_000,
    window_extension_cap_ms: 120_000,
    latency_scale: 1,
    whisper_enabled: true,
    mode: deps.mode,
  };

  const material: MaterialRow = {
    id: materialId,
    module_code: input.moduleCode || 'MA3236',
    title: input.title || pack.title,
    source_kind: input.sourceKind ?? 'pasted_text',
    file_path: input.fileName ?? null,
    file_sha256: createHash('sha256').update(input.text).digest('hex'),
    file_mtime: null,
    page_from: input.pageFrom ?? null,
    page_to: input.pageTo ?? null,
    page_count: null,
    extracted_text: input.text,
    extract_engine: input.sourceKind === 'pdf_pages' ? 'pdfjs' : 'paste',
    padding_text: '',
    // Frozen here, before the prefix is hashed, and never recomputed (issue #22 decision 5).
    topic_context: topicContextBlock(input.topic ?? null),
    concept_pack: stableJson(pack),
    pack_provenance: input.conceptId ? 'fixed' : 'elicited',
    pack_confirmed_at: now(),
    token_count: 0,
    cache_eligible: 0,
    prefix_sha256: '',
    created_at: now(),
  };

  // Freeze and hash the prefix here, once, exactly as §E.3 prescribes.
  const prefix = sharedBlock({ material, pack, topic: material.title, roster });
  material.token_count = estimateTokens(prefix);
  material.cache_eligible = material.token_count >= CACHE_FLOOR_TOKENS ? 1 : 0;
  material.prefix_sha256 = createHash('sha256').update(prefix).digest('hex');

  deps.store.transaction(() => {
    for (const a of roster) {
      deps.store.agents.upsert({
        key: a.key,
        role: a.role,
        display_name: a.displayName,
        colour: a.colour,
        prompt_version: PROMPT_VERSION,
        model: a.model,
        latency_profile: stableJson(a.latency),
      });
    }
    deps.store.materials.insert(material);
    deps.store.rooms.insert({
      id: roomId,
      module_code: material.module_code,
      material_id: materialId,
      topic: material.title,
      state: 'open',
      turn_seq: 0,
      expects_reply: 0,
      last_activity_ts: now(),
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
      config: stableJson(config),
      created_at: now(),
      closed_at: null,
    });
    deps.store.participants.insert({
      id: newId('p'),
      room_id: roomId,
      kind: 'student',
      user_id: userId,
      agent_key: null,
      display_name: 'You',
      joined_at: now(),
      left_at: null,
    });
    for (const a of roster) {
      deps.store.participants.insert({
        id: newId('p'),
        room_id: roomId,
        kind: 'agent',
        user_id: null,
        agent_key: a.key,
        display_name: a.displayName,
        joined_at: now(),
        left_at: null,
      });
    }
    deps.store.sessions.insert({
      id: sessionId,
      room_id: roomId,
      user_id: userId,
      study_id: null,
      condition: null,
      latency_profile: 'considered',
      silence_ms: config.silence_ms,
      app_version: deps.appVersion,
      os_version: deps.osVersion,
      started_at: now(),
      ended_at: null,
      end_reason: null,
      summary_text: null,
      summary_usage: null,
      llm_backend: deps.backend ?? null,
      agent_model: models.agent,
      orchestrator_model: models.orchestrator,
    });
    for (const element of pack.elements) {
      deps.store.ledger.upsert({
        id: newId('led'),
        session_id: sessionId,
        element_id: element.id,
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
        updated_at: now(),
      });
    }
  });

  return { roomId, sessionId, materialId, pack, config };
}

export function ensureLocalUser(store: LocalStore, now: string): string {
  const existing = store.settings.get('local_user_id');
  if (existing) return existing;
  const id = newId('u');
  store.users.ensure({
    id,
    code: 'P1',
    firebase_uid: null,
    programme: null,
    year_of_study: null,
    gender: null,
    is_test: 0,
    created_at: now,
  });
  store.settings.set('local_user_id', id, now);
  return id;
}

function packFor(input: CreateSessionInput): ConceptPack {
  const fixed = input.conceptId ? FIXED_PACKS[input.conceptId] : undefined;
  const base = fixed ?? PSD_HESSIAN_CONVEXITY_V1;
  if (!input.claims || input.claims.length === 0) return base;
  // The learner edited the claim rows: their labels win, and the criteria templates come from
  // the matching base element where there is one.
  return {
    ...base,
    concept_id: fixed ? base.concept_id : `elicited-${createHash('sha1').update(input.title).digest('hex').slice(0, 8)}`,
    title: input.title || base.title,
    elements: input.claims.map((claim, i) => {
      const template = base.elements.find((e) => e.id === claim.id) ?? base.elements[i] ?? base.elements[0]!;
      // Keep the short, learner-facing label unless the learner actually rewrote the claim —
      // the rail is scanned mid-sentence and a full claim sentence does not fit it.
      const edited = claim.label.trim() !== template.label.trim();
      return {
        ...template,
        id: claim.id,
        label: claim.label,
        learner_label: edited ? claim.label : template.learner_label,
      };
    }),
  };
}

const DRAFT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'claims'],
  properties: {
    title: { type: 'string' },
    claims: {
      type: 'array',
      minItems: 3,
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'learner_label', 'level_three_criterion'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          learner_label: { type: 'string' },
          level_three_criterion: { type: 'string' },
        },
      },
    },
  },
};

/**
 * Turn a pasted slide into 3–5 claims for the learner to edit. Runs on the **orchestrator**
 * model of whichever backend is live — Sonnet 5 over the API key, the Settings choice (default
 * `sonnet`) over the local CLI. Structured output, because it is one-shot and it must be
 * reliable at strict JSON (architecture-mac.md §E.1).
 * With no key (or in scripted mode) the committed fixed pack is returned instead, which is
 * also the offline fallback §B.3 prescribes.
 */
export async function draftConcept(
  llm: LLMClient | null,
  input: { moduleCode: string; title: string; text: string },
  models: ModelPlan = API_PLAN,
): Promise<ConceptDraft> {
  if (!llm || llm.kind === 'scripted') return fixedDraft();
  try {
    const result = await llm.complete({
      model: models.orchestrator,
      max_tokens: 1500,
      system: [
        {
          type: 'text',
          text:
            'You extract the 3–5 separable claims a student would have to defend to have explained ' +
            'the attached lecture material. Show what "applied" looks like for each claim. Never ' +
            'invent content that is not in the material.',
        },
      ],
      messages: [
        {
          role: 'user',
          content: `MODULE ${input.moduleCode}\n\nMATERIAL\n${input.text}`,
        },
      ],
      jsonSchema: DRAFT_SCHEMA,
      meta: { scope: 'ingest' },
    });
    const parsed = JSON.parse(result.text) as {
      title: string;
      claims: { id: string; label: string; learner_label: string; level_three_criterion: string }[];
    };
    return {
      conceptId: `elicited-${createHash('sha1').update(input.text).digest('hex').slice(0, 8)}`,
      title: parsed.title || input.title,
      claims: parsed.claims.map((c, i) => ({
        id: c.id || `R${i + 1}`,
        label: c.label,
        learnerLabel: c.learner_label,
        levelThreeCriterion: c.level_three_criterion,
      })),
      provenance: 'elicited',
    };
  } catch {
    return fixedDraft();
  }
}

function fixedDraft(): ConceptDraft {
  return {
    conceptId: PSD_HESSIAN_CONVEXITY_V1.concept_id,
    title: PSD_HESSIAN_CONVEXITY_V1.title,
    claims: PSD_HESSIAN_CONVEXITY_V1.elements.map((e) => ({
      id: e.id,
      label: e.label,
      learnerLabel: e.learner_label,
      levelThreeCriterion: e.criteria['3'],
    })),
    provenance: 'fixed',
  };
}

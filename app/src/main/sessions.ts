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
import { REFERENCE_DISPLAY_NAME } from '../room/reference.js';
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
    // No literal module code. `MA3236` used to be the fallback in two places, so every session
    // started without one was stamped with a real module the learner had never taken, and the
    // nav rail then listed it as a course (ui-review-ux.md M2). Empty is legal: `module_code`
    // is `TEXT NOT NULL` with no CHECK on its contents (001_init.sql:29, :66).
    module_code: input.moduleCode?.trim() ?? '',
    title: input.title || pack.title,
    source_kind: input.sourceKind ?? 'pasted_text',
    file_path: input.fileName ?? null,
    file_id: input.fileId ?? null,
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
    /**
     * The REFERENCE voice, created with the room (pivot-spec.md §B1). It is a **scope, not an
     * agent**: `agent_key` is null and no row is written to `agents`, so `rosterFor()` does not
     * return it, `agentByRole` cannot find it and the orchestrator can never select it. See the
     * argument at the top of `src/room/reference.ts`.
     */
    deps.store.participants.insert({
      id: newId('p'),
      room_id: roomId,
      kind: 'agent',
      user_id: null,
      agent_key: null,
      display_name: REFERENCE_DISPLAY_NAME,
      joined_at: now(),
      left_at: null,
    });
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

/**
 * The ledger rail is 260 px wide and is meant to be *scanned in the half-second a learner can
 * spare mid-sentence* (§D1). A `learner_label` is the phrase that goes in it — "what PSD means",
 * not the whole claim. The ingest model was given no constraint at all, so it returned the claim
 * again, and the rail became a wall of prose 1362 px tall in a 792 px column; the recap then
 * rendered `What about <60-word paragraph>.?` five times (ui-review-ux.md B5).
 *
 * Eight words and sixty characters, enforced here rather than trusted to the prompt.
 */
export const LEARNER_LABEL_MAX_WORDS = 8;
export const LEARNER_LABEL_MAX_CHARS = 60;

export function isShortLabel(label: string): boolean {
  const trimmed = label.trim();
  if (trimmed.length === 0) return false;
  return trimmed.length <= LEARNER_LABEL_MAX_CHARS && trimmed.split(/\s+/).length <= LEARNER_LABEL_MAX_WORDS;
}

/**
 * The truncating fallback. Cut on a word boundary, never mid-word, and drop the trailing comma
 * or conjunction the cut leaves behind so the rail reads as a phrase and not as a severed
 * sentence. An ellipsis says plainly that there is more, which the expanded row still shows.
 */
export function shortLabel(label: string): string {
  const trimmed = label.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) return '';
  if (isShortLabel(trimmed)) return trimmed.replace(/[.,;:]+$/, '');
  const words = trimmed.split(' ').slice(0, LEARNER_LABEL_MAX_WORDS);
  let out = words.join(' ');
  while (out.length > LEARNER_LABEL_MAX_CHARS - 1 && words.length > 1) {
    words.pop();
    out = words.join(' ');
  }
  out = out.replace(/[.,;:]+$/, '').replace(/\s+(and|or|the|a|an|of|to|for|in|on|that|which|by|is|are)$/i, '');
  return `${out}…`;
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
      // The short, learner-facing label the rail shows. Order of preference: what the learner
      // typed into the short field, then what ingest proposed, then the template's — and
      // whichever it is, it is shortened here, because the rail cannot show a paragraph and the
      // recap's "what stayed open" is built out of it.
      const edited = claim.label.trim() !== template.label.trim();
      const proposed = claim.learnerLabel?.trim() || (edited ? claim.label : template.learner_label);
      return {
        ...template,
        id: claim.id,
        label: claim.label,
        learner_label: shortLabel(proposed) || template.learner_label,
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
          learner_label: {
            type: 'string',
            maxLength: LEARNER_LABEL_MAX_CHARS,
            description:
              'At most eight words and sixty characters. The phrase shown in the learner\'s ' +
              'progress rail, e.g. "what PSD means" — not the claim restated.',
          },
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
interface RawDraft {
  title: string;
  claims: { id: string; label: string; learner_label: string; level_three_criterion: string }[];
}

const INGEST_SYSTEM =
  'You extract the 3\u20135 separable claims a student would have to defend to have explained ' +
  'the attached lecture material. Show what "applied" looks like for each claim. Never ' +
  'invent content that is not in the material. `learner_label` is a short handle for the claim, ' +
  'at most eight words \u2014 it is shown in a narrow progress rail beside the chat and has to be ' +
  'scannable at a glance. It is never the claim restated.';

export async function draftConcept(
  llm: LLMClient | null,
  input: { moduleCode: string; title: string; text: string },
  models: ModelPlan = API_PLAN,
): Promise<ConceptDraft> {
  if (!llm || llm.kind === 'scripted') return fixedDraft();
  const ask = async (correction?: string): Promise<RawDraft> => {
    // No module line when there is no module. The old code always emitted `MODULE ` followed by
    // whatever the hard-coded default happened to be.
    const material = input.moduleCode.trim()
      ? `MODULE ${input.moduleCode.trim()}\n\nMATERIAL\n${input.text}`
      : `MATERIAL\n${input.text}`;
    const result = await llm.complete({
      model: models.orchestrator,
      max_tokens: 1500,
      system: [{ type: 'text', text: INGEST_SYSTEM }],
      messages: [{ role: 'user', content: correction ? `${material}\n\n${correction}` : material }],
      jsonSchema: DRAFT_SCHEMA,
      meta: { scope: 'ingest' },
    });
    return JSON.parse(result.text) as RawDraft;
  };

  try {
    let parsed = await ask();
    // One re-prompt when the model restates the claim instead of naming it. `maxLength` in the
    // schema is not enforced on every path \u2014 the local CLI backend is a prompt, not the
    // structured-output API \u2014 so the constraint is checked here and asked for once more
    // before the truncating fallback has to step in.
    if (!parsed.claims.every((c) => isShortLabel(c.learner_label ?? ''))) {
      try {
        parsed = await ask(
          'Every `learner_label` must be at most eight words and sixty characters: a handle for ' +
            'the claim, not the claim. Return the whole object again with shorter labels.',
        );
      } catch {
        /* keep the first answer; shortLabel() below still guarantees the length. */
      }
    }
    return {
      conceptId: `elicited-${createHash('sha1').update(input.text).digest('hex').slice(0, 8)}`,
      title: parsed.title || input.title,
      claims: parsed.claims.map((c, i) => ({
        id: c.id || `R${i + 1}`,
        label: c.label,
        // Whatever came back, the rail gets something it can actually show.
        learnerLabel: shortLabel(c.learner_label ?? '') || shortLabel(c.label),
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

/**
 * The orchestrator: who speaks next, with what move, aimed at which ledger element.
 *
 * Deterministic rules run FIRST and can decide on their own; the model is consulted only when
 * the rules have not already settled it (architecture-options.md §C.3). The rules that matter:
 *
 *  - **Anti-dog-pile** (MASG §5.4.4): at most two consecutive agent turns, ever.
 *  - **Only the Peer fills a silence** (design-brief.md §D3): "Max never fires the timer."
 *  - **The S2 disagreement quota**: after five agent turns with no visible disagreement, the
 *    next turn must differ with the other agent — a safeguard against the chorus effect.
 *  - **The learner has the last word** (turn rule 5): a `wrap_up` trigger never schedules a turn.
 *
 * The model call is Sonnet 5 with a strict JSON schema, and it runs *inside* the latency hold
 * along with the ledger call, which is what makes the delay the assessment window rather than
 * dead time (progress-tracking.md §4.1).
 */
import type { AgentRole } from '../shared/types.js';
import type { LLMClient, LlmRequest } from './llm/types.js';
import { SONNET } from './agents.js';

export const MAX_CONSECUTIVE_AGENT_TURNS = 2;
export const DISAGREEMENT_QUOTA = 5;

export type TurnTrigger = 'open' | 'student_message' | 'silence' | 'promote' | 'wrap_up';

export interface DecisionInput {
  trigger: TurnTrigger;
  consecutiveAgentTurns: number;
  agreementRun: number;
  /** Stage 1 is content-free by construction; stage 2 offers an incomplete scaffold. */
  silenceStage?: 1 | 2;
  suggestedTargetElement?: string | null;
  suggestedProbeType?: string | null;
  lastProbeType?: string | null;
}

export interface TurnDecision {
  speak: boolean;
  role: AgentRole | null;
  moveType: string;
  probeType: string | null;
  targetElementId: string | null;
  /** Elements this probe puts under test — the gate on the ledger's `defended` state. */
  challenges: string[];
  rationale: string;
  decidedBy: string;
  disagreement: { marker: 'pushes back on' | "isn't sure about" | 'sides with you against'; targetRole: AgentRole } | null;
  mustDisagree: boolean;
}

const SILENT: Omit<TurnDecision, 'rationale' | 'decidedBy'> = {
  speak: false,
  role: null,
  moveType: 'yield',
  probeType: null,
  targetElementId: null,
  challenges: [],
  disagreement: null,
  mustDisagree: false,
};

export const DECISION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['speak', 'role', 'move_type', 'rationale'],
  properties: {
    speak: { type: 'boolean' },
    role: { type: ['string', 'null'], enum: ['peer', 'challenger', null] },
    move_type: { type: 'string' },
    probe_type: {
      type: ['string', 'null'],
      enum: ['clarification', 'assumptions', 'reasons_evidence', 'implications', 'alternatives', null],
    },
    target_element_id: { type: ['string', 'null'] },
    challenges: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
  },
};

/** The deterministic half. Returns null when the model should decide. */
export function ruleDecision(input: DecisionInput): TurnDecision | null {
  if (input.trigger === 'wrap_up') {
    return { ...SILENT, rationale: 'The learner closes the round; no agent may summarise it.', decidedBy: 'rule:last_word' };
  }
  if (input.trigger === 'open') {
    return {
      speak: true,
      role: 'peer',
      moveType: 'opener',
      probeType: null,
      targetElementId: null,
      challenges: [],
      rationale: 'The Peer opens so the learner is asked, not lectured.',
      decidedBy: 'rule:opener',
      disagreement: null,
      mustDisagree: false,
    };
  }
  if (input.consecutiveAgentTurns >= MAX_CONSECUTIVE_AGENT_TURNS) {
    return {
      ...SILENT,
      rationale: `Two agent turns have already run without the learner; anything more is a dog-pile.`,
      decidedBy: 'rule:no_dogpile',
    };
  }
  if (input.trigger === 'silence') {
    const stage = input.silenceStage ?? 1;
    return {
      speak: true,
      role: 'peer',
      moveType: stage === 1 ? 'content_free_nudge' : 'incomplete_scaffold',
      probeType: null,
      targetElementId: stage === 2 ? (input.suggestedTargetElement ?? null) : null,
      challenges: [],
      rationale:
        stage === 1
          ? 'Stage 1: the Peer notices the quiet and adds no subject matter.'
          : 'Stage 2: a hedged, incomplete starting point aimed at the current target element.',
      decidedBy: 'rule:silence_peer',
      disagreement: null,
      mustDisagree: false,
    };
  }
  return null;
}

export interface DecideOptions {
  client: LLMClient;
  request: LlmRequest;
  input: DecisionInput;
}

export async function decideTurn(opts: DecideOptions): Promise<TurnDecision> {
  const ruled = ruleDecision(opts.input);
  const mustDisagree = opts.input.agreementRun >= DISAGREEMENT_QUOTA;
  if (ruled) return { ...ruled, mustDisagree: ruled.speak ? mustDisagree : false };

  try {
    const result = await opts.client.complete({ ...opts.request, model: SONNET, jsonSchema: DECISION_SCHEMA });
    const parsed = JSON.parse(extractJson(result.text)) as Record<string, unknown>;
    const role = parsed.role === 'challenger' || parsed.role === 'peer' ? (parsed.role as AgentRole) : null;
    const speak = parsed.speak === true && role !== null;
    let probeType = typeof parsed.probe_type === 'string' ? parsed.probe_type : null;
    // Never repeat the previous Socratic type (design-brief.md §G turn 8 note).
    if (role === 'challenger' && probeType !== null && probeType === opts.input.lastProbeType) {
      probeType = nextProbeType(probeType);
    }
    return {
      speak,
      role,
      moveType: typeof parsed.move_type === 'string' ? parsed.move_type : 'respond',
      probeType,
      targetElementId: typeof parsed.target_element_id === 'string' ? parsed.target_element_id : null,
      challenges: Array.isArray(parsed.challenges) ? (parsed.challenges as string[]) : [],
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
      decidedBy: `model:${SONNET}`,
      disagreement:
        parsed.disagreement && typeof parsed.disagreement === 'object'
          ? (parsed.disagreement as TurnDecision['disagreement'])
          : null,
      mustDisagree: speak && mustDisagree,
    };
  } catch (err) {
    // A decision the app cannot parse must not stall the room: stay quiet and let the timer work.
    return {
      ...SILENT,
      rationale: `Orchestrator call failed (${(err as Error).message}); staying quiet rather than guessing.`,
      decidedBy: 'rule:orchestrator_error',
    };
  }
}

const PROBE_ORDER = ['clarification', 'assumptions', 'reasons_evidence', 'implications', 'alternatives'];

export function nextProbeType(current: string): string {
  const i = PROBE_ORDER.indexOf(current);
  return PROBE_ORDER[(i + 1) % PROBE_ORDER.length]!;
}

/** Models occasionally wrap JSON in prose even under a schema; take the first object. */
function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error('no JSON object in orchestrator response');
}

/**
 * The orchestrator: who speaks next, with what move, aimed at which ledger element.
 *
 * Deterministic rules run FIRST and can decide on their own; the model is consulted only when
 * the rules have not already settled it (architecture-options.md §C.3). The rules that matter:
 *
 *  - **Anti-dog-pile** (MASG §5.4.4): at most two consecutive agent turns, ever.
 *  - **Only the Teacher fills a silence** (design-brief.md §D3): "Max never fires the timer."
 *  - **The hand-off** (#33, flow-session.md §8.2): the Tester is eligible *only* when
 *    `handOffDue()` says the flow session is ready, and the Teacher's hand-off line is written
 *    here rather than generated — see `TurnDecision.handOffLine`.
 *  - **Feedback after every quiz answer is mandatory** (flow-session.md §3, §8.3 — Rowland 2014,
 *    g = 0.73 with feedback against 0.39 without). When the Tester owes feedback the model is
 *    not consulted at all.
 *  - **The learner has the last word** (turn rule 5): a `wrap_up` trigger never schedules a turn.
 *
 * **Deleted with the social-group framing** (#32, masg-drop-assessment.md §D2 Option 2): the S2
 * disagreement quota and every trace of `mustDisagree`. There are no longer two standing peers
 * to disagree — there is a Teacher and a Tester — and MASG is now cited once, as the reason the
 * count stops at two.
 *
 * The model call is Sonnet 5 with a strict JSON schema, and it runs *inside* the latency hold
 * along with the ledger call, which is what makes the delay the assessment window rather than
 * dead time (progress-tracking.md §4.1).
 */
import type { AgentRole } from '../shared/types.js';
import { feedbackDue, type HandOffVerdict, type PendingQuiz } from './flow.js';
import type { LLMClient, LlmRequest } from './llm/types.js';

export const MAX_CONSECUTIVE_AGENT_TURNS = 2;

export type TurnTrigger = 'open' | 'student_message' | 'silence' | 'promote' | 'wrap_up';

export interface DecisionInput {
  trigger: TurnTrigger;
  consecutiveAgentTurns: number;
  /** Stage 1 is content-free by construction; stage 2 offers an incomplete scaffold. */
  silenceStage?: 1 | 2;
  suggestedTargetElement?: string | null;
  suggestedProbeType?: string | null;
  lastProbeType?: string | null;
  /**
   * The flow verdict, computed by `flow.ts` and handed in. **The Tester is eligible only when
   * this says so** — there is no other path to a `challenger` turn, which is what makes the
   * hand-off "a rule I can see and turn down, not a model's whim" (video beat 10).
   */
  handOff?: HandOffVerdict | null;
  /** The Teacher's hand-off line, written by `flow.handOffLine()`. Never generated. */
  handOffLine?: string | null;
  /** The Tester's outstanding question, if any. Gates the mandatory feedback rule. */
  pendingQuiz?: PendingQuiz | null;
  /**
   * True while a REFERENCE answer on this thread is waiting for "Explain it back". Neither
   * agent may post there at all until the learner presses it (pivot-spec.md §B1, enforced in
   * code and not in a prompt).
   */
  referenceLocked?: boolean;
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
  /**
   * Set only on a hand-off. The actor posts it as the Teacher's own message, verbatim, before
   * the Tester's turn — it is deterministic text like the stage-1 nudge pool, not a generation.
   */
  handOffLine: string | null;
}

const SILENT: Omit<TurnDecision, 'rationale' | 'decidedBy'> = {
  speak: false,
  role: null,
  moveType: 'yield',
  probeType: null,
  targetElementId: null,
  challenges: [],
  handOffLine: null,
};

export const DECISION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['speak', 'role', 'move_type', 'rationale'],
  properties: {
    speak: { type: 'boolean' },
    // The stored strings, not the display names: 'peer' is the Teacher and 'challenger' is the
    // Tester (agents.ts). Renaming them would move every historical room's frozen prefix hash.
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
    return { ...SILENT, rationale: 'The learner closes the thread; no agent may summarise it.', decidedBy: 'rule:last_word' };
  }
  /**
   * The REFERENCE gate (pivot-spec.md §B1, flow-build-plan.md §4.3 property 4): while an
   * `answer` is waiting for "Explain it back", **neither** Ellie nor Max may post into that
   * thread. This is the line that turns "the AI gave me the answer" from the disease into the
   * hook, so it is checked before anything else can schedule a turn.
   */
  if (input.referenceLocked === true) {
    return {
      ...SILENT,
      rationale: 'A REFERENCE answer is waiting for "Explain it back"; the thread is the learner\'s alone until then.',
      decidedBy: 'rule:reference_locked',
    };
  }
  if (input.trigger === 'open') {
    return {
      speak: true,
      role: 'peer',
      moveType: 'opener',
      probeType: null,
      targetElementId: null,
      challenges: [],
      rationale: 'The Teacher opens so the learner is asked, not lectured.',
      decidedBy: 'rule:opener',
      handOffLine: null,
    };
  }
  /**
   * **Feedback after a quiz answer is mandatory** (flow-session.md §3, §8.3). Rowland 2014's
   * meta-analysis: g = 0.73 for retrieval practice *with* feedback against 0.39 without — the
   * best-evidenced number in the brief. A Tester that asks, hears an answer and moves on
   * discards roughly half the effect it exists for, so this is not a decision the model gets to
   * make and it outranks the dog-pile cap: the learner has just spoken, so nothing is piling on.
   */
  if (feedbackDue(input.pendingQuiz ?? null)) {
    return {
      speak: true,
      role: 'challenger',
      moveType: 'quiz_feedback',
      probeType: null,
      targetElementId: input.pendingQuiz!.elementId,
      challenges: [input.pendingQuiz!.elementId],
      rationale:
        'The Tester asked and the learner answered: feedback is required before anything else ' +
        '(Rowland 2014, g = 0.73 with feedback vs 0.39 without).',
      decidedBy: 'rule:quiz_feedback',
      handOffLine: null,
    };
  }
  if (input.consecutiveAgentTurns >= MAX_CONSECUTIVE_AGENT_TURNS) {
    return {
      ...SILENT,
      rationale: `Two agent turns have already run without the learner; anything more is a dog-pile.`,
      decidedBy: 'rule:no_dogpile',
    };
  }
  /**
   * **The hand-off.** The Tester is eligible here and nowhere else: `handOffDue()` has already
   * checked the four conditions of flow-session.md §8.2 on a clock, and the model is never asked
   * whether Max should speak. It fires on a learner turn only — never into a silence window
   * (R4 covers it, and the silence rule below is the Teacher's), never on a REFERENCE answer
   * (that is not an agent turn at all and never reaches this function), and never on a whisper
   * (whispers do not run the orchestrator).
   */
  const handOff = input.handOff ?? null;
  if (
    handOff?.due === true &&
    handOff.target !== null &&
    (input.trigger === 'student_message' || input.trigger === 'promote')
  ) {
    return {
      speak: true,
      role: 'challenger',
      moveType: 'quiz',
      probeType: input.suggestedProbeType ?? null,
      targetElementId: handOff.target.elementId,
      challenges: [handOff.target.elementId],
      rationale:
        `The flow rule is satisfied (${handOff.learnerTurnsInWindow} learner turns in the window, ` +
        `${handOff.candidates.length} concepts quizzable); the Teacher hands off.`,
      decidedBy: 'rule:handoff',
      handOffLine: input.handOffLine ?? null,
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
          ? 'Stage 1: the Teacher notices the quiet and adds no subject matter.'
          : 'Stage 2: a hedged, incomplete starting point aimed at the current target element.',
      decidedBy: 'rule:silence_peer',
      handOffLine: null,
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
  if (ruled) return ruled;

  try {
    // The model id comes in on the request: the caller resolved it from the backend's plan
    // (issue #19), so this works identically over the API key and over the local CLI.
    const result = await opts.client.complete({ ...opts.request, jsonSchema: DECISION_SCHEMA });
    const parsed = JSON.parse(extractJson(result.text)) as Record<string, unknown>;
    let role = parsed.role === 'challenger' || parsed.role === 'peer' ? (parsed.role as AgentRole) : null;
    // **The model may never put the Tester on the floor.** Eligibility is `handOffDue()`'s call
    // and the rule above is the only path to it; a model that asks for `challenger` here is
    // silently demoted to the Teacher rather than being allowed around the flow rule (#33).
    if (role === 'challenger' && opts.input.handOff?.due !== true) role = 'peer';
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
      decidedBy: `model:${opts.request.model}`,
      handOffLine: null,
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

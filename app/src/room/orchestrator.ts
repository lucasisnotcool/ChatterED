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
 *  - **The Teacher answers a segment thread** (`rule:teacher_answers`, added 2026-09-16): once
 *    the rules above have declined, a learner turn under a segment has exactly one legal
 *    answerer, so it is decided here and the model is not called at all.
 *
 * **Deleted with the social-group framing** (#32, masg-drop-assessment.md §D2 Option 2): the S2
 * disagreement quota and every trace of `mustDisagree`. There are no longer two standing peers
 * to disagree — there is a Teacher and a Tester — and MASG is now cited once, as the reason the
 * count stops at two.
 *
 * The model call is Sonnet 5 with a strict JSON schema, and it runs *inside* the latency hold
 * along with the ledger call, which is what makes the delay the assessment window rather than
 * dead time (progress-tracking.md §4.1).
 *
 * **What that call costs, measured.** On the local-CLI backend, at the prompt size a real
 * 58-page deck produces (7.9 kB of system text, 0.7 kB of transcript), one `claude -p
 * --json-schema` decision took 17.1 s and 20.0 s on `sonnet` and 12.6 s and 39.6 s on `haiku`
 * over four runs on 2026-09-16 — the model spends 0.9k–3.8k output tokens *reasoning* before it
 * emits the object, and that, not the prompt and not process start-up, is the whole cost.
 * Haiku is therefore not the fix: it is not reliably faster and it chose worse. Deleting the
 * call is the fix, which is what `rule:teacher_answers` does.
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
  /**
   * True when this turn belongs to one segment's thread in the flow (`anchorId !== null`), as
   * opposed to the room-level stream the pre-pivot chat used. It is what makes
   * `rule:teacher_answers` safe: in the flow the Q&A thread under a segment **is the Teacher's**
   * (`pivot-spec.md` §B1, #32), so a learner turn there has exactly one correct answerer and the
   * model has nothing left to decide.
   */
  anchoredThread?: boolean;
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
  /**
   * Set when the decision is the product of a *failure* rather than a judgement — the model call
   * threw, the CLI exited non-zero, or its answer would not parse. The actor must surface it
   * (`#turnFailed`): the bug this field exists for is a turn that failed at 02:30:38 on
   * 2026-09-16 and was indistinguishable, everywhere downstream, from deliberate silence.
   */
  failure: TurnFailure | null;
}

export interface TurnFailure {
  /** One short sentence the learner can read, e.g. "the Claude CLI exited 1". */
  reason: string;
  /** For the log, never for the card. */
  detail?: string;
}

const SILENT: Omit<TurnDecision, 'rationale' | 'decidedBy'> = {
  speak: false,
  role: null,
  moveType: 'yield',
  probeType: null,
  targetElementId: null,
  challenges: [],
  handOffLine: null,
  failure: null,
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
      failure: null,
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
      failure: null,
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
      failure: null,
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
      failure: null,
    };
  }
  /**
   * **A learner turn in a segment thread is the Teacher's to answer, and no model decides it.**
   *
   * This rule is the fix for the 2026-09-16 silence (room_6a9609d5c6fb): the learner asked "so
   * Manhattan distance is not admissible…?", the orchestrator spent 20 s on a Sonnet call over
   * the local CLI, came back with a move (`correct_misconception`) but a role the code could not
   * map, and the turn evaporated. Every one of those 20 seconds bought nothing, because by the
   * time control reaches here the answer is already forced:
   *
   *  - the Tester is unreachable — `rule:handoff` and `rule:quiz_feedback` above are its only
   *    two doors, and `decideTurn` demotes a model that asks for it anyway (#33);
   *  - silence is wrong — the learner has just asked a question into a thread they opened;
   *  - so the only legal outcome is *the Teacher answers*, which is `pivot-spec.md` §B1's
   *    "the Q&A thread is the Teacher's" restated as code.
   *
   * The model keeps the room-level stream (`anchoredThread` false), which is the pre-flow chat
   * and the only place a second standing agent could still be in play.
   */
  if ((input.trigger === 'student_message' || input.trigger === 'promote') && input.anchoredThread === true) {
    return {
      speak: true,
      role: 'peer',
      moveType: 'respond',
      probeType: null,
      targetElementId: input.suggestedTargetElement ?? null,
      challenges: [],
      rationale: 'The learner asked in a segment thread; the thread is the Teacher\'s and she answers it.',
      decidedBy: 'rule:teacher_answers',
      handOffLine: null,
      failure: null,
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

  const learnerTurn = opts.input.trigger === 'student_message' || opts.input.trigger === 'promote';
  try {
    // The model id comes in on the request: the caller resolved it from the backend's plan
    // (issue #19), so this works identically over the API key and over the local CLI.
    const result = await opts.client.complete({ ...opts.request, jsonSchema: DECISION_SCHEMA });
    const parsed = JSON.parse(extractJson(result.text)) as Record<string, unknown>;
    const moveType = typeof parsed.move_type === 'string' && parsed.move_type.trim().length > 0 ? parsed.move_type : 'respond';

    /**
     * **A role the code cannot map is a bug in the mapping, never a reason to say nothing.**
     *
     * On 2026-09-16 the live model answered with a move (`correct_misconception`), a target and
     * a rationale, and a `role` this function turned into `null`; `speak` then collapsed to
     * false and a turn that had *already decided what to say* was written to `turn_decisions`
     * with a null participant and dispatched nowhere. Three layers now stand between that
     * answer and silence: the names the model actually uses are accepted (`teacher`, `ellie`,
     * `tester`, `max`), the **move** names the role when the role field does not, and the
     * Teacher is the floor.
     */
    let role = roleFromName(parsed.role) ?? roleFromMove(moveType);
    // **The model may never put the Tester on the floor.** Eligibility is `handOffDue()`'s call
    // and the rule above is the only path to it; a model that asks for `challenger` here is
    // silently demoted to the Teacher rather than being allowed around the flow rule (#33).
    if (role === 'challenger' && opts.input.handOff?.due !== true) role = 'peer';

    /**
     * `speak: false` is a real answer — but not to a learner who has just typed a question.
     * Every legitimate reason for an agent to stay quiet after a learner turn (the last word,
     * the dog-pile cap, the REFERENCE lock) is a **rule**, and every one of them has already run
     * above. So a model saying nothing here is a model declining to answer a question it was
     * asked, and the Teacher takes the turn instead.
     */
    const declined = parsed.speak !== true;
    const speak = !declined || learnerTurn;
    let probeType = typeof parsed.probe_type === 'string' ? parsed.probe_type : null;
    // Never repeat the previous Socratic type (design-brief.md §G turn 8 note).
    if (role === 'challenger' && probeType !== null && probeType === opts.input.lastProbeType) {
      probeType = nextProbeType(probeType);
    }
    return {
      speak,
      role: speak ? role : null,
      moveType,
      probeType,
      targetElementId: typeof parsed.target_element_id === 'string' ? parsed.target_element_id : null,
      challenges: Array.isArray(parsed.challenges) ? (parsed.challenges as string[]) : [],
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
      decidedBy: declined && speak ? `model:${opts.request.model}:declined_overridden` : `model:${opts.request.model}`,
      handOffLine: null,
      failure: null,
    };
  } catch (err) {
    /**
     * The old comment here read "a decision the app cannot parse must not stall the room: stay
     * quiet and let the timer work". That is exactly what produced the bug: the room *did* stall,
     * the learner saw nothing at all, and 45 s later the timer nudged them for being quiet. A
     * failure is now (a) never silence on a learner turn — the Teacher answers anyway — and
     * (b) always reported, so the actor can put a card on screen instead of nothing.
     */
    const failure: TurnFailure = { reason: 'the orchestrator call failed', detail: (err as Error).message };
    if (learnerTurn) {
      return {
        speak: true,
        role: 'peer',
        moveType: 'respond',
        probeType: null,
        targetElementId: null,
        challenges: [],
        rationale: `Orchestrator call failed (${(err as Error).message}); the Teacher answers anyway.`,
        decidedBy: 'rule:orchestrator_error',
        handOffLine: null,
        failure,
      };
    }
    return {
      ...SILENT,
      rationale: `Orchestrator call failed (${(err as Error).message}); nothing was scheduled.`,
      decidedBy: 'rule:orchestrator_error',
      failure,
    };
  }
}

/**
 * The stored role strings are `peer` and `challenger`; every word the model ever reads says
 * Teacher and Tester (`prompts.roleBlock`, `agents.ROLE_LABEL`). So the model answers in the
 * vocabulary it was given, and this is the translation the code was missing.
 */
export function roleFromName(value: unknown): AgentRole | null {
  if (typeof value !== 'string') return null;
  switch (value.trim().toLowerCase()) {
    case 'peer':
    case 'teacher':
    case 'ellie':
      return 'peer';
    case 'challenger':
    case 'tester':
    case 'max':
      return 'challenger';
    default:
      return null;
  }
}

/**
 * The move names the speaker when the role field does not. Only the Tester's two moves point at
 * the Tester — and `decideTurn` then demotes that unless `handOffDue()` agreed — so **the
 * Teacher is the default and `correct_misconception` is hers**, which is the specific mapping
 * the 2026-09-16 decision needed and did not have.
 */
export function roleFromMove(moveType: string): AgentRole {
  return /^(quiz|probe)/.test(moveType.trim().toLowerCase()) ? 'challenger' : 'peer';
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

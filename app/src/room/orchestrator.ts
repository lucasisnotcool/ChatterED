/**
 * The orchestrator: who speaks next, with what move, aimed at which ledger element.
 *
 * Deterministic rules run FIRST and can decide on their own; the model is consulted only when
 * the rules have not already settled it (architecture-options.md §C.3). The rules that matter:
 *
 *  - **Anti-dog-pile** (MASG §5.4.4): at most two consecutive agent turns, ever.
 *  - **The app fills only the silence where an answer is owed** (#47, `attempt-first.md` §5,
 *    `silenceDecision`): after a Teacher explanation, nothing at any stage — the quiet is reading;
 *    after a Tester question, stage 1 stays content-free (`product-design.md` §C5) and stage 2 is
 *    the Tester's own hint. This narrows design-brief.md §D3's "Max never fires the timer", which
 *    was written when every silence was the learner not starting to explain, and it retires #37's
 *    re-explanation, which the transcripts say was answering a silence that meant reading.
 *  - **The answer is withheld until one attempt** (#47, `attempt-first.md` §2.3): while a Tester
 *    question is open, what the learner's turn *is* decides who speaks and with what move, and the
 *    model is never asked whether it should answer its own question. That is the A1 prototype's one
 *    important design decision, and it is here rather than in a prompt on purpose.
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
import type { LearnerTurnKind } from './attempt.js';
import { attemptsOf, feedbackDue, quizOpen, type HandOffVerdict, type PendingQuiz } from './flow.js';
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
   * **What the learner's turn was** (`room/attempt.ts`, `attempt-first.md` §2.2), computed by the
   * actor before anything is decided. It is what the answer lock reads, and the reason the lock is
   * a rule: the model is never asked whether it should answer its own question (§2.3).
   */
  learnerTurn?: LearnerTurnKind | null;
  /**
   * The learner pressed **Show the answer** (§2.4). Distinct from an `answer_request` in the
   * composer only in where it came from; both reach `rule:answer_shown`, and both require one
   * attempt, which the actor has already checked before it gets here.
   */
  showAnswer?: boolean;
  /**
   * **This turn came through "+ Ask here"** (issue #47, and `flow-build-plan.md` §2 beat 11).
   *
   * An Ask is an explicit request for the *Teacher*, and `attempt-first.md` §6 films it as the
   * explain path that runs **while** a Tester question is open: *"Ellie's '+ Ask here' appears once,
   * as the explain path, when the second question needs a prerequisite."* Without this flag §2.2
   * classifies the Ask like any other learner turn, and the Ask the video types is 39 words — long
   * enough to read as an *attempt*, which gave the turn to Max, counted as the try that unlocks the
   * answer, and scored the ledger against a question. Shortening it does not help: under 25 words it
   * is a `question` and draws `rule:quiz_clarify`, which is still Max.
   *
   * So the answer lock is skipped for an Ask, and the actor does not touch `pendingQuiz` on one.
   */
  askedHere?: boolean;
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
  /**
   * **What the last agent said in this thread**, which is what the silence *means* (#37).
   *
   * Silence after a Tester question is a learner thinking — retrieval practice, and the one
   * thing that must not be interrupted with subject matter. Silence after a Teacher explanation
   * is a learner who did not follow it, and the human response to that is to say it again more
   * simply, not to say "take your time". The old rule could not tell those apart because it was
   * written when the only thing an agent ever did was ask (`product-design.md` §C5, the
   * learner-explains era); #32 made the Teacher explain, and this is the half of §C5 that did
   * not move with it.
   */
  lastAgentTurn?: LastAgentTurn;
}

/**
 * How the thread's last agent turn is classified. Derived from the *move* that produced it, not
 * from the speaker — a Teacher content-free nudge is a Teacher message and is emphatically not
 * an explanation to try again.
 */
export type LastAgentTurn =
  /** An explanation, an answer, a correction, a worked example — anything that taught. */
  | 'teacher_explanation'
  /** A quiz or a probe: the learner owes an answer and the silence is them producing it. */
  | 'tester_question'
  /** A REFERENCE card. Not an agent turn at all; the thread is the learner's until they act. */
  | 'reference'
  /** Nothing has been said yet, or the last thing said was itself a nudge. */
  | 'none';

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
   * **The answer is withheld until the learner has tried once** (issue #47, `attempt-first.md`
   * §2.3), and it is withheld *here*, in code, rather than asked for in Max's prompt.
   *
   * That placement is the one important design decision of the A1 prototype (§6), and the evidence
   * is R6: both of the AI's hints were followed by a bare `answer?`, it answered both times, and
   * the session only produced attempts after the learner typed the rule out by hand — *"I will
   * attempt the question"*, *"do not send the answer"*. A prompt asking a model not to answer its
   * own question is a request; this is not.
   *
   * Four outcomes, all of them Max's, all checked before the mandatory-feedback rule below because
   * every one of them is about a turn that is **not** an attempt and therefore owes no feedback:
   *
   *  | learner turn | rule | move |
   *  |---|---|---|
   *  | `answer_request`, no attempt yet | `rule:answer_withheld` | `quiz_hint` |
   *  | `answer_request` after an attempt, or the button | `rule:answer_shown` | `quiz_answer` |
   *  | `question` | `rule:quiz_clarify` | `quiz_clarify` |
   *  | `other` (agreement, or nothing said) | `rule:quiz_nudge` | `quiz_hint` |
   *
   * `quizOpen` is the gate: the question survives its own feedback turn (§2.4), so all four stay
   * available until the answer is shown, a new question replaces it, or the sitting closes.
   */
  const pending = input.pendingQuiz ?? null;
  // `askedHere` is the explain path, and it is the Teacher's whether or not a question is open
  // (§6, beat 11) — see `DecisionInput.askedHere`.
  if (pending !== null && quizOpen(pending) && input.askedHere !== true) {
    const quiz = pending;
    const attempts = attemptsOf(quiz);
    const learnerTurn = input.trigger === 'student_message' || input.trigger === 'promote';
    const answer = (why: string): TurnDecision => ({
      speak: true,
      role: 'challenger',
      moveType: 'quiz_answer',
      probeType: null,
      targetElementId: quiz.elementId,
      challenges: [],
      rationale: why,
      decidedBy: 'rule:answer_shown',
      handOffLine: null,
      failure: null,
    });
    if (input.showAnswer === true && attempts >= 1) {
      return answer('The learner has attempted once and asked to see the answer; it is theirs to ask for.');
    }
    if (learnerTurn && input.learnerTurn === 'answer_request') {
      if (attempts >= 1) {
        return answer(
          'The learner asked for the answer after attempting it once: the lock is lifted, and the ' +
            'answer is given with its grounds.',
        );
      }
      return {
        speak: true,
        role: 'challenger',
        moveType: 'quiz_hint',
        probeType: null,
        targetElementId: quiz.elementId,
        // Nothing is put under test by a hint: `challenges` gates the ledger's `defended` state,
        // and a learner who has not answered has defended nothing.
        challenges: [],
        rationale:
          'The learner asked for the answer before attempting it (R6, twice). One hint, and the ' +
          'answer stays behind one try.',
        decidedBy: 'rule:answer_withheld',
        handOffLine: null,
        failure: null,
      };
    }
    if (learnerTurn && input.learnerTurn === 'question') {
      return {
        speak: true,
        role: 'challenger',
        moveType: 'quiz_clarify',
        probeType: null,
        targetElementId: quiz.elementId,
        challenges: [],
        rationale:
          'The learner asked what the question means. Max clarifies it without answering it; the ' +
          'question stays open and this is not an attempt.',
        decidedBy: 'rule:quiz_clarify',
        handOffLine: null,
        failure: null,
      };
    }
    if (learnerTurn && input.learnerTurn === 'other') {
      return {
        speak: true,
        role: 'challenger',
        moveType: 'quiz_hint',
        probeType: null,
        targetElementId: quiz.elementId,
        challenges: [],
        rationale:
          'The learner said nothing that answers the question (ledger rule 4\u2019s agreement, which ' +
          'is what R6 replied to eleven wrong verdicts). One hint, no answer.',
        decidedBy: 'rule:quiz_nudge',
        handOffLine: null,
        failure: null,
      };
    }
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
  /**
   * **A silence fill is not a dog-pile, and is checked before the cap** (#37).
   *
   * MASG §5.4.4's cap exists so agents do not talk over a learner who is trying to speak. A
   * silence fill is, by construction, 45 or 90 seconds in which the learner did not — so the cap
   * is the wrong instrument here, and it was silently eating the stage-2 fill: an explanation
   * (1 consecutive turn) plus a stage-1 fill (2) put the room at the cap, so `incomplete_scaffold`
   * and now `offer_step_back` could never be reached. The governing limit on fills is §C5's own
   * *"the timer fires at most twice per round"*, which `timer.ts` enforces on the clock and which
   * no model or rule here can exceed.
   */
  if (input.trigger === 'silence') return silenceDecision(input);
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
      // `respond` until #36. A move named "respond" is satisfied by any reply, including the six
      // that opened with a Socratic probe instead of an answer; `answer_then_teach` is the only
      // thing this rule has ever meant, and `turnDirective` now spells it out in the directive.
      moveType: 'answer_then_teach',
      role: 'peer',
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

/**
 * **What a silence means depends on what was said into it** (#37).
 *
 * `product-design.md` §C5 makes stage 1 content-free unconditionally, and gives the reason:
 * *"a nudge that supplies subject matter converts a persistence problem into a comprehension
 * shortcut."* That reason is exactly right for the room it was written for, where the learner's
 * job was to explain and the silence was them not starting. **#32 changed the room**: the
 * Teacher now explains, so the commonest silence in the flow is a learner who did not follow the
 * explanation — and to that silence a content-free line is not neutral, it is a non-answer. On
 * the CS4246 MDP slide (#37) Ellie finished an ELI5 and 45 s later said "Take your time. If it
 * helps, say the bit you're sure about first." A human teacher says it again, differently.
 *
 * §C5 is therefore **narrowed, not overruled**: content-free stage 1 is kept in full for the
 * case its argument is about — the Tester is waiting for an answer, and the silence is retrieval
 * practice, which is the one silence that must not be filled with subject matter.
 *
 * Three cases, in the order they are checked:
 *
 *  a. **After a Teacher explanation.** Stage 1 re-explains the same point one level simpler,
 *     with an everyday analogy or a concrete example, assuming less, and with **no question** —
 *     a real generated turn, not the pool, because "say it again more simply" is by definition
 *     content. Stage 2 offers to step back to the prerequisite, or asks which part lost them:
 *     one question, because by 90 s the re-explanation has also failed and the useful move is to
 *     find out where.
 *  b. **After a Tester question.** Stage 1 is §C5 unchanged. Stage 2 is a **hint from the
 *     Tester**, who owns the question — the Teacher supplying it would be answering Max's quiz,
 *     which is the one thing `ledger.ts` exists to keep out of the `defended` state. This is a
 *     deliberate narrowing of `design-brief.md` §D3's "Max never fires the timer", recorded in
 *     STATUS: that line was written when every silence was the learner not starting to explain.
 *  c. **After a REFERENCE card, or nothing yet.** Unchanged. (A REFERENCE card that is still
 *     waiting for *Explain it back* never reaches here at all — `rule:reference_locked` is
 *     checked first — so this branch is the one where the learner already pressed it.)
 */
export function silenceDecision(input: DecisionInput): TurnDecision {
  const stage = input.silenceStage ?? 1;
  const last = input.lastAgentTurn ?? 'none';

  /**
   * **After an explanation, nothing** (issue #47, `attempt-first.md` §5 — and this is
   * `product-design.md` §C5's original argument returning in full).
   *
   * #37 put a re-explanation here: the commonest silence in the flow is a learner who did not
   * follow the explanation, so say it again more simply. The transcripts say otherwise. The median
   * gap before the next learner turn in the six studied sessions is **3–6 minutes**
   * (`findings.md` RQ5), against AI turns of 246–1,190 words — the quiet after an explanation is
   * *reading*, and #46's own read of the re-explanation was that the first reply had been good
   * enough and the second added little, while "step back" was opaque.
   *
   * So the only silence the app fills is the one where the learner **owes an answer**.
   * `rule:silence_reexplain` and `offer_step_back` are retired; their move names survive in
   * `NON_TEACHING_MOVES` and in `#dividerFor` so a room recorded before this build still renders.
   */
  if (last === 'teacher_explanation') {
    return {
      ...SILENT,
      rationale:
        'The quiet followed an explanation. That is reading or leaving, and both are the learner\u2019s ' +
        '(attempt-first.md \u00a75); the app fills only the silence where an answer is owed.',
      decidedBy: 'rule:silence_after_explanation',
    };
  }

  if (last === 'tester_question' && stage === 2) {
    return {
      speak: true,
      role: 'challenger',
      moveType: 'quiz_hint',
      probeType: null,
      targetElementId: input.pendingQuiz?.elementId ?? input.suggestedTargetElement ?? null,
      challenges: [],
      rationale:
        'The learner is stuck on the Tester\'s question; the Tester hints, because the Teacher ' +
        'supplying it would be answering the quiz.',
      decidedBy: 'rule:silence_hint',
      handOffLine: null,
      failure: null,
    };
  }

  // §C5 as written: the Tester is waiting (stage 1), or nobody has taught anything yet.
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
 * Moves that say nothing about what the thread is *about*, and so leave the classification where
 * it was.
 *
 * The five fills are here because a fill is a response to a silence, not new material: if the
 * learner went quiet after an explanation and Ellie re-explained, the thread is still about that
 * explanation; if she posted a content-free line because Max was waiting, Max is still waiting.
 * Without this a second silence would re-explain the nudge.
 *
 * **`yield` is here because it is not a turn at all**, and this is not theoretical: the scripted
 * PSD/Hessian room yields after the learner's second message, and `decideTurn` forces `speak` on
 * a learner turn even when the model declined (so that a declining model cannot produce silence
 * after a question). That arrives here as a `peer`/`yield` decision which, counted as teaching,
 * overwrote Max's outstanding probe and turned the video's content-free beat into a
 * re-explanation of nothing.
 */
const NON_TEACHING_MOVES = new Set([
  'yield',
  'content_free_nudge',
  'incomplete_scaffold',
  // Retired by #47 §5 — nothing produces these any more, and they stay here so that a room
  // recorded before this build classifies its own history the way it was played.
  'reexplain_simpler',
  'offer_step_back',
  'quiz_hint',
]);

/**
 * Classify a dispatched turn for the next silence (#37).
 *
 * `previous` is returned rather than defaulted, so that a fill leaves the thread's meaning where
 * it was, and so the opener — which asks rather than teaches — does not make the first 45 s of a
 * room look like a failed explanation.
 */
export function classifyAgentTurn(decision: TurnDecision, previous: LastAgentTurn): LastAgentTurn {
  if (!decision.speak || decision.role === null) return previous;
  if (NON_TEACHING_MOVES.has(decision.moveType.trim().toLowerCase())) return previous;
  const move = decision.moveType.trim().toLowerCase();
  // The opener asks rather than teaches, so the first 45 s of a room is not a failed explanation.
  if (move === 'opener') return 'none';
  /**
   * **Keyed on the move, not on `decision.role`.** The role a decision carries is not reliable
   * for this: `decideTurn` silently demotes `challenger` to `peer` whenever `handOffDue()` has
   * not agreed (#33), so a probe that Ellie ends up delivering still arrives here as `'peer'`.
   * What matters is whether the learner was left owing an answer, and the move is what says so.
   */
  /**
   * **The shown answer closes the question** (issue #47). Every other `quiz*` move leaves the
   * learner owing one — including `quiz_clarify`, which answers a question *about* the question —
   * but once Max has given the model answer there is nothing outstanding, so a silence after it is
   * the silence after teaching, which §5 leaves alone.
   */
  if (move === 'quiz_answer') return 'teacher_explanation';
  if (/^(quiz|prob)/.test(move) && move !== 'quiz_feedback') return 'tester_question';
  // Feedback is the Tester explaining what the answer should have been, and a learner who goes
  // quiet on it has the same problem as one who goes quiet on Ellie: they did not follow it.
  return 'teacher_explanation';
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
        moveType: 'answer_then_teach',
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
export function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error('no JSON object in orchestrator response');
}

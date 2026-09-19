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
import type { AgentAuthor, ThreadKind } from '../shared/doc/types.js';
import type { LearnerTurnKind } from './attempt.js';
import {
  attemptsOf,
  cueGiven,
  feedbackDue,
  quizOpen,
  type HandOffVerdict,
  type PendingQuiz,
} from './flow.js';
import type { LLMClient, LlmRequest } from './llm/types.js';

/**
 * **Two consecutive agent turns, ever** (MASG §5.4.4), and #48 spends both of them on purpose:
 * `rule:ellie_answers` is the first and `rule:max_followup` is the second (`collab-doc.md` §4.2).
 *
 * That is right at the cap, which is why `silenceDecision` is still reached **before** the cap is
 * checked (see the comment above the check): a cue that could not fire after an answer and its
 * follow-up would make §4.3 unreachable in exactly the case it is written for. There is an
 * orchestrator test on that, because it is a one-line regression waiting to happen.
 */
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
   * **Pass** on the open question (#48, brief §4.4's *"There is also a **Pass** control"*).
   *
   * Distinct from a `give_up` phrase in the composer only in where it came from: both reach
   * `rule:answer_released`, and since #48 **neither requires an attempt**. The field keeps its old
   * name because `IPC.flowShowAnswer` and `actor.showAnswer()` are the door it arrives through and
   * both are frozen for this build; `actor.pass()` is the collab-doc name for the same call.
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
   * **Retired** (#48). It was true while a REFERENCE answer waited for "Explain it back", and
   * nothing has pushed a REFERENCE card since #41 — `actor.#answers` is always empty, so the rule
   * it fed could never fire. The field stays so a caller that still passes it compiles; no rule
   * reads it.
   */
  referenceLocked?: boolean;
  /**
   * True when this turn belongs to one segment's thread in the flow (`anchorId !== null`), as
   * opposed to the room-level stream the pre-pivot chat used. It is what made `rule:ellie_answers`
   * (né `rule:teacher_answers`) safe in the flow: a learner turn under a segment has exactly one
   * correct answerer and the model has nothing left to decide.
   *
   * Since #48 `threadKind` is the better-named input and is preferred when it is given; this is
   * still read for the pre-flow room-level stream, which is the one place a model still decides.
   */
  anchoredThread?: boolean;
  /**
   * **Which of the collab doc's three channels this turn is in** (#48, brief §4.1): the doc chat,
   * a span thread opened with Ctrl+E, or a private thread with Ellie or Max.
   *
   * `private` is the one that changes a rule: a private thread never edits the doc, never reaches
   * the group context, and `rule:ellie_answers` must not fire in it — the private turn is handled
   * by the whisper path, which does not run the orchestrator at all. It is declared here so that
   * the gate reads as the brief states it rather than as a null check on an anchor.
   */
  threadKind?: ThreadKind | null;
  /**
   * **`@Ellie` / `@Max`** (brief §4.2 rows 2–3), parsed off the learner's own row in
   * `sendMessage` by `shared/doc/mention.parseMention` and carried here. `null` is no mention.
   *
   * It is an input to the rules rather than to a prompt because the brief makes it one: a mention
   * names the answerer, and *"`@Ellie` → Ellie only, no follow-up"* is a statement about which
   * turns run, not about how they are worded.
   */
  mention?: AgentAuthor | null;
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
   * **`rule:reference_locked` is retired here** (#48; `collab-doc.md` §9 retires the REFERENCE
   * entry card, and #41 had already stopped anything pushing one).
   *
   * It used to be checked before every other rule: while an `answer` card waited for "Explain it
   * back", neither agent could post into that thread. Nothing has inserted such a card since #41
   * — `actor.#answers` is constructed empty and never appended to — so the branch was unreachable
   * in the running app and is now unreachable in the rules too. `DecisionInput.referenceLocked`
   * stays as an accepted-and-ignored field; `flow.handOffDue`'s R4 keeps its own copy, which is
   * likewise always false and is left alone.
   */
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
  // (§6, beat 11) — see `DecisionInput.askedHere`. `@Ellie` is the same exemption said by the
  // learner rather than by a button (#48, brief §4.2 row 2): they named the Teacher, so the
  // question they asked her is not an answer to Max's and must not draw a Tester turn.
  if (pending !== null && quizOpen(pending) && input.askedHere !== true && input.mention !== 'ellie') {
    const quiz = pending;
    const attempts = attemptsOf(quiz);
    const learnerTurn = input.trigger === 'student_message' || input.trigger === 'promote';
    /**
     * **The answer is released, at any time, with or without an attempt** (#48, brief §4.4).
     *
     * `attempt-first.md` §2.3 withheld it until one attempt (`rule:answer_withheld`), and
     * `collab-doc.md` §1 retires that knowingly: *"a learner must never see a question they never
     * get the answer to, and a refused answer teaches less than a lowered question"*. The
     * transcripts cannot settle which is right — it is A2's first test — so the change is recorded
     * as a departure rather than as a finding. What replaces the refusal is §4.5's pitch: the next
     * question on this objective is **easier**, which is R6 L20's own correction made automatic.
     *
     * `moveType` stays `quiz_answer`, so `#noteTurnForFlow` closes the question exactly as before
     * and `classifyAgentTurn` still reads the released answer as teaching rather than as an open
     * question. Only the rule name and the gate changed.
     */
    const release = (why: string): TurnDecision => ({
      speak: true,
      role: 'challenger',
      moveType: 'quiz_answer',
      probeType: null,
      targetElementId: quiz.elementId,
      challenges: [],
      rationale: why,
      decidedBy: 'rule:answer_released',
      handOffLine: null,
      failure: null,
    });
    if (input.showAnswer === true) {
      return release(
        attempts >= 1
          ? 'The learner passed on the question after attempting it; Max gives the answer in full.'
          : 'The learner passed on the question; Max gives the answer in full rather than refusing it.',
      );
    }
    if (learnerTurn && input.learnerTurn === 'give_up') {
      return release(
        attempts >= 1
          ? 'The learner gave up after attempting it: Max gives the answer with its grounds and says ' +
            'what the attempt already had of it.'
          : 'The learner gave up before attempting it. The answer is given anyway (collab-doc §4.4) ' +
            'and the next question on this objective is pitched lower (§4.5).',
      );
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
  if (feedbackDue(input.pendingQuiz ?? null) && input.mention !== 'ellie') {
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
  const isLearnerTurn = input.trigger === 'student_message' || input.trigger === 'promote';

  /**
   * **`@Ellie` and `@Max` name the answerer** (#48, brief §4.2 rows 2–3).
   *
   * Checked here rather than at the top of the function, because the two rules above it outrank a
   * mention and must: a learner who writes *"@Max the Hessian is PSD everywhere"* has answered the
   * open question, and Rowland's mandatory feedback is owed on it whether or not they addressed
   * it. What a mention settles is the case the rules below would otherwise settle by default —
   * `rule:ellie_answers`'s "the thread is the Teacher's".
   *
   * `@Ellie` is also an exemption from the quiz block above (see its gate): naming the Teacher
   * while Max's question is open is the collab-doc's version of "+ Ask here", and it is answered
   * the same way — Ellie explains, the question stays open, and **no follow-up** runs after it
   * (§4.2 row 2, in as many words).
   */
  if (isLearnerTurn && input.mention === 'ellie') {
    return {
      speak: true,
      role: 'peer',
      moveType: 'answer_then_teach',
      probeType: null,
      targetElementId: input.suggestedTargetElement ?? null,
      challenges: [],
      rationale: 'The learner addressed Ellie by name; she answers, and no follow-up runs after it.',
      decidedBy: 'rule:mention',
      handOffLine: null,
      failure: null,
    };
  }
  if (isLearnerTurn && input.mention === 'max') {
    return {
      speak: true,
      role: 'challenger',
      /**
       * A move of its own, rather than the Teacher's `answer_then_teach` worn by the Tester: Max
       * addressed directly is still the Tester, and the directive for this move says so — he
       * answers what was asked and does not slide into asking a new question, which is what the
       * Tester's other moves are all for.
       */
      moveType: 'mention_reply',
      probeType: null,
      targetElementId: input.suggestedTargetElement ?? null,
      challenges: [],
      rationale: 'The learner addressed Max by name; he answers, and Ellie stays out of it.',
      decidedBy: 'rule:mention',
      handOffLine: null,
      failure: null,
    };
  }

  /**
   * **A learner turn in the doc chat or a span thread is Ellie's to answer, and no model decides
   * it** (#48, brief §4.2 row 1; `rule:teacher_answers` renamed).
   *
   * The rule is unchanged in substance and in its original justification — it is the fix for the
   * 2026-09-16 silence, where 20 s of Sonnet bought a move the code could not map, in a thread
   * whose answerer was already forced. What #48 changes is the gate and the name:
   *
   *  - the gate reads the **thread kind** rather than "has an anchor". A private thread is the one
   *    place this must not fire (brief §4.1: private threads are their own channel and never run
   *    the orchestrator at all), and naming that is clearer than relying on a private thread never
   *    reaching here;
   *  - the name is `rule:ellie_answers`, which is the brief's own name for it, and the turn it
   *    decides is now **the first of two**: `rule:max_followup` chains one Socratic follow-up
   *    after it unless a question is already open (§4.2, and `followupDue` below).
   *
   * The pre-flow room-level stream (`threadKind` absent, `anchoredThread` false) still goes to the
   * model, which is the only place a second standing agent could still be in play.
   */
  const kind = input.threadKind ?? null;
  const ellieAnswers = kind === null ? input.anchoredThread === true : kind !== 'private';
  if (isLearnerTurn && ellieAnswers) {
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
      rationale: 'The learner asked in the doc chat; the thread is the Teacher\'s and she answers it.',
      decidedBy: 'rule:ellie_answers',
      handOffLine: null,
      failure: null,
    };
  }
  return null;
}

// ── the turns the actor writes in code (#48) ───────────────────────────────

/**
 * **`rule:max_followup`** (brief §4.2 row 1, second turn).
 *
 * *"Asks in doc chat, no mention → **Ellie answers in full**, then **Max asks one follow-up** to
 * the chat."* It is not a `ruleDecision` branch because it is not a decision about *this* turn: it
 * is a second turn chained after Ellie's, which the actor runs at the end of `#runAgentTurn`. The
 * rule name and the gate live here anyway, beside the rules they have to agree with.
 *
 * **The gate is the brief's own invariant**: *"One open Max question at a time per file.
 * `rule:max_followup` does not fire while one is open; Ellie's answer to a new learner question
 * simply stands, and Max's open question stays open."* `PendingQuiz` is per-actor and an actor is
 * per-room and a room is per-file, so the invariant costs nothing to enforce — but it is stated as
 * a function so the test can quote it.
 *
 * A mention suppresses it too: §4.2 row 2 says `@Ellie` draws no follow-up, and row 3 gives the
 * whole turn to Max, who does not then follow himself up.
 */
export function followupDue(input: {
  decidedBy: string;
  pendingQuiz?: PendingQuiz | null;
  mention?: AgentAuthor | null;
  threadKind?: ThreadKind | null;
}): boolean {
  if (input.decidedBy !== 'rule:ellie_answers') return false;
  if (input.mention != null) return false;
  if (input.threadKind === 'private') return false;
  return !quizOpen(input.pendingQuiz ?? null);
}

/**
 * The follow-up turn's decision, written here rather than by a model for the same reason
 * `rule:try_here` is: the learner's question has already settled that a question is owed, and the
 * only thing left to choose is the wording, which is the model's job and not the orchestrator's.
 *
 * `challenges` carries the objective, because a question is what puts an element under test —
 * that is the ledger's `defended` gate, and the difference between this and a hint.
 */
export function maxFollowupDecision(objectiveId: string | null): TurnDecision {
  return {
    speak: true,
    role: 'challenger',
    moveType: 'quiz',
    probeType: null,
    targetElementId: objectiveId,
    challenges: objectiveId ? [objectiveId] : [],
    rationale:
      'Ellie answered the learner’s question and no question is open, so Max asks one Socratic ' +
      'follow-up on an objective the answer touched (collab-doc §4.2).',
    decidedBy: 'rule:max_followup',
    handOffLine: null,
    failure: null,
  };
}

/**
 * **`rule:closure`** (brief §4.7): the flow session went idle, or the file is closing, with a Max
 * question still open. He releases the answer; the doc's Q block resolves as *released*.
 *
 * Same shape as `rule:answer_released` — `moveType: 'quiz_answer'`, so everything downstream
 * closes the question the way it always has — with its own rule name so the log can tell a
 * learner's give-up apart from a debt the app paid on its own.
 */
export function closureDecision(elementId: string): TurnDecision {
  return {
    speak: true,
    role: 'challenger',
    moveType: 'quiz_answer',
    probeType: null,
    targetElementId: elementId,
    challenges: [],
    rationale:
      'The question was still open when the sitting went idle. No question Max asked is left ' +
      'without its answer (collab-doc §4.7), so he releases it.',
    decidedBy: 'rule:closure',
    handOffLine: null,
    failure: null,
  };
}

/**
 * **`rule:lesson_start`** (brief §6): the lesson card's **Start**.
 *
 * *"posts an Ellie message in the doc chat announcing what we need to understand and the
 * objective; scrolls the doc to the segment that carries it; has Ellie prompt the learner to ask a
 * question to begin."* The scroll is the renderer's; the two Ellie halves are one turn, and this
 * is its decision. It reuses `tryHere`'s code path — the learner named the move, so there is
 * nothing for a model to decide — with the Teacher on the floor instead of the Tester.
 */
export function lessonStartDecision(objectiveId: string): TurnDecision {
  return {
    speak: true,
    role: 'peer',
    moveType: 'lesson_start',
    probeType: null,
    targetElementId: objectiveId,
    challenges: [],
    rationale: 'The learner pressed Start on a lesson card; Ellie says what it is about and invites the first question.',
    decidedBy: 'rule:lesson_start',
    handOffLine: null,
    failure: null,
  };
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
  const quiz = input.pendingQuiz ?? null;

  /**
   * **An open question outranks whoever spoke last** (issue #47, live run of 2026-09-19).
   *
   * The learner clicked "+ Try this", asked Ellie a clarification in the same thread, and went
   * quiet. `lastAgentTurn` was `teacher_explanation`, so the branch below said nothing, and no
   * stage 2 ever followed: an unanswered Tester question with `attempts: 0` sat there with the
   * app silent — the exact case §5 says is the one silence the app *does* fill. What the silence
   * means is decided by what the learner owes, and an open quiz is a debt regardless of the last
   * speaker. Both stages are the Tester's, so the divider does not read "Ellie stepped in" over
   * Max's question: stage 1 is the content-free pool (§C5, role-agnostic in `#generate`), stage 2
   * is his hint. `feedbackDue` is excluded — that is the Tester owing the learner, not the reverse,
   * and `ruleDecision` settles it before a silence can reach here.
   */
  if (quizOpen(quiz) && !feedbackDue(quiz)) {
    /**
     * **Ellie's cue, then Max's prompt** (#48, `collab-doc.md` §4.3).
     *
     * This is the design decision the A1 report is built on, and it replaces the content-free
     * line and the hint **only in the case §4.3 is about**: Max's question has waited past the
     * reading-time threshold and the learner has **not attempted it**. The evidence is R6 — 5 of 6
     * questions handed back unattempted before the learner set rules by hand, and both hints
     * followed by a bare `answer?` (`convergence.md`). A hint into that silence is the app doing
     * the retrieval; a content-free line into it is the app saying nothing. What Xu et al. (2026)
     * put there instead is **a peer with something to improve on**, which is what this is.
     *
     *  - stage 1 — Ellie offers an unsure, partial take as a peer: ≤ 60 words, hedged, part right,
     *    possibly with one plausible student mistake, never the full answer, tagged *Ellie's
     *    guess* in the thread and **never written to the doc**;
     *  - stage 2 — Max answers her, **aimed at the learner**: ≤ 50 words, neither confirming nor
     *    correcting yet, naming the part worth looking at and asking them to improve on it or say
     *    whether she is right.
     *
     * **It fires once per question**, which is why the gate is `cueGiven(quiz)` on the question
     * and not a count on the timer: a question outlives any one silence window, and §4.3 says
     * *"After it, silence is left alone until the closure rule (§4.7)"*.
     *
     * After an attempt the old pair stands unchanged — a learner who has answered and gone quiet
     * is waiting on feedback or revising, not failing to start, and §4.3's peer take would be
     * answering a question they have already had a go at.
     */
    const noAttemptYet = attemptsOf(quiz) === 0;
    if (noAttemptYet && cueGiven(quiz)) {
      return {
        ...SILENT,
        rationale:
          'Ellie has already offered her take on this question and Max has already put it back to ' +
          'the learner. It fires once per question (collab-doc §4.3); the rest is closure’s.',
        decidedBy: 'rule:cue_spent',
      };
    }
    if (noAttemptYet && stage === 1) {
      return {
        speak: true,
        role: 'peer',
        moveType: 'peer_guess',
        probeType: null,
        targetElementId: quiz!.elementId,
        // Nothing is under test: a guess Ellie made is not the learner defending anything, and
        // `challenges` is the ledger's `defended` gate.
        challenges: [],
        rationale:
          'Max’s question has waited past the reading time with no attempt. Ellie offers an unsure ' +
          'partial take as a peer — something to improve on, in place of an answer (Xu et al. 2026).',
        decidedBy: 'rule:ellie_cue',
        handOffLine: null,
        failure: null,
      };
    }
    if (noAttemptYet) {
      return {
        speak: true,
        role: 'challenger',
        moveType: 'max_prompt',
        probeType: null,
        targetElementId: quiz!.elementId,
        challenges: [],
        rationale:
          'Max answers Ellie’s guess aimed at the learner: he names the part worth looking at and ' +
          'asks them to improve on it or say whether she is right.',
        decidedBy: 'rule:max_prompt',
        handOffLine: null,
        failure: null,
      };
    }
    if (stage === 1) {
      return {
        speak: true,
        role: 'challenger',
        moveType: 'content_free_nudge',
        probeType: null,
        targetElementId: null,
        challenges: [],
        rationale: 'The Tester\'s question is open and the learner has gone quiet: a content-free line, no subject matter.',
        decidedBy: 'rule:silence_quiz_waiting',
        handOffLine: null,
        failure: null,
      };
    }
    return {
      speak: true,
      role: 'challenger',
      moveType: 'quiz_hint',
      probeType: null,
      targetElementId: quiz!.elementId,
      challenges: [],
      rationale:
        'The learner is stuck on the Tester\'s question; the Tester hints, because the Teacher ' +
        'supplying it would be answering the quiz.',
      decidedBy: 'rule:silence_hint',
      handOffLine: null,
      failure: null,
    };
  }

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
  /**
   * **§4.3's pair is a fill, not new material** (#48). Ellie's guess and Max's prompt are both
   * answers to a silence on a question that is still open, and the thread is still about that
   * question after them — so they leave the classification where it was, exactly as the five
   * fills above do. Without this, Max's prompt (which matches none of the `quiz*` patterns) would
   * be read as teaching, and the closure rule would then be looking at a thread the app believed
   * had moved on.
   */
  'peer_guess',
  'max_prompt',
  /**
   * The lesson card's opening turn asks the learner to ask (brief §6). It teaches nothing, so the
   * quiet after it is the quiet before a first question rather than a failed explanation.
   */
  'lesson_start',
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

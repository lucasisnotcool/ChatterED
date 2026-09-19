/**
 * **The attempt loop, as pure functions** (issue #47, `docs/research/attempt-first.md` §2 and §6).
 *
 * The rule the brief is about — *Max does not give the answer until the learner has typed one
 * attempt* — is enforced in the orchestrator, not here. What is here is the other half: **which
 * control the thread offers in which quiz state**, and it is a pure function of `FlowQuizView`
 * for the same reason the rule is code rather than a prompt. A composer that offers *Show the
 * answer* before the first attempt has quietly repealed the decision, and the only way to be sure
 * it does not is to be able to test the mapping without a browser.
 *
 * The evidence for the loop itself is `ai-use-transcripts/analysis/findings.md` §3.0 and RQ5: in
 * five of six coded sessions the learner never produced an attempt and the AI never asked for
 * one, and the single productive session became productive only after the learner typed *"I will
 * attempt the question"* and *"do not send the answer"*. This file is that protocol, made default.
 */
import type { FlowQuizView } from '../../shared/types.js';
import type { LearningTree } from './objectives.js';

/** The thread composer's ordinary placeholder — what it says when no quiz is open. */
export const EXPLAIN_PLACEHOLDER = 'Explain this in your own words…';
/**
 * The placeholder while the Tester's question is open and unanswered. The box is asking for one
 * thing, and §2.2 is explicit that a two-word answer still counts: it may not move the ledger,
 * but it lifts the answer lock. So the word is *attempt*, not *answer*.
 */
export const ATTEMPT_PLACEHOLDER = 'Your attempt…';
/**
 * The placeholder after feedback that was not *Well done*: the Tester's turn ended on a follow-up
 * question (§2.4, second cut), and the box is asking for the attempt at that.
 */
export const NEXT_ATTEMPT_PLACEHOLDER = 'Your next attempt…';

/**
 * The one quiet line under the composer before the first attempt.
 *
 * It is a statement of the rule, not a warning, and it names the agent the rule is about — R6's
 * learner wrote the same sentence by hand at turn 20 and the session's attempt count went 4 → 17.
 * Saying it up front is the difference between a withheld answer that reads as a design and one
 * that reads as a model being evasive.
 */
export function attemptNote(testerName = 'Max'): string {
  return `${testerName} won't give the answer until you've tried once.`;
}

/**
 * The line under the composer after feedback, by verdict (§2.4, second cut). Lucas's 2026-09-19 run:
 * two feedback turns in, he wrote *"It is not very clear to me if I have answered, or if I need to
 * try again."* These two sentences are the answer to that, drawn from the state rather than left
 * to the prose.
 */
export function followUpNote(testerName = 'Max'): string {
  return `${testerName} asked a follow-up. Answer it here, or try another question.`;
}

export function doneNote(testerName = 'Max'): string {
  return `${testerName} marked that done. Try another for the next question.`;
}

/** What the thread draws for the quiz it has, if any. Every field is a pure function of it. */
export interface QuizControls {
  /**
   * This thread has a Tester question on it. True from the question landing until the thread is
   * reopened on another — including after a shown answer, when the composer is an ordinary
   * composer again but **Try another** is still the way on.
   */
  open: boolean;
  /** The composer's placeholder. */
  placeholder: string;
  /** The quiet one-liner under the composer, or null once it has been earned. */
  note: string | null;
  /** **Try another** — `flow:tryHere` on this anchor; main picks the lowest-level objective. */
  tryAnother: boolean;
  /** **Show the answer** — `flow:showAnswer`. Never before one attempt (§2.4). */
  showAnswer: boolean;
}

const CLOSED: QuizControls = {
  open: false,
  placeholder: EXPLAIN_PLACEHOLDER,
  note: null,
  tryAnother: false,
  showAnswer: false,
};

/**
 * Which controls a thread shows, from its quiz alone.
 *
 * Three states and no others:
 *
 *  - **asked, nothing tried** (`attempts === 0`) — the attempt placeholder and the note. No
 *    controls: there is nothing to try another of yet and the answer is locked.
 *  - **feedback given** — **Try another**, and **Show the answer** while `attempts >= 1` and the
 *    answer has not been shown. `attempts >= 1` is implied by feedback existing and is asserted
 *    anyway, because it is the invariant the whole decision rests on. The composer says which
 *    way the feedback went: after a `partial` verdict it asks for the next attempt and the note
 *    says a follow-up was asked; after `complete` the note says the question is done.
 *  - **answer shown** — **Try another** only. The answer cannot be shown twice and §2.3 closes
 *    the quiz on it, so the only way forward is another question.
 *
 * Between an attempt and its feedback (the Tester's 9–12 s floor) neither control is offered:
 * the learner has just written something and the reply is on its way, and an escape hatch drawn
 * during that wait is an invitation to skip the feedback the loop exists for.
 */
export function quizControls(quiz: FlowQuizView | null | undefined, testerName = 'Max'): QuizControls {
  if (!quiz) return CLOSED;
  const settled = quiz.feedbackGiven || quiz.answerShown;
  const verdict = quiz.feedbackGiven && !quiz.answerShown ? (quiz.verdict ?? null) : null;
  const placeholder =
    quiz.attempts === 0
      ? ATTEMPT_PLACEHOLDER
      : verdict === 'partial'
        ? NEXT_ATTEMPT_PLACEHOLDER
        : EXPLAIN_PLACEHOLDER;
  const note =
    quiz.attempts === 0 && !quiz.answerShown
      ? attemptNote(testerName)
      : verdict === 'partial'
        ? followUpNote(testerName)
        : verdict === 'complete'
          ? doneNote(testerName)
          : null;
  return {
    open: true,
    placeholder,
    note,
    tryAnother: settled,
    showAnswer: quiz.feedbackGiven && quiz.attempts >= 1 && !quiz.answerShown,
  };
}

// ── "+ Try this", and when it cannot be offered ────────────────────────────

/**
 * Whether the card's **"+ Try this"** line is live, and the sentence it says when it is not.
 *
 * §2.1: the objective is picked from the tree, so a tree that is `pending` or `failed` has
 * nothing to pick from and the line is disabled **with the reason on it** rather than hidden. A
 * hidden control is indistinguishable from a control this build does not have; a disabled one
 * with a tooltip is the app saying what it is waiting for.
 *
 * `note` is the scripted backend's honest sentence (`objectives.ts` `backendNote()`), passed in
 * so this function stays free of both the backend and the fixture.
 */
export interface TryHereState {
  enabled: boolean;
  /** Null when enabled; otherwise the title/tooltip, and what a screen reader reads. */
  reason: string | null;
}

export function tryHereState(input: {
  tree: Pick<LearningTree, 'status' | 'error'> | null;
  teacherName?: string;
  note?: string | null;
  /** False on a build whose preload does not carry `flow:tryHere` yet. */
  reachable?: boolean;
}): TryHereState {
  const teacher = input.teacherName ?? 'Ellie';
  const note = input.note ?? null;
  const tree = input.tree;
  if (input.reachable === false) {
    return { enabled: false, reason: 'This build cannot ask for a question yet.' };
  }
  // No tree at all: the ingest was never asked for, or this backend cannot do one. Either way
  // there is no objective to quiz from, and the backend's own sentence is the better one.
  if (!tree) return { enabled: false, reason: note ?? `${teacher} has not read this deck yet.` };
  if (tree.status === 'pending') {
    return { enabled: false, reason: note ?? `${teacher} is still reading the deck.` };
  }
  if (tree.status === 'failed') {
    return { enabled: false, reason: tree.error ?? note ?? `${teacher} could not read this deck.` };
  }
  return { enabled: true, reason: null };
}

// ── The rule tags on a Tester turn (§2.3) ──────────────────────────────────

/**
 * The small tag on a turn a §2.3 rule decided.
 *
 * `byRule` is for turns a rule **wrote** (the hand-off line); these are turns a rule **decided**,
 * generated as normal, and the existing `by rule` tag deliberately stays off them. But the two
 * decisions the brief calls the app's "one important design decision" for the report — the answer
 * withheld, and the answer shown without moving the ledger — are exactly the ones the learner has
 * to be able to see, so they get a tag of their own that says which rule fired.
 *
 * Nothing else is tagged: `rule:quiz_feedback`, `rule:quiz_clarify` and `rule:quiz_nudge` are
 * the ordinary course of the loop, and a tag on every Tester turn is a tag on nothing.
 */
export interface RuleTag {
  label: string;
  title: string;
}

const RULE_TAGS: Record<string, RuleTag> = {
  'rule:answer_withheld': {
    label: 'answer withheld until you try',
    title:
      'A rule in the orchestrator, not a choice Max made: the answer is not given before one attempt. One try unlocks it.',
  },
  'rule:answer_shown': {
    label: 'answer shown · ledger unchanged',
    title: 'You asked for the answer after trying. It is logged, and it moves nothing on the ledger.',
  },
};

export function ruleTag(decidedBy: string | null | undefined): RuleTag | null {
  if (!decidedBy) return null;
  return RULE_TAGS[decidedBy] ?? null;
}

/**
 * **The director of a free-form sitting** (`sim/README.md`, "Free-form runs").
 *
 * The learner model chooses its own moves and words, but a conversation is only useful to a judge
 * if the things the judge reads for actually happen in it. So on each turn the director narrows
 * what the learner may do, and forces a move when the plan needs one, until the sitting has:
 *
 *  1. a learner question that Ellie explains;
 *  2. a question from Max (in a build where Max only asks on request, the learner presses Quiz me
 *     after `quizAfterAsks` questions, as a learner of that build would have to);
 *  3. an attempt on it that gets feedback;
 *  4. a give-up (Show me, or typed), then the next question, and an attempt on that.
 *
 * Within that, the plan's `situation` shapes the first attempt (natural, partial, wrong), when the
 * give-up comes, and whether the learner asks Ellie something while Max's question is open.
 */
import type { FreeAction, FreeMove, FreePersona } from './freelearner.js';
import type { OpenQuestion, Sitting } from './sitting.js';
import { coverageComplete, coverageOf, turnsOf } from './export.js';

export type Situation = 'first_attempt' | 'partial' | 'wrong' | 'give_up' | 'ellie_while_open';

export interface ConversationSpec {
  id: string;
  persona: string;
  /** A key of the plan's `builds`: the environment the app runs under. */
  build: string;
  situation: Situation;
  giveUp: 'button' | 'typed';
  /** Line keys (of the plan's `lines`), in the order the learner asks about them. */
  lines: string[];
  /** Override the persona's preferences. */
  askVia?: 'chat' | 'line';
  answerVia?: 'chat' | 'notes';
  /** The learner may push back on a verdict once. */
  dispute?: boolean;
  /** The learner writes a note of their own once. */
  note?: boolean;
  /** Learner turns: at least 6, at most `maxTurns` (default 14). */
  maxTurns?: number;
  /** Questions to Ellie before Quiz me, where Max does not follow up (default 2). */
  quizAfterAsks?: number;
  expectFail?: boolean;
  purpose: string;
}

export interface Plan {
  notebook: string;
  /** key → a block id (`b_…`) or words of the line. */
  lines: Record<string, string>;
  /** build key → the environment variables that make it. */
  builds: Record<string, Record<string, string>>;
  conversations: ConversationSpec[];
}

export interface Step {
  allowed: FreeAction[];
  guidance: string[];
  /** The line this turn is about, if any (a plan line key). */
  lineKey: string | null;
}

export const MIN_TURNS = 6;

interface State {
  asks: number;
  asksSinceQuestion: number;
  hintUsed: boolean;
  disputed: boolean;
  noted: boolean;
  sideAsked: boolean;
  questionsSeen: string[];
  gaveUpOn: string | null;
  attemptsOn: Map<string, number>;
}

export class Director {
  readonly spec: ConversationSpec;
  readonly persona: FreePersona;
  readonly followsUp: boolean;
  readonly #s: State = {
    asks: 0,
    asksSinceQuestion: 0,
    hintUsed: false,
    disputed: false,
    noted: false,
    sideAsked: false,
    questionsSeen: [],
    gaveUpOn: null,
    attemptsOn: new Map(),
  };

  constructor(spec: ConversationSpec, persona: FreePersona, followsUp: boolean) {
    this.spec = spec;
    this.persona = persona;
    this.followsUp = followsUp;
  }

  get maxTurns(): number {
    return this.spec.maxTurns ?? 14;
  }

  #lineKey(): string {
    return this.spec.lines[this.#s.asks % this.spec.lines.length]!;
  }

  #attemptGuidance(open: OpenQuestion, first: boolean): string[] {
    if (open.quiz.form === 'cloze') return ['This is a fill-in-the-blank: answer with the word or short phrase you think goes in the blank.'];
    if (!first) return ["Try again, using Max's feedback: add or fix what he said was missing, in your own words and your usual style."];
    switch (this.spec.situation) {
      case 'partial':
        return ['Your answer gets one idea right and leaves out the rest: say one correct thing only, briefly.'];
      case 'wrong':
        return ['Your answer is wrong: answer from your misconception, confidently.'];
      default:
        return ['Answer as this student naturally would, from what you know.'];
    }
  }

  /** What the learner may do now, or null when the sitting is over. */
  async next(sitting: Sitting, turn: number): Promise<Step | null> {
    const s = this.#s;
    const coverage = coverageOf(turnsOf(sitting));
    if (turn >= this.maxTurns) return null;
    if (coverageComplete(coverage) && turn >= MIN_TURNS) return null;
    const open = await sitting.openQuestion();
    if (open && !s.questionsSeen.includes(open.quiz.quizMessageId)) {
      s.questionsSeen.push(open.quiz.quizMessageId);
      s.asksSinceQuestion = 0;
    }
    const giveUpMove: FreeAction = this.spec.giveUp === 'button' ? 'show_me' : 'give_up_typed';
    const newQuestion = (): Step =>
      !this.followsUp && s.asksSinceQuestion >= (this.spec.quizAfterAsks ?? 2)
        ? { allowed: ['quiz_me'], guidance: ['You want to be tested on this line now.'], lineKey: this.#lineKey() }
        : this.followsUp && s.asksSinceQuestion >= 2
          ? // A build that should follow up but did not, twice: ask for a question the other way.
            { allowed: ['quiz_me'], guidance: ['You want to be tested on this line now.'], lineKey: this.#lineKey() }
          : {
              allowed: ['ask'],
              guidance: [
                s.asks === 0
                  ? 'Ask Ellie about the line you are looking at, the way this student would.'
                  : 'Ask Ellie about the line you are looking at now (a different point from before).',
              ],
              lineKey: this.#lineKey(),
            };

    if (!open) {
      // The next question after a give-up: where Max does not follow up, the learner asks for it.
      if (s.gaveUpOn !== null && !this.followsUp && s.questionsSeen.at(-1) === s.gaveUpOn) {
        return { allowed: ['quiz_me'], guidance: ['You want another question on this line.'], lineKey: this.#lineKey() };
      }
      // A free note, once, before anything else is needed.
      if (this.spec.note && !s.noted && s.asks >= 1) return { allowed: ['note'], guidance: ['Write a short note of your own about what Ellie just explained, in your words.'], lineKey: this.spec.lines[0]! };
      if (coverageComplete(coverage)) return { allowed: ['ask', 'note'], guidance: ['Carry on as this student would.'], lineKey: this.#lineKey() };
      return newQuestion();
    }

    const qid = open.quiz.quizMessageId;
    const tries = s.attemptsOn.get(qid) ?? 0;
    const afterGiveUp = s.gaveUpOn !== null && qid !== s.gaveUpOn;
    if (afterGiveUp) {
      if (tries === 0) return { allowed: ['answer'], guidance: this.#attemptGuidance(open, true), lineKey: null };
      return { allowed: ['answer', giveUpMove], guidance: this.#attemptGuidance(open, false), lineKey: null };
    }
    if (s.gaveUpOn === qid) return { allowed: ['show_me'], guidance: ['You have given up on this question.'], lineKey: null };

    if (this.spec.situation === 'ellie_while_open' && !s.sideAsked && tries === 0) {
      return {
        allowed: ['ask'],
        guidance: ["Before answering, ask Ellie something that would help you answer Max's question (she is a different person from Max)."],
        lineKey: this.#lineKey(),
      };
    }
    const questionIndex = s.questionsSeen.indexOf(qid);
    const giveUpAt = this.spec.situation === 'give_up' ? 1 : questionIndex >= 1 ? 1 : 2;
    if (tries >= giveUpAt) {
      return {
        allowed: [giveUpMove],
        guidance: [
          this.spec.giveUp === 'typed'
            ? 'You are stuck and want to be told the answer: say so in your own words (for example that you give up, or ask to just be told).'
            : 'You are stuck: give up on this question.',
        ],
        lineKey: null,
      };
    }
    if (tries === 0) {
      const allowed: FreeAction[] = ['answer'];
      if (!s.hintUsed && this.spec.situation !== 'first_attempt' && this.persona.id !== 'strong-terse') allowed.push('hint');
      return { allowed, guidance: this.#attemptGuidance(open, true), lineKey: null };
    }
    const allowed: FreeAction[] = ['answer'];
    if (this.spec.dispute && !s.disputed) allowed.unshift('dispute');
    return { allowed, guidance: this.#attemptGuidance(open, false), lineKey: null };
  }

  /** Book-keeping after a move has run. */
  record(move: FreeMove, open: OpenQuestion | null): void {
    const s = this.#s;
    const qid = open?.quiz.quizMessageId ?? null;
    switch (move.action) {
      case 'ask':
        s.asks += 1;
        s.asksSinceQuestion += 1;
        if (qid) s.sideAsked = true;
        break;
      case 'answer':
        if (qid) s.attemptsOn.set(qid, (s.attemptsOn.get(qid) ?? 0) + 1);
        break;
      case 'hint':
        s.hintUsed = true;
        break;
      case 'dispute':
        s.disputed = true;
        if (qid) s.attemptsOn.set(qid, (s.attemptsOn.get(qid) ?? 0) + 1);
        break;
      case 'note':
        s.noted = true;
        break;
      case 'show_me':
      case 'give_up_typed':
        if (qid && s.gaveUpOn === null) s.gaveUpOn = qid;
        break;
      case 'quiz_me':
        s.asksSinceQuestion = 0;
        break;
    }
  }
}

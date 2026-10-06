/**
 * The classifier the answer lock runs on (issue #47, `attempt-first.md` §2.2).
 *
 * The `answer_request` cases are **R6's own lines**, copied out of the coded study
 * (`ai-use-transcripts/analysis/findings.md` §3.0): that transcript is the only one of the six
 * that produced attempts at all, and the phrasings it used to ask for the answer are the
 * behaviour this rule has to recognise.
 */
import { describe, expect, it } from 'vitest';
import {
  ANSWER_REQUEST_PHRASES,
  GIVE_UP_PHRASES,
  classifyLearnerTurn,
  isAnswerDemand,
  isComplaintQuestion,
  quizCue,
} from './attempt.js';

describe('classifyLearnerTurn', () => {
  it('reads R6’s own asks as a give-up', () => {
    for (const line of [
      'answer?',
      'please solve the question',
      "what's the answer",
      'send me the answer',
      'how would you do it?',
    ]) {
      expect(classifyLearnerTurn(line), line).toBe('give_up');
    }
  });

  it('reads the other phrasings of the same ask', () => {
    for (const line of ['just tell me', 'I give up', 'skip', 'show me the answer', 'solve it']) {
      expect(classifyLearnerTurn(line), line).toBe('give_up');
    }
  });

  /**
   * **The phrasings `collab-doc.md` §4.4 adds**, quoted from the brief: *"I don't know"*, *"idk"*,
   * *"no idea"*, *"I give up"*, *"just tell me"*, *"what's the answer"*, *"this is too hard"*,
   * *"I'm lost"*. The class they join used to be `answer_request` and is now `give_up`, because
   * the rule it feeds released the answer rather than refusing it — and because §4.5 reads a
   * give-up as *"too hard"* and pitches the next question lower.
   */
  it('reads the brief’s don’t-know and frustration phrasings as a give-up', () => {
    for (const line of [
      "I don't know",
      'idk',
      'no idea',
      'I give up',
      'just tell me',
      "what's the answer",
      'this is too hard',
      "I'm lost",
    ]) {
      expect(classifyLearnerTurn(line), line).toBe('give_up');
    }
  });

  /**
   * The line §4.4 draws against a hint request, and the one thing to argue with in the list. A
   * learner who is *stuck* is still inside the question; one who is *lost* has said it is beyond
   * them. The first gets a hint, the second gets the answer and an easier next question.
   */
  it('keeps “I’m stuck” a hint request, and “I’m lost” a give-up', () => {
    expect(classifyLearnerTurn("i'm stuck")).toBe('other');
    expect(classifyLearnerTurn("i'm lost")).toBe('give_up');
  });

  /**
   * The lock is about having tried, not about having explained: **a two-word answer is an
   * attempt.** Rule 4's eight-word floor still stops it moving the ledger, which is the division
   * §2.2 draws and the reason `isAgreementPhrase` exists separately from `isAgreementOnly`.
   */
  it('counts a two-word answer as an attempt', () => {
    expect(classifyLearnerTurn('positive semidefinite')).toBe('attempt');
    expect(classifyLearnerTurn('the Hessian')).toBe('attempt');
  });

  it('counts agreement as other — “ok” is what R6 replied to eleven wrong verdicts', () => {
    expect(classifyLearnerTurn('ok')).toBe('other');
    expect(classifyLearnerTurn('okay got it')).toBe('other');
    expect(classifyLearnerTurn('   ')).toBe('other');
  });

  it('reads a short clarification as a question, not an attempt', () => {
    expect(classifyLearnerTurn('what does T mean?')).toBe('question');
    expect(classifyLearnerTurn('is that the same as the gradient?')).toBe('question');
  });

  /**
   * A hedge is not a clarification. An answer that ends "is that right?" has earned the feedback
   * turn, and classifying it as a question would withhold it.
   */
  it('reads a long answer that ends “is that right?” as an attempt', () => {
    const answer =
      'The Hessian has to be positive semidefinite at every point for the function to be convex, is that right?';
    expect(classifyLearnerTurn(answer)).toBe('attempt');
  });

  /**
   * **A guess phrased as a question is an attempt** (Lucas, 2026-09-19, on the MDP deck). This line
   * drew `rule:quiz_clarify`: Max clarified, nothing was marked, and the learner did not know
   * whether he had answered. It opens like a question and carries two candidate answers.
   */
  it('reads a hedged guess, or a choice between alternatives, as an attempt', () => {
    expect(
      classifyLearnerTurn('is it an action, or a series of actions that lead to the goal state from the current state?'),
    ).toBe('attempt');
    expect(classifyLearnerTurn('is it trying to find the best possible action from the current state towards the goal?')).toBe(
      'attempt',
    );
    expect(classifyLearnerTurn('The entire output is a list of actions and states from I to G?')).toBe('attempt');
    expect(classifyLearnerTurn('could it be the transition model?')).toBe('attempt');
    expect(classifyLearnerTurn('is the answer discrete and deterministic?')).toBe('attempt');
    expect(classifyLearnerTurn('deterministic, or fully observable?')).toBe('attempt');
  });

  it('still reads a question about a term, or about the question, as a question', () => {
    expect(classifyLearnerTurn('what are you asking here?')).toBe('question');
    expect(classifyLearnerTurn('what does the or in step 3 mean?')).toBe('question');
    expect(classifyLearnerTurn('do you mean the whole plan?')).toBe('question');
  });

  /**
   * **#49, Lucas's 2026-09-23 run on Lecture 4.** The first line is two sentences, so it missed
   * the one-sentence `question` rule and was marked *Not yet* — a learner refused the background
   * they asked for in order to try. The answers that followed in the same run are still attempts.
   */
  it('reads a request for background as a question, however many sentences it runs to', () => {
    for (const line of [
      'Can you give me example of how SAT instances are encoded, format for CNF vars and clauses? I am not familiar with SAT format',
      'what is a sat based planner?',
      "I don't know what CNF means, can you explain it?",
      "I'm not familiar with SATPlan. Could you explain what it does first?",
      'explain the frame axioms please',
    ]) {
      expect(classifyLearnerTurn(line), line).toBe('question');
    }
    for (const line of [
      'It might branch on At(c, a) or At(c, p), since these are possible outcomes depending on which load action is taken',
      'The search space is infinite? So picking any given fluent is also reversible and h(s) is meaningless',
      'It only tells the solver the next state to go to',
      'Oh it can simplify the reduce degrees of freedom of CNF formula',
      'What does admissible mean? I think it means it never overestimates',
    ]) {
      expect(classifyLearnerTurn(line), line).toBe('attempt');
    }
    // A bare don't-know is still a give-up: it asks for nothing.
    expect(classifyLearnerTurn("I don't know")).toBe('give_up');
    expect(classifyLearnerTurn('give up')).toBe('give_up');
  });

  /**
   * **#49, widened (2026-09-25).** Replaying realistic phrasings through the first cut found most
   * still marked *Not yet*, and two worse: *"I don't know how SAT encoding works"* and *"I don't know
   * SAT format"* were give-ups, so asking for the format released the answer and closed the
   * question. Read clause by clause, after the fillers, `?` optional.
   */
  it('reads the realistic phrasings of a request for background as a question', () => {
    for (const line of [
      "What's CNF? We never covered it.",
      'wait what is a fluent',
      "I don't know how SAT encoding works",
      "I don't know SAT format",
      // The issue's own line, as it was pasted: an ellipsis, not a question mark.
      'Can you give me example of how SAT instances are encoded… I am not familiar with SAT format',
      'what do you mean by frame axioms',
      'Sorry, what do you mean by frame axioms?',
      'What does that mean',
      'Before I try, what does a CNF clause look like?',
      // `because` explains the request; it is not a candidate answer.
      "I'm not familiar with CNF because we didn't cover it",
      'how does SAT encoding work',
      'what is a sat based planner',
      'could you explain the format first',
      'idk what a fluent is',
      "I don't understand the question",
    ]) {
      expect(classifyLearnerTurn(line), line).toBe('question');
    }
  });

  it('still reads the give-ups as give-ups, and a hint request as a hint request', () => {
    for (const line of [
      "I don't know",
      'just tell me the answer',
      'no idea',
      "I don't know how to do this",
      'I have no idea how to do this',
      "I don't know what the answer is",
      "I'm lost",
      'idk',
    ]) {
      expect(classifyLearnerTurn(line), line).toBe('give_up');
    }
    expect(classifyLearnerTurn('can you give me a hint')).toBe('other');
    expect(classifyLearnerTurn('can you help me out here')).toBe('other');
  });

  it('still reads an answer as an attempt, even one that asks something first or says because', () => {
    for (const line of [
      "I think it's because the clauses encode preconditions",
      'Each action at step t implies its preconditions at step t, because the clauses encode them',
      // A question answered in the same turn is an answer.
      "What's CNF? It's the clause form, so each action becomes a clause",
      // A wh- word can open an answer: no verb after it, or a second one.
      'what the learner gives up is privacy',
      'what is lost is the privacy of the learner',
      'is it the transition model',
      'the learner pays it, when they decide to forward',
    ]) {
      expect(classifyLearnerTurn(line), line).toBe('attempt');
    }
  });

  /**
   * *"can you help me out here"* (the same run): nothing to mark, and not a request for the
   * answer. `other` draws `rule:quiz_nudge` — one hint, no answer — which is the turn it wanted.
   */
  it('reads a request for help as other, so it draws a hint and not a mark', () => {
    for (const line of ['can you help me out here', 'hint?', 'give me a hint', "i'm stuck", 'help']) {
      expect(classifyLearnerTurn(line), line).toBe('other');
    }
    // But an answer that happens to contain "help" is still an answer.
    expect(classifyLearnerTurn('heuristics help the search by estimating the distance to the goal')).toBe('attempt');
  });

  it('does not read an answer that mentions the word answer as a request for one', () => {
    expect(classifyLearnerTurn('my answer is that the Hessian is positive semidefinite')).toBe('attempt');
  });

  it('does not read a long turn as a bare request, however it opens', () => {
    const long = `just tell me ${'more about how the second derivative test generalises to several variables '.repeat(2)}because I want to understand the whole picture properly here`;
    expect(classifyLearnerTurn(long)).toBe('attempt');
  });

  it('keeps the phrase list exported, so the transcript is the source of the rule', () => {
    expect(ANSWER_REQUEST_PHRASES.some((p) => p.phrase === 'answer' && p.match === 'whole')).toBe(true);
    // §4.4's list is a superset of R6's, so nothing the attempt loop recognised has been lost.
    for (const p of ANSWER_REQUEST_PHRASES) {
      expect(GIVE_UP_PHRASES, p.phrase).toContain(p);
    }
    expect(GIVE_UP_PHRASES.some((p) => p.phrase === 'idk' && p.match === 'whole')).toBe(true);
  });
});

/**
 * **Item 16 (6 Oct afternoon, `notebooks.md` §11.10).** The two MDP sessions on build 413, quoted.
 * Both ended in anger: *"show me"* (#64) drew a clarification and *"fuck just give answer"* (#66)
 * was marked *Partly there* as an attempt.
 */
describe('demands and complaints', () => {
  it('releases on the real turns: a bare "show me" and "fuck just give answer"', () => {
    expect(classifyLearnerTurn('show me')).toBe('give_up');
    expect(classifyLearnerTurn('fuck just give answer')).toBe('give_up');
    expect(classifyLearnerTurn('GIVE UP')).toBe('give_up');
    expect(classifyLearnerTurn('fuck i give up')).toBe('give_up');
  });

  it('reads the decision’s phrasings in any case, with or without swearing', () => {
    for (const line of [
      'Show me',
      'SHOW ME!',
      'show me.',
      'give answer',
      'just give answer',
      'just give me answer',
      'just give me the answer',
      'Just give the answer',
      'answer pls',
      'ANSWER PLEASE',
      'just tell me',
      'JUST TELL ME',
      'fucking tell me',
      'omg just show me the answer already',
      'pls just give me the answer, I tried',
      'ffs show answer',
      'tell me the answer man',
    ]) {
      expect(classifyLearnerTurn(line), line).toBe('give_up');
      expect(isAnswerDemand(line), line).toBe(true);
    }
  });

  it('keeps asking to be shown something other than the answer a request for background', () => {
    expect(classifyLearnerTurn('show me an example')).toBe('question');
    expect(classifyLearnerTurn('can you show me how CNF clauses are written?')).toBe('question');
    expect(isAnswerDemand('show me an example')).toBe(false);
  });

  it('never reads an answer that mentions "the answer" as a demand', () => {
    expect(classifyLearnerTurn('I think the answer is that the sum must be 1 because it is a distribution')).toBe('attempt');
    expect(isAnswerDemand('my answer: give the answer as a distribution over next states')).toBe(false);
  });

  it('reads "huh what do you want" as a clarification, never an attempt (#58)', () => {
    expect(classifyLearnerTurn('huh what do you want')).toBe('question');
    expect(isComplaintQuestion('huh what do you want')).toBe(true);
    expect(classifyLearnerTurn('so what on earth were you trying to tell me??')).toBe('question');
    expect(classifyLearnerTurn('didnt i answer this?')).toBe('question');
    expect(classifyLearnerTurn('what are you asking for')).toBe('question');
  });

  it('keeps a complaint that carries an answer an attempt (#60)', () => {
    const turn =
      'didnt i answer this? one is optimal and the other is based on fixed policy. optimal means max of ' +
      "actions' expected utility, fixed policy means whatever policy but may be non optimal";
    expect(classifyLearnerTurn(turn)).toBe('attempt');
    expect(isComplaintQuestion(turn)).toBe(false);
  });

  it('marks nothing on a turn that is only a swear word or a groan', () => {
    for (const line of ['fuck', 'ugh', 'wtf', 'omg!!']) expect(classifyLearnerTurn(line), line).toBe('other');
  });

  it('leaves the real answers of the two sessions attempts', () => {
    for (const line of [
      'computed expected utility will be lower than actual, so it pushes the agent away from that choice',
      '$T(s,a,\\cdot)$ must be 1, for a given state and action, to be a valid model',
      'Upi(s) uses pi(s) or the otpimal action, in place of action.',
      'argmax of utility of all possible actions from s',
    ]) {
      expect(classifyLearnerTurn(line), line).toBe('attempt');
    }
  });
});

describe('quizCue', () => {
  it('names every turn of one Tester question with the same number', () => {
    expect(quizCue('try', 2)).toBe('try:2');
    expect(quizCue('handoff', 1)).toBe('handoff:1');
    expect(quizCue('feedback', 2)).toBe('feedback:2');
    expect(quizCue('hint', 2)).toBe('hint:2');
    expect(quizCue('clarify', 2)).toBe('clarify:2');
    expect(quizCue('answer', 2)).toBe('answer:2');
  });

  /** The collab-doc loop's own beats (#48), which `script.notes.ts` is written against. */
  it('names the collab-doc beats the same way', () => {
    expect(quizCue('followup', 1)).toBe('followup:1');
    expect(quizCue('cue', 1)).toBe('cue:1');
    expect(quizCue('prompt', 1)).toBe('prompt:1');
    expect(quizCue('release', 1)).toBe('release:1');
    expect(quizCue('closure', 3)).toBe('closure:3');
    expect(quizCue('doctext', 2)).toBe('doctext:2');
  });
});

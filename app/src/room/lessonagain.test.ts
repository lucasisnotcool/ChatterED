import { describe, expect, it } from 'vitest';
import { SAID_WORDS, lessonAgain, lessonAgainBlock, type LessonMessage } from './lessonagain.js';

/**
 * The Lecture-sdm run of 6 Oct, objective "Formulate a problem as an MDP" (73aff4…): Start at
 * #33, a question at #34, three partials, a give-up at #45 and the release at #46; then Start
 * again at #49, which repeated the walkthrough. Bodies shortened.
 */
const OBJ = '73aff4349c4b76a4';
const OTHER = '41687a366cbac22e';
const SPAN = 'span_40a656c43664';
const RUN: LessonMessage[] = [
  { seq: 3, anchorId: 'span_7b11', objectiveId: OTHER, decidedBy: 'rule:try_here', body: 'In your own words, what does one Bellman update compute?' },
  { seq: 11, anchorId: 'span_7b11', objectiveId: OTHER, decidedBy: 'rule:quiz_feedback', body: '**Well done.**\n\nBoth parts.' },
  {
    seq: 33,
    anchorId: 'doc',
    objectiveId: OBJ,
    decidedBy: 'rule:lesson_start',
    body: 'An MDP is the tuple ⟨S, A, T, R, γ⟩ (p. 6), a model of acting when outcomes are random. The solution is a policy.',
  },
  {
    seq: 34,
    anchorId: SPAN,
    objectiveId: OBJ,
    decidedBy: 'rule:try_here',
    body: 'In your own words, why does the MDP need that sum to equal 1, and what would go wrong if it were 0.9?',
  },
  { seq: 36, anchorId: SPAN, objectiveId: OBJ, decidedBy: 'rule:quiz_feedback', body: '**Partly there.**\n\nStill open is the second half.' },
  { seq: 44, anchorId: SPAN, objectiveId: OBJ, decidedBy: 'rule:quiz_feedback', body: '**Partly there.**\n\nWhat T(s,a,·) is.' },
  {
    seq: 46,
    anchorId: SPAN,
    objectiveId: OBJ,
    decidedBy: 'rule:answer_released',
    body: 'For a fixed s and a, T(s,a,·) is a probability distribution over the next states, so it totals 1.',
  },
  // Ellie answered after the release; not a question, not a close.
  { seq: 48, anchorId: SPAN, objectiveId: OBJ, decidedBy: 'rule:ellie_answers', body: 'Sorry, that was a lot of rounds.' },
];

describe('lessonAgain (decision 15)', () => {
  it('is null on a first Start: nothing to pick up', () => {
    expect(lessonAgain({ objectiveId: OBJ, messages: RUN.filter((m) => m.seq < 33) })).toBeNull();
  });

  it('reads the earlier walkthrough and how each question on the objective ended', () => {
    const again = lessonAgain({ objectiveId: OBJ, messages: RUN })!;
    expect(again.walkthrough).toContain('An MDP is the tuple');
    expect(again.questions).toEqual([
      {
        question: 'In your own words, why does the MDP need that sum to equal 1, and what would go wrong if it were 0.9?',
        result: 'released',
        said: 'For a fixed s and a, T(s,a,·) is a probability distribution over the next states, so it totals 1.',
      },
    ]);
  });

  it('keeps a question that ended Well done or is still open, and clips what Max said', () => {
    const long = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ');
    const again = lessonAgain({
      objectiveId: OBJ,
      messages: [
        ...RUN.slice(0, 4),
        { seq: 35, anchorId: SPAN, objectiveId: OBJ, decidedBy: 'rule:quiz_feedback', body: `**Partly there.**\n\n${long}` },
        { seq: 50, anchorId: 'span_b', objectiveId: OBJ, decidedBy: 'rule:try_here', body: 'Fill in the blank: the agent executes ____.' },
        { seq: 52, anchorId: 'span_b', objectiveId: OBJ, decidedBy: 'rule:quiz_feedback', body: '**Well done.**' },
        { seq: 53, anchorId: 'span_c', objectiveId: OBJ, decidedBy: 'rule:try_here', body: 'How is it different from U_π(s)?' },
      ],
    })!;
    expect(again.questions.map((q) => q.result)).toEqual(['partly', 'well_done', 'open']);
    expect(again.questions[0]!.said.split(' ')).toHaveLength(SAID_WORDS);
    expect(again.questions[1]!.said).toBe('');
  });

  it('after a New Conversation, picks up from the outcome rows and the activity alone', () => {
    const again = lessonAgain({
      objectiveId: OBJ,
      messages: [],
      outcomes: [
        { objectiveId: OBJ, questionId: 'q_1', kind: 'verdict', verdict: 'partial' },
        { objectiveId: OBJ, questionId: 'q_1', kind: 'released', verdict: null },
        { objectiveId: OBJ, questionId: 'q_2', kind: 'verdict', verdict: 'complete' },
        { objectiveId: OTHER, questionId: 'q_3', kind: 'verdict', verdict: 'complete' },
      ],
      activity: { explains: 2, examples: 1 },
    })!;
    expect(again.walkthrough).toBeNull();
    expect(again.outcomes).toEqual({ wellDone: 1, partly: 0, released: 1 });
    const block = lessonAgainBlock(again);
    expect(block).toContain('1 answered well, 0 partly answered, 1 given up on and shown');
    expect(block).toContain('Explain 2 and Example 1 times');
  });

  it('asks for a one-line recap and only what is not yet covered or was got wrong', () => {
    const block = lessonAgainBlock(lessonAgain({ objectiveId: OBJ, messages: RUN })!);
    expect(block).toContain('Do not walk them through it again.');
    expect(block).toContain('An MDP is the tuple');
    expect(block).toContain('they gave up and were shown the answer');
    expect(block).toContain('Open with ONE line recapping where they stand');
    expect(block).toContain('Do not repeat what the walkthrough said');
  });
});

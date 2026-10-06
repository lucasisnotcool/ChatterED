/**
 * D3 and D4 (2026-10-06): one verdict per message and it is the logged one; no question tail
 * after a closing turn; only the question goes into the notes.
 *
 * The first case is the 2026-10-05 run's turn, cut down: it opened *Well done.*, found the page
 * said the opposite, and ended *Not yet.*, and the first line alone was logged.
 */

import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_MAX_WORDS,
  asksTwoThings,
  capFeedback,
  dropCreditOverclaim,
  dropPagePointers,
  dropQuestionTail,
  dropTestingFrame,
  endsOnTwoAsks,
  feedbackFaults,
  feedbackWords,
  firstAsk,
  fixFeedback,
  oneAskAtEnd,
  overclaimsCredit,
  pagePointers,
  questionLine,
  questionText,
  settleVerdict,
  verdictsIn,
  VERDICT_PHRASE,
} from './quizturn.js';

const SELF_CONTRADICTING =
  '**Well done.** p. 44: "Simpler update, but fewer iterations needed." Wait, that sentence is the value ' +
  'iteration remark, so the page actually reads: "Simpler update, but more iterations needed." **Not yet.**';

describe('verdictsIn', () => {
  it('reads every verdict the turn states, in order', () => {
    expect(verdictsIn(SELF_CONTRADICTING)).toEqual(['complete', 'not_yet']);
  });

  it('reads a verdict only as an opener, not inside prose', () => {
    expect(verdictsIn('Partly there. The cost is not yet known, and well done work is rare.')).toEqual(['partial']);
  });

  it('does not split a page citation into a sentence', () => {
    expect(verdictsIn('See p. 4. Not yet. The page says so.')).toEqual(['not_yet']);
  });
});

describe('settleVerdict', () => {
  it('keeps the more cautious of two disagreeing verdicts, said once and first', () => {
    const out = settleVerdict(SELF_CONTRADICTING);
    expect(out.verdict).toBe('not_yet');
    expect(out.change).toBe('corrected');
    expect(out.text.startsWith('**Not yet.** p. 44:')).toBe(true);
    expect(verdictsIn(out.text)).toEqual(['not_yet']);
    expect(out.text).not.toMatch(/well done/i);
  });

  it('leaves a turn with one verdict, first, untouched', () => {
    const text = '**Partly there.** You have the update. p. 44 settles the rest.';
    expect(settleVerdict(text)).toEqual({ text, verdict: 'partial', change: 'none' });
  });

  it('says Partly there when the turn states no verdict, the side flow reads it as', () => {
    const out = settleVerdict('You have the update rule right.');
    expect(out).toEqual({ text: '**Partly there.** You have the update rule right.', verdict: 'partial', change: 'added' });
  });

  it('lets a verdict code already holds win over the words', () => {
    const out = settleVerdict('Well done. The plan reaches the goal.', 'not_yet');
    expect(out.verdict).toBe('not_yet');
    expect(out.text).toBe('**Not yet.** The plan reaches the goal.');
  });

  it('moves a lone verdict that is not first to the front', () => {
    const out = settleVerdict('Close. **Partly there.** The second half is missing.');
    expect(out.text).toBe('**Partly there.** Close. The second half is missing.');
    expect(out.change).toBe('corrected');
  });

  it('uses the phrases the feedback prompt asks for', () => {
    expect(Object.values(VERDICT_PHRASE)).toEqual(['Well done.', 'Partly there.', 'Not yet.']);
  });
});

describe('dropQuestionTail', () => {
  it('drops the "Why…?" tail after a Well done', () => {
    const text =
      '**Well done.** A relaxed problem keeps every original solution, so its optimal cost is a lower bound. ' +
      'In one line, in your own words, why does keeping every original plan make the relaxed cost a lower bound?';
    expect(dropQuestionTail(text)).toBe(
      '**Well done.** A relaxed problem keeps every original solution, so its optimal cost is a lower bound.',
    );
  });

  it('drops several trailing questions, and a closing quote or emphasis after the mark', () => {
    expect(dropQuestionTail('Right. Why? And what then?”')).toBe('Right.');
    expect(dropQuestionTail('Right. **Why?**')).toBe('Right.');
  });

  it('keeps a question quoted mid-turn', () => {
    const text = 'p. 3 asks "what is a plan?" and answers it. That is the answer.';
    expect(dropQuestionTail(text)).toBe(text);
  });

  it('returns a turn that only asks as it was', () => {
    expect(dropQuestionTail('What is a plan?')).toBe('What is a plan?');
  });
});

describe('questionText', () => {
  it('drops the chat preamble and keeps the question', () => {
    const turn =
      'Max here. This one tests the statement, not you, and a rough answer is fine. ' +
      'Take the 4x3 grid on p. 9. What does the policy do in (1,1), and why?';
    expect(questionText(turn)).toBe('Take the 4x3 grid on p. 9. What does the policy do in (1,1), and why?');
  });

  it('keeps a framing sentence that is itself the question', () => {
    const turn = "Here's a question on the p. 4 `Fly` action: what has to hold before it runs, and why not you?";
    expect(questionText(turn)).toBe(turn);
  });

  it('drops a framing sentence that asks nothing', () => {
    const turn = "Here's a question on the p. 4 `Fly` action, so it's the statement I'm testing, not you. What must hold before it runs?";
    expect(questionText(turn)).toBe('What must hold before it runs?');
  });

  it('falls back to the whole turn when everything looked like preamble', () => {
    expect(questionText('Max here.')).toBe('Max here.');
  });
});

describe('questionLine', () => {
  it('is the last sentence that asks, without emphasis', () => {
    expect(questionLine('Take the grid on p. 9. **What does the policy do in (1,1)?**')).toBe('What does the policy do in (1,1)?');
  });

  it('is the blank sentence for a fill-in-the-blank', () => {
    expect(questionLine('Fill in the blank. p. 43: "Final utilities solve the ____ equations."')).toBe(
      'p. 43: "Final utilities solve the ____ equations."',
    );
  });

  it('is the first sentence when nothing asks', () => {
    expect(questionLine('Explain the update rule. Use p. 12.')).toBe('Explain the update rule.');
  });
});

// ── 6 Oct afternoon: the real turns of the two MDP sessions on build 413 ────────────────────

/** #34, Max's opening question in the first session: S6's framing, then two asks. */
const Q34 =
  "I'm testing the statement, not you, so take this as a probe of the idea. On p. 7 the grid world's move " +
  "succeeds with probability 0.8 and slips to each side with 0.1, and p. 6 requires $\\sum_{s'} T(s,a,s') = 1$ " +
  'for every state and action. In your own words, why does the MDP need that sum to equal 1, and what would ' +
  'go wrong for the agent if it were, say, 0.9 for some $(s,a)$?';

/** #53, the second session's: the same two faults. */
const Q53 =
  "I'm testing the statement, not you. p. 10 gives the interpretation: \"Utility of a state is the maximum " +
  'expected immediate reward plus discounted utility of successor states." In your own words, what does that ' +
  'sentence mean, and how is it different from the utility of a state under one fixed policy, $U_\\pi(s)$?';

/** #40, a feedback turn: most of it restating the earlier tries, and a page as the only pointer. */
const F40 =
  '**Partly there.**\n\nTaken together, you have two pieces. You say the sum keeps actions comparable at a state, ' +
  "which fits p. 10: \"$\\pi^*(s) = \\arg\\max_{a\\in A(s)} \\sum_{s'} P(s'|s,a)[R(s,a,s') + \\gamma U(s')]$\". You also " +
  'say a sum of 0.9 undervalues that action and pushes the agent away from it.\n\nYour latest line ties the ' +
  "requirement to the Markov property. p. 6 does say $T$ \"satisfies the Markov property\", but the deck doesn't " +
  'tie the sum-to-1 condition to that property. They are separate conditions.\n\nStill open is the first half of ' +
  'the question: what $T(s,a,\\cdot)$ must be, for a given state and action, to be a valid model. p. 6 settles it.' +
  '\n\nI can show you the answer with **Show me**, or you can try once more in your own words.';

/** #61's pointer, and #59's. */
const F61_TAIL =
  'Still missing is the fixed-policy side: what $U_\\pi(s)$ uses in place of the $\\max$ over actions, and what ' +
  'that does to the successor utilities. p. 14 settles it.';
const F59_LINE = 'The second still needs a clear statement, and p. 14 and p. 15 are the pages on it.';

/** #46, the release: "core idea" about an answer marked Partly there five times. */
const R46_TAIL = 'Your attempt already had the core idea, that an action must have an effect, so the outcomes must total 1.';

describe('asksTwoThings and firstAsk (item 4)', () => {
  it('catches both real opening questions', () => {
    expect(asksTwoThings(Q34)).toBe(true);
    expect(asksTwoThings(Q53)).toBe(true);
  });

  it('keeps only the first ask', () => {
    expect(firstAsk(dropTestingFrame(Q53))).toBe(
      'p. 10 gives the interpretation: "Utility of a state is the maximum expected immediate reward plus ' +
        'discounted utility of successor states." In your own words, what does that sentence mean?',
    );
    expect(firstAsk(Q34).endsWith('In your own words, why does the MDP need that sum to equal 1?')).toBe(true);
  });

  it('catches two sentences that ask, and an imperative second ask', () => {
    expect(asksTwoThings('What holds before Fly runs? What holds after it?')).toBe(true);
    expect(firstAsk('What holds before Fly runs? What holds after it?')).toBe('What holds before Fly runs?');
    expect(asksTwoThings('Say what has to be true before it runs. Then tell me whether each fact comes from the domain.')).toBe(true);
  });

  it('leaves one ask alone, including a difference between two things', () => {
    const one = 'In $U_\\pi(s)$, what takes the place of the $\\max$ over actions?';
    expect(asksTwoThings(one)).toBe(false);
    expect(firstAsk(one)).toBe(one);
    expect(asksTwoThings('What is the difference between what value iteration does and what policy iteration does?')).toBe(false);
    // An "and" inside a formula or a quote is not Max's.
    expect(asksTwoThings('Given "reward, and what follows", why must $a, and b$ hold?')).toBe(false);
  });

  it('reads the first session’s follow-up question as two asks too (#36)', () => {
    expect(
      asksTwoThings(
        'Taking that action at $(s,a)$ with a sum of 0.9, what happens to its computed expected utility relative ' +
          'to the other actions, and which way does that push the agent’s choice?',
      ),
    ).toBe(true);
  });
});

describe('endsOnTwoAsks and oneAskAtEnd (item 4, on a follow-up)', () => {
  const F36 =
    '**Partly there.** You tie the sum to comparing actions. Taking that action at $(s,a)$ with a sum of 0.9, ' +
    'what happens to its computed expected utility relative to the other actions, and which way does that ' +
    'push the agent’s choice?';

  it('reads only the closing question, and cuts it to its first ask', () => {
    expect(endsOnTwoAsks(F36)).toBe(true);
    expect(oneAskAtEnd(F36)).toBe(
      '**Partly there.** You tie the sum to comparing actions. Taking that action at $(s,a)$ with a sum of ' +
        '0.9, what happens to its computed expected utility relative to the other actions?',
    );
  });

  it('leaves one closing ask, and a quoted two-part question in the body, alone', () => {
    const one = '**Partly there.** The sum must be 1, and the reason is what you have to give. Why must it total 1?';
    expect(endsOnTwoAsks(one)).toBe(false);
    expect(oneAskAtEnd(one)).toBe(one);
  });
});

describe('dropTestingFrame (item 5)', () => {
  it('drops the S6 sentence from both real questions', () => {
    expect(dropTestingFrame(Q34).startsWith("On p. 7 the grid world's move")).toBe(true);
    expect(dropTestingFrame(Q53).startsWith('p. 10 gives the interpretation')).toBe(true);
  });

  it('cuts the framing clause off a question that carries it', () => {
    expect(dropTestingFrame("I'm testing the statement, not you, so what must hold before Fly runs?")).toBe(
      'What must hold before Fly runs?',
    );
  });

  it('leaves a question without the framing unchanged', () => {
    const q = 'What must hold before Fly runs?';
    expect(dropTestingFrame(q)).toBe(q);
  });
});

describe('pagePointers and dropPagePointers (item 1)', () => {
  it('finds the page given as the hint in the real feedback turns', () => {
    expect(pagePointers(F40)).toEqual(['p. 6 settles it.']);
    expect(pagePointers(F61_TAIL)).toEqual(['p. 14 settles it.']);
    expect(pagePointers(F59_LINE)).toHaveLength(1);
    expect(pagePointers("p. 12's update, which weights each $s'$ by $P(s'|s,a)$, settles it.")).toHaveLength(1);
    expect(pagePointers("p. 7 settles it, in how the grid's 0.8, 0.1 and 0.1 are described.")).toHaveLength(1);
  });

  it('does not read a grounding quote as a pointer', () => {
    expect(pagePointers('That fits p. 10: "Utility of a state is the maximum expected immediate reward."')).toEqual([]);
    expect(pagePointers('p. 6 does say $T$ "satisfies the Markov property", but not the sum.')).toEqual([]);
    // The grounds rule's own honest limit is not a pointer.
    expect(pagePointers('Whether ephemerality is too, the deck does not settle.')).toEqual([]);
    expect(pagePointers('The deck doesn’t settle this; in general it is a distribution.')).toEqual([]);
  });

  it('takes the pointer out and keeps the rest', () => {
    const out = dropPagePointers(F61_TAIL);
    expect(out).not.toContain('settles');
    expect(out).toContain('Still missing is the fixed-policy side');
  });
});

describe('feedbackWords and capFeedback (item 13)', () => {
  it('counts prose, not formulas', () => {
    expect(feedbackWords("**Partly there.** You have $\\sum_{s'} T(s,a,s') = 1$ right.")).toBe(5);
    expect(feedbackWords("$$U(s) = \\max_a \\sum_{s'} P(s'|s,a)[R + \\gamma U(s')]$$")).toBe(0);
  });

  it('finds the real #40 over the cap', () => {
    expect(FEEDBACK_MAX_WORDS).toBe(60);
    expect(feedbackWords(F40)).toBeGreaterThan(FEEDBACK_MAX_WORDS);
  });

  it('cuts by whole sentences, keeping the verdict and the closing question', () => {
    const long = `**Partly there.** ${'One two three four five six seven eight nine ten. '.repeat(7)}What takes the place of the max?`;
    const cut = capFeedback(long);
    expect(cut.startsWith('**Partly there.**')).toBe(true);
    expect(cut.endsWith('What takes the place of the max?')).toBe(true);
    expect(feedbackWords(cut)).toBeLessThanOrEqual(FEEDBACK_MAX_WORDS);
  });

  it('leaves a turn under the cap unchanged', () => {
    const short = '**Partly there.** The direction is right. What does the sum have to be?';
    expect(capFeedback(short)).toBe(short);
  });
});

describe('feedbackFaults and fixFeedback (items 1, 4, 13)', () => {
  it('finds both faults in the real #40', () => {
    expect(feedbackFaults(F40)).toEqual(['page_pointer', 'too_long']);
  });

  it('fixes a draft that is still faulty after its regeneration', () => {
    const fixed = fixFeedback(F40);
    expect(feedbackFaults(fixed)).toEqual([]);
    expect(fixed.startsWith('**Partly there.**')).toBe(true);
    expect(fixed).not.toContain('settles it');
  });

  it('finds nothing in a short, plain follow-up', () => {
    const plain =
      '**Partly there.** Right: missing mass makes the action look worse. What is missing is the word for ' +
      '$T(s,a,\\cdot)$ at a fixed $s$ and $a$: it is a probability distribution. Use it to say why the total is 1.';
    expect(feedbackFaults(plain)).toEqual([]);
    expect(fixFeedback(plain)).toBe(plain);
  });
});

describe('overclaimsCredit and dropCreditOverclaim (item 17)', () => {
  it('catches the real release’s "core idea"', () => {
    expect(overclaimsCredit(R46_TAIL)).toBe(true);
    const release = `For a fixed $s$ and $a$, $T(s,a,\\cdot)$ is a probability distribution. ${R46_TAIL}`;
    expect(dropCreditOverclaim(release)).toBe('For a fixed $s$ and $a$, $T(s,a,\\cdot)$ is a probability distribution.');
  });

  it('leaves plain credit for one point alone', () => {
    expect(overclaimsCredit('You had that a sum of 0.9 undervalues the action.')).toBe(false);
  });
});

/**
 * D3 and D4 (2026-10-06): one verdict per message and it is the logged one; no question tail
 * after a closing turn; only the question goes into the notes.
 *
 * The first case is the 2026-10-05 run's turn, cut down: it opened *Well done.*, found the page
 * said the opposite, and ended *Not yet.*, and the first line alone was logged.
 */

import { describe, expect, it } from 'vitest';
import { dropQuestionTail, questionLine, questionText, settleVerdict, verdictsIn, VERDICT_PHRASE } from './quizturn.js';

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

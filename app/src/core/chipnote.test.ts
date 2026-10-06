/**
 * Decision 12 (6 Oct afternoon, #67): Max's one sentence on the self-check chip, taken out of his
 * *Well done* turn and allowed to stand only as one short sentence about the material that never
 * quotes the learner back.
 */

import { describe, expect, it } from 'vitest';
import { CHIP_NOTE_MAX_WORDS, CHIP_NOTE_QUOTE_RUN, extractChipNote, refuseChipNote } from './chipnote.js';

/** The Lecture-sdm *Well done* (#11), with the line the prompt now asks for. */
const WELL_DONE = [
  '**Well done.**',
  '',
  "Taken together, your answers cover both parts of the question. That matches p. 12.",
  '',
  "Chip: Each action's value sums $P(s'|s,a)$ times the reward plus the discounted utility of $s'$, and the max picks the best.",
].join('\n');

const ANSWER =
  "each action's sum: Expected utility, by multiplying probability of landing in s' given we take action a from state s, with the utility and discounted future utility of s'";

describe('extractChipNote', () => {
  it('takes the line out of the chat text and keeps the sentence for the chip', () => {
    const out = extractChipNote(WELL_DONE, ANSWER);
    expect(out.refused).toBeNull();
    expect(out.note).toBe("Each action's value sums $P(s'|s,a)$ times the reward plus the discounted utility of $s'$, and the max picks the best.");
    expect(out.text).toBe('**Well done.**\n\nTaken together, your answers cover both parts of the question. That matches p. 12.');
    expect(out.words).toBeLessThanOrEqual(CHIP_NOTE_MAX_WORDS);
  });

  it('forgives emphasis and case around the label', () => {
    expect(extractChipNote('Well done.\n**Chip:** A policy maps states to actions.').note).toBe('A policy maps states to actions.');
    expect(extractChipNote('Well done.\n**chip**: A policy maps states to actions.').note).toBe('A policy maps states to actions.');
  });

  it('leaves a turn without the line as it was, with no note', () => {
    expect(extractChipNote('Well done. That matches p. 3.')).toEqual({ text: 'Well done. That matches p. 3.', note: null, refused: 'missing', words: 0 });
  });

  it('removes a refused line from the chat all the same', () => {
    const out = extractChipNote('Well done.\nChip: You got the max over actions right.');
    expect(out).toMatchObject({ text: 'Well done.', note: null, refused: 'addresses_learner' });
  });

  it('keeps only the last line offered, and removes every one', () => {
    const out = extractChipNote('Chip: First try.\nWell done.\nChip: A discount factor below 1 keeps the sum finite.');
    expect(out.text).toBe('Well done.');
    expect(out.note).toBe('A discount factor below 1 keeps the sum finite.');
  });
});

describe('refuseChipNote', () => {
  it('refuses more than one sentence, but not a page citation or a formula', () => {
    expect(refuseChipNote('Value iteration repeats the update. It stops at convergence.')).toBe('not_one_sentence');
    expect(refuseChipNote('Value iteration repeats the update of p. 12 until changes fall below $\\epsilon$.')).toBeNull();
    expect(refuseChipNote('The update uses $U_{k+1}(s) = \\max_a \\sum_{s\'} P(s\'|s,a)[R + \\gamma U_k(s\')]$ for every state.')).toBeNull();
  });

  it('refuses more than the word cap, counting a formula as one word', () => {
    const long = Array.from({ length: CHIP_NOTE_MAX_WORDS + 1 }, (_, i) => `w${String(i)}`).join(' ') + '.';
    expect(refuseChipNote(long)).toBe('too_long');
    const atCap = Array.from({ length: CHIP_NOTE_MAX_WORDS - 1 }, (_, i) => `w${String(i)}`).join(' ') + ' $a + b + c + d$.';
    expect(refuseChipNote(atCap)).toBeNull();
  });

  it('refuses anything addressed to the learner, a question, a verdict, or nothing', () => {
    expect(refuseChipNote('Your answer names the max over actions.')).toBe('addresses_learner');
    expect(refuseChipNote('What does the max pick?')).toBe('question');
    expect(refuseChipNote('Well done on the Bellman update.')).toBe('verdict');
    expect(refuseChipNote('   ')).toBe('empty');
  });

  it(`refuses ${String(CHIP_NOTE_QUOTE_RUN)} words in a row from the learner's answer`, () => {
    expect(refuseChipNote('The update multiplies probability of landing in s prime by its utility.', ANSWER)).toBeNull();
    expect(refuseChipNote("It multiplies probability of landing in s' given we take action a.", ANSWER)).toBe('quotes_learner');
  });
});

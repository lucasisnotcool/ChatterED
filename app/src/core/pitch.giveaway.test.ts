/**
 * **A fill-in-the-blank must not give its answer away** (2026-10-06 decision, D3; `pitch.ts`,
 * `blankGiveaway`).
 *
 * The cases are Max's own turns from the live runs of 2026-10-03 to 10-05, shortened. In six of
 * the eight blanks that ended a run the answer was quoted whole in the same message or the one
 * before; in one the other row of the slide's table was on screen, and the learner filled the
 * blank with its word.
 */
import { describe, expect, it } from 'vitest';
import { blankGiveaway, blankSentence, blankTerm } from './pitch.js';

describe('blankSentence', () => {
  it('takes the quoted sentence with the blank, without "Fill in the blank:"', () => {
    expect(blankSentence('Partly there. Fill in the blank: p. 44: "Simpler update, but ____ iterations needed."')).toBe(
      'Simpler update, but ____ iterations needed.',
    );
    expect(blankSentence('Fill in the blank: the side channel is private from the rest of the ______.')).toBe(
      'the side channel is private from the rest of the ____.',
    );
  });

  it('is null when there is no blank', () => {
    expect(blankSentence('Partly there. Who else can read it?')).toBeNull();
  });
});

describe('blankTerm', () => {
  const page = 'Value iteration. Simpler update, but more iterations needed. Policy iteration: fewer iterations, but each iteration is more computationally intensive.';

  it('recovers the term from the page, by the words either side of the blank', () => {
    expect(blankTerm('Fill in the blank: "Simpler update, but ____ iterations needed."', page)).toBe('more');
    expect(blankTerm('Final utilities solve the ____ equations; final policy is optimal.', 'Final utilities solve the Bellman equations; final policy is optimal.')).toBe(
      'bellman',
    );
  });

  it('recovers a term of more than one word', () => {
    expect(blankTerm('The ____ is what the action may lead to.', 'The transition model is what the action may lead to.')).toBe('transition model');
  });

  it('is null when the page does not have the sentence, or fills it two ways', () => {
    expect(blankTerm('Simpler update, but ____ iterations needed.', 'Nothing about iterations here.')).toBeNull();
    expect(blankTerm('the ____ model', 'the transition model and the sensor model')).toBeNull();
    expect(blankTerm('Simpler update, but ____ iterations needed.', null)).toBeNull();
  });
});

describe('blankGiveaway', () => {
  it('catches the sentence quoted whole earlier in the same turn', () => {
    const turn =
      'Partly there. p. 43: "Final utilities solve the Bellman equations; final policy is optimal." ' +
      'Fill in the blank: p. 43: "Final utilities solve the ____ equations; final policy is optimal."';
    expect(blankGiveaway({ turn })).toMatchObject({ kind: 'sentence', term: 'bellman', where: 'turn' });
  });

  it('catches the sentence quoted in the message just before', () => {
    const earlier = ['Partly there. p. 11 gives "$R(s)$ is – 0.04 for all states, except +1 or −1 for terminal states". Which states?'];
    const turn = 'Partly there. Fill in the blank: p. 11 says "𝑅(𝑠) is – 0.04 for all states, except +1 or −1 for ____ states."';
    expect(blankGiveaway({ turn })).toBeNull();
    expect(blankGiveaway({ turn, earlier })).toMatchObject({ kind: 'sentence', term: 'terminal', where: 'earlier' });
  });

  it('catches a sentence the turn quotes in its own words around the blank', () => {
    const turn =
      'Your reason lands: p. 23 says "Only final probabilities matter — multi-stage lotteries reduce to a single equivalent lottery." ' +
      'Fill in the blank: p. 23 gives the intuition as "Only ____ probabilities matter — multi-stage lotteries reduce to a single equivalent lottery."';
    expect(blankGiveaway({ turn })).toMatchObject({ kind: 'sentence', term: 'final' });
  });

  it('catches the mirror: the other row of the table, sharing the word beside the blank', () => {
    const turn =
      'Partly there. Still missing is the trade-off as the deck states it, p. 44: "Fewer iterations, but each iteration is more computationally intensive." ' +
      'Fill in the blank: p. 44: "Simpler update, but ____ iterations needed."';
    const hit = blankGiveaway({ turn });
    expect(hit).toMatchObject({ kind: 'mirror', term: 'fewer', where: 'turn' });
    expect(hit?.quoted).toBe('Fewer iterations, but each iteration is more computationally intensive.');
  });

  it('catches the term itself on screen, once the page says what it is', () => {
    const page = 'Simpler update, but more iterations needed.';
    const turn = 'Partly there. Each step costs more here. Fill in the blank: "Simpler update, but ____ iterations needed."';
    expect(blankGiveaway({ turn, pageText: page })).toMatchObject({ kind: 'term', term: 'more' });
  });

  it('catches a term named beside the blank\'s neighbour, as in "Transition model"', () => {
    const turn =
      'The uncertainty sits in p. 6\'s "Transition model of uncertain action outcome or effects", not in the belief. ' +
      'Fill in the blank: p. 6 says "𝑃(𝑠′|𝑠, 𝑎) – probability that action 𝑎 in state 𝑠 reaches state 𝑠′" is the ____ model.';
    expect(blankGiveaway({ turn })).toMatchObject({ kind: 'mirror', term: 'transition' });
  });

  it('passes a blank whose answer is not on screen', () => {
    const turn = 'Partly there. You have who pays it. Fill in the blank: the side channel is private from the rest of the ____.';
    const earlier = ['Partly there. You have part of it, p. 3. Who else can read it?'];
    expect(blankGiveaway({ turn, earlier, pageText: 'The side channel is private from the rest of the group.' })).toBeNull();
  });

  it('does not read a function word beside the blank as a neighbour', () => {
    const turn = 'Partly there. The policy is the action. Fill in the blank: "the ____ is the one that attains the max."';
    expect(blankGiveaway({ turn })).toBeNull();
  });

  it('ignores another blank on screen, and a turn with no blank', () => {
    const earlier = ['Fill in the blank: "Simpler update, but ____ iterations needed."'];
    expect(blankGiveaway({ turn: 'Not yet. Look at p. 44. Fill in the blank: "Simpler update, but ____ iterations needed."', earlier })).toBeNull();
    expect(blankGiveaway({ turn: 'Well done. p. 44: "Simpler update, but more iterations needed."' })).toBeNull();
  });
});

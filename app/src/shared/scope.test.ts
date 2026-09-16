/**
 * The scope rule. Cheap, advisory and in front of an override — see `shared/scope.ts`.
 *
 * The cases that matter are the owner's own question from the 16 Sep report
 * ("Can you summarise what I will be learning"), which must reach the deck, and the ordinary
 * page question, which must not: answering "what does admissible mean" from all 58 pages would
 * make every answer vaguer to fix the one in ten that needs the deck.
 */
import { describe, expect, it } from 'vitest';
import { DECK_ANCHOR_ID, guessScope, scopeShownFor } from './scope.js';

const onSegment = (question: string) => guessScope({ question, anchorId: 'seg_mu3he86g65558u' });

describe('what a question is about', () => {
  it('sends the question that started this to the deck', () => {
    expect(onSegment('Can you summarise what I will be learning').scope).toBe('deck');
  });

  it.each([
    'summarise this lecture',
    'give me an overview',
    'what is the outline of this deck',
    'what will I learn here?',
    'what are the main topics',
    'does anything across the deck build on this',
    'how does p. 40 relate to p. 12',
    'what does this whole deck cover',
  ])('reads %j as a deck question', (question) => {
    expect(onSegment(question).scope).toBe('deck');
  });

  it.each([
    'what does positive semidefinite actually mean?',
    'is manhattan distance admissible here',
    'why is this step necessary',
    'what is the difference between these two',
  ])('leaves %j on the segment', (question) => {
    expect(onSegment(question).scope).toBe('segment');
  });

  it('is deck scope with no anchor at all, whatever was typed', () => {
    const guess = guessScope({ question: 'what does this symbol mean', anchorId: null });
    expect(guess.scope).toBe('deck');
    expect(guess.reason).toBe('no_anchor');
  });

  it('is deck scope on the synthetic deck anchor, so there is one rule and not two', () => {
    expect(guessScope({ question: 'what does this symbol mean', anchorId: DECK_ANCHOR_ID }).scope).toBe('deck');
  });
});

describe('what the card footer says', () => {
  it('names the page, and says when the outline travelled with it', () => {
    expect(scopeShownFor({ scope: 'segment', page: 14 })).toBe('p. 14');
    expect(scopeShownFor({ scope: 'segment', page: 14, outline: true })).toBe('p. 14 + outline');
  });

  it('says "whole deck" when the whole deck went in', () => {
    expect(scopeShownFor({ scope: 'deck' })).toBe('whole deck');
  });

  it('names the retrieved pages rather than claiming the whole deck', () => {
    expect(scopeShownFor({ scope: 'deck', retrievedPages: [3, 14, 40] })).toBe('outline + pp. 3, 14, 40');
  });

  it('does not invent a page number it was not given', () => {
    expect(scopeShownFor({ scope: 'segment', page: null })).toBe('this part');
  });
});

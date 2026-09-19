/**
 * `@Ellie` / `@Max` (§4.2). The mention decides who answers and whether Max's follow-up fires,
 * so a false positive sends a message to the wrong agent and a false negative starts a round
 * nobody asked for — which is why an email address gets its own test.
 */

import { describe, expect, it } from 'vitest';
import { parseMention } from './mention.js';

describe('parseMention', () => {
  it('reads a mention at the start', () => {
    expect(parseMention('@max why does it converge?')).toEqual({ agent: 'max', rest: 'why does it converge?' });
    expect(parseMention('@ellie can you explain this?')).toEqual({ agent: 'ellie', rest: 'can you explain this?' });
  });

  it('is case-insensitive', () => {
    for (const text of ['@Max go', '@MAX go', '@mAx go']) {
      expect(parseMention(text)).toEqual({ agent: 'max', rest: 'go' });
    }
  });

  it('reads one anywhere in the message', () => {
    expect(parseMention('I think, @Ellie, that it converges')).toEqual({
      agent: 'ellie',
      rest: 'I think, that it converges',
    });
    expect(parseMention('what do you think @max')).toEqual({ agent: 'max', rest: 'what do you think' });
  });

  it('tolerates the punctuation people type after a name', () => {
    expect(parseMention('@Ellie, what is this?')).toEqual({ agent: 'ellie', rest: 'what is this?' });
    expect(parseMention('@Max: explain')).toEqual({ agent: 'max', rest: 'explain' });
    expect(parseMention('Ask @max.')).toEqual({ agent: 'max', rest: 'Ask' });
    expect(parseMention('@max!')).toEqual({ agent: 'max', rest: '' });
  });

  it('is not fooled by an email address', () => {
    expect(parseMention('write to a@max.com about it')).toBeNull();
    expect(parseMention('lucas@ellie.org')).toBeNull();
    expect(parseMention('@max.com is not a person')).toBeNull();
  });

  it('needs the whole name', () => {
    expect(parseMention('@maximum effort')).toBeNull();
    expect(parseMention('@maxi')).toBeNull();
    expect(parseMention('@ellies')).toBeNull();
    expect(parseMention('@theo hello')).toBeNull();
  });

  it('needs the marker', () => {
    expect(parseMention('max, why does it converge?')).toBeNull();
    expect(parseMention('I asked Ellie about it')).toBeNull();
  });

  it('lets the first mention win and leaves the second in the sentence', () => {
    expect(parseMention('@Ellie ask @Max about it')).toEqual({ agent: 'ellie', rest: 'ask @Max about it' });
    expect(parseMention('@max and @ellie')).toEqual({ agent: 'max', rest: 'and @ellie' });
  });

  it('tidies the whitespace the removal leaves behind', () => {
    expect(parseMention('hey   @max    why?')).toEqual({ agent: 'max', rest: 'hey why?' });
    expect(parseMention('@max')).toEqual({ agent: 'max', rest: '' });
  });

  it('is null for a message with no mention at all', () => {
    expect(parseMention('')).toBeNull();
    expect(parseMention('why does value iteration converge?')).toBeNull();
    expect(parseMention('the cost is $5 @ 2 per unit')).toBeNull();
  });
});

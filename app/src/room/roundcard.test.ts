import { describe, expect, it } from 'vitest';
import { rosterFor } from './agents.js';
import { PSD_HESSIAN_CONVEXITY_V1 } from './concepts/psd-hessian-convexity-v1.js';
import { SCRIPT_ROUND_CARD } from './llm/script.psd-hessian.js';
import type { ConceptPack } from './records.js';
import { roomMates, roundCardFor, titlePhrase } from './roundcard.js';

/**
 * ui-review-ux.md blocker B4: every real session opened with *"Your slide: convexity and the
 * Hessian"*, whatever the learner was actually explaining, because `actor.ts` returned
 * `SCRIPT_ROUND_CARD` unconditionally. The regression is invisible in the demo session — that
 * one really is about convexity — so it gets a test that uses a different pack.
 */

const roster = rosterFor('ellie_peer');

const PACK: ConceptPack = {
  ...PSD_HESSIAN_CONVEXITY_V1,
  concept_id: 'elicited-test',
  title: 'Pedagogical roles in learning-by-explaining',
};

describe('roundCardFor', () => {
  it('names the concept the learner is actually explaining', () => {
    const card = roundCardFor({ pack: PACK, roster, mode: 'live' });
    expect(card.body).toContain('Your slide: Pedagogical roles in learning-by-explaining.');
    expect(card.body).not.toContain('convexity and the Hessian');
    expect(card.title).toBe('Round 1 · Explain');
  });

  it('keeps every house rule the scripted card states', () => {
    const card = roundCardFor({ pack: PACK, roster, mode: 'live' });
    expect(card.body).toContain("they won't answer for you");
    expect(card.body).toContain('disagree with each other');
    expect(card.body).toContain('deliberately paced');
    expect(card.body).toContain('whisper');
    expect(card.body).toContain('last word');
  });

  it('names the two agents who are in the room, and never the tutee', () => {
    const card = roundCardFor({ pack: PACK, roster, mode: 'live' });
    expect(card.body).toContain('Ellie and Max');
    expect(card.body).not.toContain('Theo');
  });

  it('is the scripted card in scripted mode, where the fixed pack is the session', () => {
    const card = roundCardFor({ pack: PSD_HESSIAN_CONVEXITY_V1, roster, mode: 'scripted' });
    expect(card).toEqual(SCRIPT_ROUND_CARD);
  });

  it('does not end the sentence twice when the pack title already has a full stop', () => {
    const card = roundCardFor({ pack: { ...PACK, title: 'Bayes, in one line.' }, roster, mode: 'live' });
    expect(card.body).toContain('Your slide: Bayes, in one line.');
    expect(card.body).not.toContain('line..');
  });

  it('says something usable even with an empty title or an empty roster', () => {
    const card = roundCardFor({ pack: { ...PACK, title: '   ' }, roster: [], mode: 'live' });
    expect(card.body).toContain('Your slide: your slide.');
    expect(card.body).toContain('the group');
  });
});

describe('roomMates and titlePhrase', () => {
  it('lists one, two or three names the way a person would', () => {
    expect(roomMates([])).toBe('the group');
    expect(roomMates(roster.filter((a) => a.role === 'peer'))).toBe('Ellie');
    expect(roomMates(roster)).toBe('Ellie and Max');
  });

  it('trims trailing punctuation and whitespace off a title', () => {
    expect(titlePhrase('  Convexity.  ')).toBe('Convexity');
    expect(titlePhrase('Convexity')).toBe('Convexity');
  });
});

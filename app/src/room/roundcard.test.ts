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
    expect(card.title).toBe('Explain');
  });

  it('keeps the pacing disclosure, which is the one line that may never be dropped', () => {
    // flow-build-plan.md §4.5: undisclosed pacing is performative deliberation. When the card
    // itself is replaced by the first-open strip, this sentence moves with it.
    const card = roundCardFor({ pack: PACK, roster, mode: 'live' });
    expect(card.body).toContain('tests you on what has been covered');
    expect(card.body).toContain('deliberately paced');
    expect(card.body).toContain('privately');
    expect(card.body).toContain('last word');
  });

  it('names the Teacher and the Tester, and never a cast or a group', () => {
    const card = roundCardFor({ pack: PACK, roster, mode: 'live' });
    expect(card.body).toContain('Ellie teaches from it');
    expect(card.body).toContain('Max tests you');
    expect(card.body).not.toContain('Theo');
    // The social-group framing is gone (#32): no room, no group, no cast introduction.
    expect(card.body).not.toMatch(/the group|the room|study group/i);
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
    expect(card.body).toContain('Ellie teaches from it');
  });
});

describe('roomMates and titlePhrase', () => {
  it('lists one or two names the way a person would', () => {
    expect(roomMates([])).toBe('the group');
    expect(roomMates(roster.filter((a) => a.role === 'peer'))).toBe('Ellie');
    expect(roomMates(roster)).toBe('Ellie and Max');
  });

  it('trims trailing punctuation and whitespace off a title', () => {
    expect(titlePhrase('  Convexity.  ')).toBe('Convexity');
    expect(titlePhrase('Convexity')).toBe('Convexity');
  });
});

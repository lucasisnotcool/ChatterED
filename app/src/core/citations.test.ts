import { describe, expect, it } from 'vitest';
import {
  CITATION_MIN_SHARED,
  CITATION_MIN_SHARE,
  CITATION_MIN_WORDS,
  CITATION_SHARED_CAP,
  citationFaults,
  citationSentences,
  dropCitations,
  sharedNeeded,
} from './citations.js';

/** Two slides of a deck, in its own words. */
const DECK: Record<number, string> = {
  38: 'Persona & tone. Confirmations. Repair — recovering from a misunderstanding, the make-or-break moment for trust in the system.',
  42: 'Designing for Breakdown: Repair Strategies. Ignore it: top response. Admit it: repeat, confirm. System repair: options, defer. Explain it: highlight keywords, OOV. Users prefer Options: actionable, low effort.',
};
const page = (p: number) => DECK[p] ?? null;

describe('citationSentences', () => {
  it('keeps "p. 42" inside its sentence', () => {
    expect(citationSentences('Repair is make-or-break (p. 38). Users prefer Options on p. 42.')).toEqual([
      'Repair is make-or-break (p. 38).',
      'Users prefer Options on p. 42.',
    ]);
  });
});

describe('citationFaults', () => {
  it('passes a page that says what the sentence says', () => {
    expect(citationFaults('Repair is the make-or-break moment for trust in the system (p. 38).', page)).toEqual([]);
    expect(citationFaults('Users prefer Options because they are actionable and low effort, p. 42 says.', page)).toEqual([]);
  });

  it('faults a page about something else', () => {
    const faults = citationFaults('The reason comes from p. 42, where repair is the make-or-break moment for trust.', page);
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({ pages: [42], ref: 'p. 42' });
    expect(faults[0]!.shared).toBeLessThan(sharedNeeded(6));
  });

  it('faults a page the deck does not have, and passes a range when one of its pages supports it', () => {
    expect(citationFaults('Slide repair is the make-or-break moment for trust, as p. 60 shows.', page)).toHaveLength(1);
    expect(citationFaults('Repair is the make-or-break moment for trust in the system (pp. 37–38).', page)).toEqual([]);
  });

  it('does not judge a sentence too short to compare', () => {
    expect(citationFaults('See p. 42.', page)).toEqual([]);
  });

  it('needs at least two shared words, a fifth of the sentence, and never more than four', () => {
    expect(CITATION_MIN_WORDS).toBe(4);
    expect(sharedNeeded(4)).toBe(CITATION_MIN_SHARED);
    expect(sharedNeeded(15)).toBe(Math.ceil(15 * CITATION_MIN_SHARE));
    expect(sharedNeeded(40)).toBe(CITATION_SHARED_CAP);
  });
});

describe('dropCitations', () => {
  it('takes out the faulted reference and keeps the sentence', () => {
    const text = 'Good question. The reason comes from p. 42, where repair is the make-or-break moment for trust. Users prefer Options (p. 42).';
    const out = dropCitations(text, citationFaults(text, page));
    expect(out).toContain('The reason comes from the slides, where repair is the make-or-break moment for trust.');
    expect(out).toContain('Users prefer Options (p. 42).');
  });

  it('drops a parenthesised reference whole and turns a possessive into the slides’', () => {
    const faults = citationFaults('Repair is the make-or-break moment for trust (p. 42). And p. 42’s point is that repair is make-or-break for trust.', page);
    const out = dropCitations('Repair is the make-or-break moment for trust (p. 42). And p. 42’s point is that repair is make-or-break for trust.', faults);
    expect(out).toBe('Repair is the make-or-break moment for trust. And the slides’ point is that repair is make-or-break for trust.');
  });
});

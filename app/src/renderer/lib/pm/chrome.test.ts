import { describe, expect, it } from 'vitest';
import { AGENT_NAME, provenanceLabel, qStatusLabel } from './chrome.js';

describe('provenanceLabel', () => {
  it('names one page', () => {
    expect(provenanceLabel([12], null)).toBe('p. 12');
  });

  it('collapses a run into a range, as the brief writes it', () => {
    expect(provenanceLabel([12, 13], null)).toBe('p. 12–13');
    expect(provenanceLabel([1, 2, 3], null)).toBe('p. 1–3');
  });

  it('keeps disjoint pages apart', () => {
    expect(provenanceLabel([12, 14], null)).toBe('p. 12, 14');
    expect(provenanceLabel([1, 2, 3, 7, 9, 10], null)).toBe('p. 1–3, 7, 9–10');
  });

  it('sorts and de-duplicates whatever the ingest wrote', () => {
    expect(provenanceLabel([13, 12, 12], null)).toBe('p. 12–13');
  });

  it('falls back to the reason when there is no page', () => {
    expect(provenanceLabel([], 'bridges p. 12 and p. 13')).toBe('added: bridges p. 12 and p. 13');
  });

  it('prefers the pages when a block has both — a page is checkable, a reason is not', () => {
    expect(provenanceLabel([12], 'bridges two slides')).toBe('p. 12');
  });

  it('says so, on the page, when a block has neither', () => {
    expect(provenanceLabel([], null)).toBe('no source');
    expect(provenanceLabel([], '   ')).toBe('no source');
  });

  it('ignores a page number that is not a page', () => {
    expect(provenanceLabel([0, -3, 1.5, 4], null)).toBe('p. 4');
  });
});

describe('qStatusLabel', () => {
  it('is open while the question waits', () => {
    expect(qStatusLabel('open', null)).toBe('open');
  });

  it('spells out each of the three resolutions in the learner register', () => {
    expect(qStatusLabel('resolved', 'you_got_this')).toBe('you got this');
    expect(qStatusLabel('resolved', 'partly_yours')).toBe('partly yours');
    expect(qStatusLabel('resolved', 'released')).toBe('released');
  });

  it('degrades rather than showing an empty tag', () => {
    expect(qStatusLabel('resolved', null)).toBe('resolved');
  });
});

describe('AGENT_NAME', () => {
  it('pairs every colour with a name, which is the colour-blind rule', () => {
    expect(AGENT_NAME.ellie).toBe('Ellie');
    expect(AGENT_NAME.max).toBe('Max');
  });
});

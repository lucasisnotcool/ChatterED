import { describe, expect, it } from 'vitest';
import { docTextGate, docTextHash } from './doctext.js';

const CLAIM = 'A matrix is positive semidefinite when every eigenvalue is at least zero.';

describe('docTextGate', () => {
  it('assesses a sentence long enough to carry a claim, in a block that maps to an objective', () => {
    const out = docTextGate({ text: CLAIM, objectiveId: 'obj_1' });
    expect(out).toMatchObject({ assessed: true, reason: null, objectiveId: 'obj_1' });
    expect(out.verbatim).toBe(CLAIM);
  });

  it('refuses anything under the ledger’s eight-word floor', () => {
    expect(docTextGate({ text: 'It is convex.', objectiveId: 'obj_1' }).reason).toBe('too_short');
  });

  it('refuses agreement, however long, because agreement is not a claim', () => {
    // The ledger's rule 4, imported rather than restated: the doc text becomes a learner message
    // and is scored by exactly the rules a chat message is.
    expect(
      docTextGate({ text: 'yes, that makes sense to me, I agree with all of it', objectiveId: 'obj_1' }).reason,
    ).toBe('too_short');
  });

  it('waits for a sentence: enough words, no terminator, not long enough to be one without', () => {
    expect(
      docTextGate({ text: 'the Hessian is positive semidefinite on the whole domain', objectiveId: 'obj_1' })
        .reason,
    ).toBe('no_sentence');
  });

  it('accepts an unpunctuated span once it is long enough to be a paragraph', () => {
    const long =
      'the Hessian is positive semidefinite on the whole domain which is what makes the ' +
      'function convex there and lets the second order test decide it';
    expect(docTextGate({ text: long, objectiveId: 'obj_1' }).assessed).toBe(true);
  });

  it('accepts a sentence that ends mid-paragraph', () => {
    expect(docTextGate({ text: `${CLAIM} I think that is the key point`, objectiveId: 'obj_1' }).assessed).toBe(true);
  });

  it('refuses a block whose pages no single objective claims', () => {
    expect(docTextGate({ text: CLAIM, objectiveId: null }).reason).toBe('no_objective');
  });

  it('refuses text byte-identical to what was last assessed for the block', () => {
    const first = docTextGate({ text: CLAIM, objectiveId: 'obj_1' });
    expect(docTextGate({ text: CLAIM, objectiveId: 'obj_1', lastHash: first.hash }).reason).toBe('unchanged');
  });

  it('treats a whitespace-only edit as unchanged, and a real edit as new', () => {
    const first = docTextGate({ text: CLAIM, objectiveId: 'obj_1' });
    expect(docTextGate({ text: `  ${CLAIM}\n`, objectiveId: 'obj_1', lastHash: first.hash }).reason).toBe('unchanged');
    expect(
      docTextGate({ text: `${CLAIM} And it is symmetric.`, objectiveId: 'obj_1', lastHash: first.hash }).assessed,
    ).toBe(true);
  });

  it('refuses while the previous pause on this block is still being marked', () => {
    expect(docTextGate({ text: CLAIM, objectiveId: 'obj_1', inFlight: true }).reason).toBe('in_flight');
  });

  it('reports the most specific refusal when several apply', () => {
    // Too short *and* in flight: the learner is better served by "there is nothing here yet".
    expect(docTextGate({ text: 'ok', objectiveId: null, inFlight: true }).reason).toBe('too_short');
  });

  it('hashes on the normalised text so the dedupe survives re-indentation', () => {
    expect(docTextHash(CLAIM)).toBe(docTextHash(`\n  ${CLAIM.toUpperCase()}  `));
    expect(docTextHash(CLAIM)).not.toBe(docTextHash(`${CLAIM} And it is symmetric.`));
  });
});

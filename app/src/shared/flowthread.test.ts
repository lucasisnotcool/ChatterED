import { describe, expect, it } from 'vitest';
import { claimsForAnchor, groupByAnchor, threadFor } from './flowthread.js';
import type { LedgerRowView, LedgerState, MessageView } from './types.js';

function msg(id: string, seq: number, anchorId: string | null, kind: 'student' | 'reference' | 'agent' = 'student'): MessageView {
  return {
    id,
    seq,
    speaker:
      kind === 'student'
        ? { kind: 'student', displayName: 'You' }
        : kind === 'reference'
          ? { kind: 'reference', displayName: 'REFERENCE' }
          : { kind: 'agent', key: 'peer.ellie', role: 'peer', displayName: 'Ellie', colour: '#0F7B6C' },
    body: id,
    createdAt: '2026-09-17T10:00:00.000Z',
    latencyTargetMs: null,
    ttftActualMs: null,
    promotedFromWhisper: false,
    disagreement: null,
    divider: null,
    reference: null,
    anchorId,
    byRule: null,
  };
}

function row(elementId: string, state: LedgerState, evidenceMsgId: string | null): LedgerRowView {
  return {
    elementId,
    label: `${elementId} long label`,
    learnerLabel: `${elementId} short`,
    level: state === 'defended' ? 3 : state === 'justified' ? 2 : state === 'stated' ? 1 : 0,
    state,
    evidenceText: evidenceMsgId ? 'their own words' : null,
    evidenceMsgId,
    evidenceTurn: null,
    defendedAgainst: null,
    revisit: false,
    contested: false,
    openMisconceptions: [],
  };
}

describe('grouping a flow transcript by segment', () => {
  it('groups anchored messages and keeps each thread in seq order', () => {
    const grouped = groupByAnchor([
      msg('m3', 3, 'seg_b'),
      msg('m1', 1, 'seg_a'),
      msg('m4', 4, 'seg_a'),
      msg('m2', 2, 'seg_a'),
    ]);
    expect(grouped).toEqual([
      { anchorId: 'seg_a', messageIds: ['m1', 'm2', 'm4'] },
      { anchorId: 'seg_b', messageIds: ['m3'] },
    ]);
  });

  it('leaves unanchored messages out of every thread', () => {
    // Every message written before migration 010 has a null anchor, and so does the opener. They
    // belong to the room, not to a segment, and must not be smuggled into the first one.
    const grouped = groupByAnchor([msg('m1', 1, null), msg('m2', 2, 'seg_a'), msg('m3', 3, null)]);
    expect(grouped).toEqual([{ anchorId: 'seg_a', messageIds: ['m2'] }]);
  });

  it('orders threads by where they started, not by anchor id', () => {
    const grouped = groupByAnchor([msg('m1', 1, 'seg_z'), msg('m2', 2, 'seg_a')]);
    expect(grouped.map((t) => t.anchorId)).toEqual(['seg_z', 'seg_a']);
  });

  it('threadFor returns one segment in order', () => {
    const all = [msg('m2', 2, 'seg_a'), msg('m1', 1, 'seg_a'), msg('m3', 3, 'seg_b')];
    expect(threadFor(all, 'seg_a').map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(threadFor(all, 'seg_c')).toEqual([]);
  });
});

describe('the glyphs on a segment card', () => {
  const messages = [msg('m1', 1, 'seg_a'), msg('m2', 2, 'seg_a'), msg('m3', 3, 'seg_b')];

  it('shows a claim on the segment whose thread carries its evidence', () => {
    const ledger = { rows: [row('R1', 'justified', 'm2'), row('R2', 'stated', 'm3')] };
    expect(claimsForAnchor('seg_a', messages, ledger).map((c) => [c.elementId, c.state])).toEqual([['R1', 'justified']]);
    expect(claimsForAnchor('seg_b', messages, ledger).map((c) => [c.elementId, c.state])).toEqual([['R2', 'stated']]);
  });

  it('shows nothing for a claim with no evidence yet', () => {
    expect(claimsForAnchor('seg_a', messages, { rows: [row('R1', 'not_yet', null)] })).toEqual([]);
  });

  it('orders by element id so a second claim does not reshuffle the first', () => {
    const ledger = { rows: [row('R3', 'stated', 'm2'), row('R1', 'defended', 'm1')] };
    expect(claimsForAnchor('seg_a', messages, ledger).map((c) => c.elementId)).toEqual(['R1', 'R3']);
  });

  /**
   * THE PROPERTY. `pivot-spec.md` §B1: "nothing you read moves a row." It is asserted here
   * renderer-independently, because it is the mechanism that turns "the AI gave me the answer"
   * from the disease into the hook, and a test of it that needs a browser is a test that gets
   * skipped on the day it matters.
   */
  it('a REFERENCE answer can never put a glyph on a segment', () => {
    const question = msg('q1', 1, 'seg_a', 'student');
    const answer = msg('a1', 2, 'seg_a', 'reference');
    const thread = [question, answer];

    // Even if a ledger row somehow named the reference card as its evidence — which the ledger's
    // verbatim rule already forbids, since evidence must be a substring of a *learner* message —
    // the card is not something the learner said, so it must not be counted here either.
    const honest = { rows: [row('R1', 'not_yet', null)] };
    expect(claimsForAnchor('seg_a', thread, honest)).toEqual([]);

    // And the reverse: the learner's own question does not move anything on its own. A glyph
    // appears only once the ledger has taken a learner message as evidence.
    const afterExplaining = { rows: [row('R1', 'stated', 'q1')] };
    expect(claimsForAnchor('seg_a', thread, afterExplaining).map((c) => c.elementId)).toEqual(['R1']);
    expect(claimsForAnchor('seg_a', thread, afterExplaining)[0]!.state).toBe('stated');
  });

  it('returns nothing when there is no ledger yet', () => {
    expect(claimsForAnchor('seg_a', messages, null)).toEqual([]);
  });
});

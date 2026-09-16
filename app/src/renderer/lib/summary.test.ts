import { describe, expect, it } from 'vitest';
import {
  SUMMARY_WORD_CAP,
  canSummarise,
  conversationFor,
  conversationLabel,
  isArtefact,
  offersSummary,
  sourceThreadOf,
  splitThread,
} from './summary.js';
import type { MessageView } from '../../shared/types.js';

type Kinded = MessageView & { kind?: string; sourceThreadId?: string | null };

function msg(partial: Partial<Kinded> & { id: string; seq: number }): Kinded {
  return {
    speaker: { kind: 'student', displayName: 'You' },
    body: 'words',
    createdAt: '2026-09-16T10:00:00.000Z',
    latencyTargetMs: null,
    ttftActualMs: null,
    promotedFromWhisper: false,
    disagreement: null,
    divider: null,
    reference: null,
    anchorId: 'seg-1',
    byRule: null,
    kind: 'turn',
    sourceThreadId: null,
    ...partial,
  } as Kinded;
}

const ellie = {
  kind: 'agent',
  key: 'ellie',
  role: 'peer',
  displayName: 'Ellie',
  colour: '#4b56d2',
} as const;

describe('which card is the artefact', () => {
  it('counts a summary and a legacy answer, and nothing else', () => {
    expect(isArtefact(msg({ id: 'a', seq: 1, kind: 'summary' }))).toBe(true);
    expect(isArtefact(msg({ id: 'b', seq: 2, kind: 'answer' }))).toBe(true);
    expect(isArtefact(msg({ id: 'c', seq: 3, kind: 'turn' }))).toBe(false);
  });

  it('reads a card from a build with no kind on it as a turn', () => {
    // The shapes land before the main side fills them; nothing may render as an artefact by
    // accident on a build whose messages predate `MessageKind`.
    const older = msg({ id: 'd', seq: 4 });
    delete (older as { kind?: string }).kind;
    expect(isArtefact(older)).toBe(false);
  });

  it('falls back to a legacy card’s own anchor for its source thread', () => {
    expect(sourceThreadOf(msg({ id: 'e', seq: 5, kind: 'answer', sourceThreadId: null }))).toBe('seg-1');
    expect(sourceThreadOf(msg({ id: 'f', seq: 6, kind: 'summary', sourceThreadId: 'seg-9' }))).toBe('seg-9');
  });
});

describe('splitting a thread into its conversation and its artefact', () => {
  const messages = [
    msg({ id: 'm1', seq: 1 }),
    msg({ id: 'm2', seq: 2, speaker: ellie, body: 'MDPs come out of a gap' }),
    msg({ id: 's1', seq: 3, kind: 'summary', sourceThreadId: 'seg-1', body: 'An MDP is…' }),
  ];

  it('keeps the turns in order and lifts the artefact out of them', () => {
    const split = splitThread('seg-1', messages);
    expect(split.turns.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(split.artefact?.id).toBe('s1');
  });

  it('has no artefact on a thread that has never been summarised', () => {
    expect(splitThread('seg-1', messages.slice(0, 2)).artefact).toBeNull();
  });

  it('shows the newest when two somehow exist, never a stale one under a fresh one', () => {
    const two = [...messages, msg({ id: 's2', seq: 9, kind: 'summary', sourceThreadId: 'seg-1' })];
    expect(splitThread('seg-1', two).artefact?.id).toBe('s2');
  });

  it('ignores an artefact written from another thread', () => {
    const foreign = msg({ id: 'x', seq: 4, kind: 'summary', sourceThreadId: 'deck', anchorId: 'deck' });
    expect(splitThread('seg-1', [...messages.slice(0, 2), foreign]).artefact).toBeNull();
  });
});

describe('when the action is offered', () => {
  it('needs something taught, not just something asked', () => {
    expect(canSummarise([msg({ id: 'm1', seq: 1 })])).toBe(false);
    expect(canSummarise([msg({ id: 'm1', seq: 1 }), msg({ id: 'm2', seq: 2, speaker: ellie })])).toBe(true);
  });

  it('does not count the offer itself as the thing worth summarising', () => {
    const offer = msg({ id: 'o', seq: 2, speaker: ellie, byRule: 'offer_summary' });
    expect(canSummarise([msg({ id: 'm1', seq: 1 }), offer])).toBe(false);
    expect(offersSummary(offer)).toBe(true);
    expect(offersSummary(msg({ id: 'h', seq: 3, speaker: ellie, byRule: 'handoff' }))).toBe(false);
  });
});

describe('the conversation behind an artefact', () => {
  const messages = [
    msg({ id: 'm1', seq: 1 }),
    msg({ id: 'm2', seq: 2, speaker: ellie }),
    msg({ id: 's1', seq: 3, kind: 'summary', sourceThreadId: 'seg-1' }),
    msg({ id: 'other', seq: 4, anchorId: 'seg-2' }),
  ];

  it('uses the ids flow:threadOf returned, and never puts the artefact inside itself', () => {
    expect(conversationFor('seg-1', messages, ['m1', 'm2', 's1']).map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('falls back to the local grouping when the channel is not on this build', () => {
    expect(conversationFor('seg-1', messages, null).map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('drops an id whose message this renderer has not got', () => {
    expect(conversationFor('seg-1', messages, ['m1', 'gone']).map((m) => m.id)).toEqual(['m1']);
  });

  it('labels the disclosure with the turn count, and not when it is open', () => {
    expect(conversationLabel(false, 6)).toBe('Show the conversation · 6 turns');
    expect(conversationLabel(false, 0)).toBe('Show the conversation');
    expect(conversationLabel(true, 6)).toBe('Hide the conversation');
  });
});

describe('the cap', () => {
  it('is the number the card is allowed to say out loud', () => {
    expect(SUMMARY_WORD_CAP).toBe(150);
  });
});

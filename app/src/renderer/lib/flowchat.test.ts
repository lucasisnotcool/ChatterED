import { describe, expect, it } from 'vitest';
import {
  RECEIVED_MAX_MS,
  TAIL_SLACK_PX,
  ackIndex,
  announce,
  appendDelta,
  elapsedMs,
  etaTitle,
  indicatorMode,
  metaAlwaysOn,
  metaParts,
  nextSendId,
  pendingFor,
  pillLabel,
  receivedVisible,
  scrollDecision,
  stopAllowed,
  thinkingAnchor,
  wordCount,
  type PendingSend,
} from './flowchat.js';
import type { MessageView, ThinkingView } from '../../shared/types.js';

const T0 = Date.parse('2026-09-16T10:00:00.000Z');

function pending(partial: Partial<PendingSend> & { id: string }): PendingSend {
  return { anchorId: 'seg-1', body: 'because entropy', state: 'pending', at: T0, error: null, ...partial };
}

function student(partial: Partial<MessageView> = {}): MessageView {
  return {
    id: 'm1',
    seq: 4,
    speaker: { kind: 'student', displayName: 'You' },
    body: 'because entropy',
    createdAt: new Date(T0).toISOString(),
    latencyTargetMs: null,
    ttftActualMs: null,
    promotedFromWhisper: false,
    disagreement: null,
    divider: null,
    reference: null,
    anchorId: 'seg-1',
    byRule: null,
    ...partial,
  };
}

function thinking(partial: Partial<ThinkingView> = {}): ThinkingView {
  return {
    agentKey: 'tester',
    displayName: 'Max',
    role: 'challenger',
    colour: '#b45309',
    verb: 'reading',
    startedAt: new Date(T0).toISOString(),
    etaMs: 10_000,
    showCounter: true,
    ...partial,
  };
}

describe('the pending send (audit Fact 1)', () => {
  it('gives every send its own id', () => {
    expect(nextSendId()).not.toEqual(nextSendId());
  });

  it('acknowledges the echo of the same text under the same anchor', () => {
    const queue = [pending({ id: 'a', body: 'first' }), pending({ id: 'b', body: 'because entropy' })];
    expect(ackIndex(queue, student())).toBe(1);
  });

  it('never acknowledges a send in another thread', () => {
    const queue = [pending({ id: 'a' })];
    expect(ackIndex(queue, student({ anchorId: 'seg-9' }))).toBe(-1);
  });

  it('ignores an agent turn and a room-level message', () => {
    const agentTurn = student({
      speaker: { kind: 'agent', key: 'teacher', role: 'peer', displayName: 'Ellie', colour: '#5b50e8' },
    });
    expect(ackIndex([pending({ id: 'a' })], agentTurn)).toBe(-1);
    expect(ackIndex([pending({ id: 'a', anchorId: '' })], student({ anchorId: null }))).toBe(0);
  });

  it('does not silently un-fail a send the learner was already told about', () => {
    const queue = [pending({ id: 'a', state: 'failed' })];
    expect(ackIndex(queue, student())).toBe(-1);
  });

  it('matches on trimmed text, because the composer trims before sending', () => {
    expect(ackIndex([pending({ id: 'a', body: '  because entropy\n' })], student())).toBe(0);
  });

  it('scopes the queue to one thread', () => {
    const queue = [pending({ id: 'a' }), pending({ id: 'b', anchorId: 'seg-2' })];
    expect(pendingFor(queue, 'seg-1').map((p) => p.id)).toEqual(['a']);
  });
});

describe('where the wait is drawn (audit Fact 2)', () => {
  it('prefers the turn ’s own anchor over anything local', () => {
    const view = { ...thinking(), anchorId: 'seg-7' };
    expect(thinkingAnchor(view, 'seg-1', 'seg-2')).toBe('seg-7');
  });

  it('falls back to the anchor the learner last sent to, then to the open composer', () => {
    expect(thinkingAnchor(thinking(), 'seg-1', 'seg-2')).toBe('seg-1');
    expect(thinkingAnchor(thinking(), null, 'seg-2')).toBe('seg-2');
    expect(thinkingAnchor(thinking(), null, null)).toBeNull();
  });

  it('draws nothing when no turn is held', () => {
    expect(thinkingAnchor(null, 'seg-1', 'seg-2')).toBeNull();
  });
});

describe('the indicator (Lucas, 2026-09-16)', () => {
  it('is plain dots for the Teacher, always', () => {
    const ellie = thinking({ showCounter: false, displayName: 'Ellie', role: 'peer' });
    expect(indicatorMode(ellie, T0 + 30_000)).toBe('dots');
  });

  it('is dots for the Tester’s first three seconds, then the elapsed counter', () => {
    expect(indicatorMode(thinking(), T0 + 2_900)).toBe('dots');
    expect(indicatorMode(thinking(), T0 + 3_000)).toBe('counter');
  });

  it('measures elapsed from the turn’s start, never from the event', () => {
    expect(elapsedMs(thinking(), T0 + 9_400)).toBe(9_400);
    expect(elapsedMs(thinking(), T0 - 5_000)).toBe(0);
  });

  it('puts the ETA in a sentence for the tooltip and never on screen', () => {
    expect(etaTitle(thinking(), T0 + 4_000)).toBe('Max usually takes about 6s more');
    expect(etaTitle(thinking(), T0 + 14_000)).toBe('Max is past the usual wait');
  });
});

describe('Stop, only after the floor (Lucas, 2026-09-16)', () => {
  it('is refused while the deliberate wait is still running', () => {
    expect(stopAllowed(thinking(), T0 + 9_999)).toBe(false);
  });

  it('is offered the moment the wait is genuinely over', () => {
    expect(stopAllowed(thinking(), T0 + 10_000)).toBe(true);
  });

  it('is nothing at all when no turn is held', () => {
    expect(stopAllowed(null, T0 + 60_000)).toBe(false);
  });
});

describe('the received line (audit §2a)', () => {
  it('shows from the ack until agent chrome arrives', () => {
    expect(receivedVisible(T0, false, T0 + 3_000)).toBe(true);
    expect(receivedVisible(T0, true, T0 + 3_000)).toBe(false);
  });

  it('never outlives a turn that died without a thinking event', () => {
    expect(receivedVisible(T0, false, T0 + RECEIVED_MAX_MS)).toBe(false);
  });

  it('is nothing before anything has been sent', () => {
    expect(receivedVisible(null, false, T0)).toBe(false);
  });
});

describe('the live region (WCAG 4.1.3)', () => {
  it('says one sentence per event, never the body', () => {
    expect(announce('received', { label: 'Side channels' })).toBe(
      'Your message was received under “Side channels”.',
    );
    expect(announce('replied', { name: 'Ellie', label: 'Side channels', words: 42 })).toBe(
      'Ellie replied under “Side channels”, 42 words.',
    );
    expect(announce('failed', { name: 'Max', reason: 'the backend timed out' })).toBe(
      'Max failed: the backend timed out.',
    );
  });

  it('counts words the way a reader would', () => {
    expect(wordCount('  two  words \n')).toBe(2);
    expect(wordCount('   ')).toBe(0);
  });
});

describe('the provenance foot (audit §6)', () => {
  it('names the timing, the model and the backend', () => {
    const m = { ...student(), ttftActualMs: 9_400, model: 'haiku-4-5', backend: 'claude_cli' };
    expect(metaParts(m)).toEqual(['9.4s', 'haiku-4-5', 'claude_cli']);
  });

  it('leaves out what is not known, rather than printing a gap', () => {
    expect(metaParts(student())).toEqual([]);
  });

  it('adds the total only when it differs from the first token', () => {
    const same = { ...student(), ttftActualMs: 4_000, totalMs: 4_000 };
    expect(metaParts(same)).toEqual(['4.0s']);
    const differs = { ...student(), ttftActualMs: 4_000, totalMs: 11_500 };
    expect(metaParts(differs)).toEqual(['4.0s', '11.5s total']);
  });

  it('shows the scripted backend unconditionally, because it is a claim about a model that never ran', () => {
    expect(metaAlwaysOn('scripted')).toBe(true);
    expect(metaAlwaysOn('claude_cli')).toBe(false);
    expect(metaAlwaysOn(null)).toBe(false);
  });
});

describe('scroll and the pill (audit §5)', () => {
  it('always follows a reply into the thread the learner is writing in', () => {
    expect(scrollDecision({ anchorOffset: 9_000, viewportHeight: 800, atAnchor: true })).toBe('into-view');
  });

  it('follows one that is on screen or just under the fold', () => {
    expect(scrollDecision({ anchorOffset: 700, viewportHeight: 800, atAnchor: false })).toBe('into-view');
    expect(scrollDecision({ anchorOffset: 800 + TAIL_SLACK_PX, viewportHeight: 800, atAnchor: false })).toBe('into-view');
  });

  it('docks a pill for one that landed several screens away', () => {
    expect(scrollDecision({ anchorOffset: 4_000, viewportHeight: 800, atAnchor: false })).toBe('pill');
    expect(scrollDecision({ anchorOffset: -4_000, viewportHeight: 800, atAnchor: false })).toBe('pill');
    expect(scrollDecision({ anchorOffset: null, viewportHeight: 800, atAnchor: false })).toBe('pill');
  });

  it('says which way to go and where', () => {
    expect(pillLabel({ name: 'Ellie', page: 6, below: true })).toBe('↓ Ellie replied · p.6');
    expect(pillLabel({ name: 'Max', page: null, below: false })).toBe('↑ Max replied');
  });
});

describe('the incremental render (audit §2, P1)', () => {
  it('appends into the same turn', () => {
    let s = appendDelta(null, { turnId: 't1', anchorId: 'seg-1', agentKey: 'teacher', text: 'So ' });
    s = appendDelta(s, { turnId: 't1', text: 'far' });
    expect(s.text).toBe('So far');
    expect(s.released).toBe(false);
    expect(s.anchorId).toBe('seg-1');
  });

  it('starts over when a different turn begins, so two turns can never share a buffer', () => {
    const first = appendDelta(null, { turnId: 't1', text: 'a' });
    const second = appendDelta(first, { turnId: 't2', anchorId: 'seg-2', text: 'b' });
    expect(second.text).toBe('b');
    expect(second.turnId).toBe('t2');
  });
});

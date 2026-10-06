import { describe, expect, it } from 'vitest';
import { openTestDb } from '../../../test-support/db.js';
import { activityRepo, activitySince } from './activity.js';
import type { ObjectiveActivity, QuizOutcome } from '../../../shared/doc/types.js';

function press(over: Partial<ObjectiveActivity> = {}): ObjectiveActivity {
  return {
    id: 'oa_1',
    contentSha: 'sha-a',
    roomId: 'room_a',
    objectiveId: 'obj_1',
    kind: 'explain',
    blockId: 'b_1',
    createdAt: '2026-10-06T10:00:00.000Z',
    ...over,
  };
}

function closed(createdAt: string): QuizOutcome {
  return {
    id: `qo_${createdAt}`,
    contentSha: 'sha-a',
    roomId: 'room_a',
    objectiveId: 'obj_1',
    questionId: 'q_1',
    kind: 'released',
    verdict: null,
    releasedBy: 'give_up',
    messageId: null,
    source: 'chat',
    attemptIndex: null,
    ownWords: null,
    form: 'open',
    createdAt,
  };
}

describe('activityRepo', () => {
  it('round-trips a press, once per id', () => {
    const r = activityRepo(openTestDb().db);
    r.insert(press());
    r.insert(press());
    r.insert(press({ id: 'oa_2', kind: 'example', blockId: null, createdAt: '2026-10-06T10:05:00.000Z' }));
    expect(r.forContent('sha-a')).toEqual([
      press(),
      press({ id: 'oa_2', kind: 'example', blockId: null, createdAt: '2026-10-06T10:05:00.000Z' }),
    ]);
    expect(r.forContent('sha-other')).toEqual([]);
  });

  it('survives into a second room on the same bytes (New Conversation)', () => {
    const r = activityRepo(openTestDb().db);
    r.insert(press({ roomId: 'room_a' }));
    r.insert(press({ id: 'oa_2', roomId: 'room_b', createdAt: '2026-10-06T11:00:00.000Z' }));
    expect(r.forContent('sha-a').map((a) => a.roomId)).toEqual(['room_a', 'room_b']);
  });

  it('stores a question to Ellie (migration 031 widens the kind)', () => {
    const r = activityRepo(openTestDb().db);
    r.insert(press({ kind: 'question' }));
    expect(r.forContent('sha-a').map((a) => a.kind)).toEqual(['question']);
  });
});

describe('activitySince', () => {
  it('counts everything when no question has closed', () => {
    const view = activitySince([press(), press({ id: 'oa_2', kind: 'example' })], []);
    expect(view).toEqual({ explains: 1, examples: 1, questions: 0, since: null });
  });

  it('counts only presses after the newest outcome, so a release resets it', () => {
    const presses = [
      press({ id: 'a', createdAt: '2026-10-06T10:00:00.000Z' }),
      press({ id: 'b', createdAt: '2026-10-06T10:10:00.000Z' }),
      press({ id: 'c', kind: 'example', createdAt: '2026-10-06T10:20:00.000Z' }),
    ];
    const view = activitySince(presses, [closed('2026-10-06T10:05:00.000Z'), closed('2026-10-06T10:15:00.000Z')]);
    expect(view).toEqual({ explains: 0, examples: 1, questions: 0, since: '2026-10-06T10:15:00.000Z' });
  });

  // Decision 8 (6 Oct afternoon, #67): five questions to Ellie on one section counted nothing.
  it('counts questions to Ellie separately, reset by a closed question like the rest', () => {
    const rows = [
      press({ id: 'a', kind: 'question', createdAt: '2026-10-06T10:00:00.000Z' }),
      press({ id: 'b', kind: 'question', createdAt: '2026-10-06T10:20:00.000Z' }),
      press({ id: 'c', kind: 'question', createdAt: '2026-10-06T10:25:00.000Z' }),
    ];
    expect(activitySince(rows, [closed('2026-10-06T10:05:00.000Z')])).toEqual({
      explains: 0,
      examples: 0,
      questions: 2,
      since: '2026-10-06T10:05:00.000Z',
    });
  });
});

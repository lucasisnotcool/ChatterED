import { describe, expect, it } from 'vitest';
import { openTestDb } from '../../../test-support/db.js';
import { outcomesRepo } from './outcomes.js';
import type { QuizOutcome } from '../../../shared/doc/types.js';

const T0 = '2026-09-19T10:00:00.000Z';

function outcome(over: Partial<QuizOutcome> = {}): QuizOutcome {
  return {
    id: 'qo_1',
    contentSha: 'sha-a',
    roomId: 'room_a',
    objectiveId: 'obj_1',
    questionId: 'q_1',
    kind: 'verdict',
    verdict: 'complete',
    releasedBy: null,
    messageId: 'm_7',
    source: 'chat',
    attemptIndex: 1,
    ownWords: null,
    form: 'open',
    createdAt: T0,
    ...over,
  };
}

function repo() {
  return outcomesRepo(openTestDb().db);
}

describe('outcomesRepo', () => {
  it('round-trips a verdict', () => {
    const r = repo();
    r.insert(outcome());
    expect(r.forContent('sha-a')).toEqual([outcome()]);
  });

  it('round-trips a release, with its cause and no verdict', () => {
    const r = repo();
    const released = outcome({ id: 'qo_2', kind: 'released', verdict: null, releasedBy: 'pass' });
    r.insert(released);
    expect(r.forContent('sha-a')).toEqual([released]);
  });

  it('is idempotent on the id, so a retried write records one outcome', () => {
    const r = repo();
    r.insert(outcome());
    r.insert(outcome({ verdict: 'not_yet' }));
    const rows = r.forContent('sha-a');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.verdict).toBe('complete');
  });

  it('is keyed on the bytes, not the file or the room', () => {
    const r = repo();
    r.insert(outcome({ id: 'qo_1', roomId: 'room_a' }));
    // A second sitting on the same deck: a new room, the same content sha, the same progress.
    r.insert(outcome({ id: 'qo_2', roomId: 'room_b', verdict: 'partial', createdAt: '2026-09-20T09:00:00.000Z' }));

    expect(r.forContent('sha-a')).toHaveLength(2);
    expect(r.forRoom('room_b').map((o) => o.id)).toEqual(['qo_2']);
    expect(r.forContent('sha-other')).toEqual([]);
  });

  it('filters by objective, and finds the unattributed outcomes separately', () => {
    const r = repo();
    r.insert(outcome({ id: 'qo_1', objectiveId: 'obj_1' }));
    r.insert(outcome({ id: 'qo_2', objectiveId: 'obj_2' }));
    r.insert(outcome({ id: 'qo_3', objectiveId: null }));

    expect(r.forObjective('sha-a', 'obj_1').map((o) => o.id)).toEqual(['qo_1']);
    // `objective_id = NULL` never matches in SQL; the null case is its own statement.
    expect(r.forObjective('sha-a', null).map((o) => o.id)).toEqual(['qo_3']);
  });

  it('returns a content’s outcomes oldest first, and one question’s history', () => {
    const r = repo();
    r.insert(outcome({ id: 'qo_2', questionId: 'q_1', verdict: 'not_yet', createdAt: '2026-09-19T10:02:00.000Z' }));
    r.insert(outcome({ id: 'qo_1', questionId: 'q_1', verdict: 'partial', createdAt: T0 }));
    r.insert(outcome({ id: 'qo_3', questionId: 'q_2', createdAt: '2026-09-19T10:09:00.000Z' }));

    expect(r.forContent('sha-a').map((o) => o.id)).toEqual(['qo_1', 'qo_2', 'qo_3']);
    expect(r.forQuestion('sha-a', 'q_1').map((o) => o.id)).toEqual(['qo_1', 'qo_2']);
  });

  it('keeps the doc-text source on the row', () => {
    const r = repo();
    r.insert(outcome({ source: 'doc_text', messageId: 'm_doc' }));
    expect(r.forContent('sha-a')[0]!.source).toBe('doc_text');
  });

  /** Migration 023: the form is stored, and a row from before it reads as an open question. */
  it('round-trips a fill-in-the-blank, and reads a row with no form as open', () => {
    const db = openTestDb().db;
    const r = outcomesRepo(db);
    r.insert(outcome({ id: 'qo_c', form: 'cloze' }));
    expect(r.forContent('sha-a')[0]!.form).toBe('cloze');
    db.prepare("UPDATE quiz_outcomes SET form = NULL WHERE id = 'qo_c'").run({});
    expect(r.forContent('sha-a')[0]!.form).toBe('open');
  });
});

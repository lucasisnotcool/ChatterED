/**
 * **Migration 019, run as SQL against a real database** (issue #41,
 * `conversation-refinement.md` §6).
 *
 * The REFERENCE entry card is retired, and every vault that has been used has rows of them sitting
 * in the learner's documents. They are not deleted: they are the one kind of row in the app that
 * was already what `pivot-spec.md` §B1 was right about — a typeset, capped block in the document
 * rather than a turn — so they become summary cards, pointing at the thread they belong to.
 *
 * The file is read off disk and executed, rather than reimplemented here, so what is asserted is
 * the statement that will run on Lucas's machine and not a paraphrase of it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openTestDb, seedRoom } from '../../test-support/db.js';
import { HAND_BACK_LINE, RULE_LINE } from '../../room/reference.js';

const SQL = readFileSync(
  fileURLToPath(new URL('./migrations/019_reference_answers_become_summaries.sql', import.meta.url)),
  'utf8',
);

const ANSWER = 'A symmetric matrix H is positive semidefinite when zᵀHz ≥ 0 for every vector z.';
/** Exactly what `composeReferenceBody` wrote, rule and hand-back included. */
const OLD_BODY = `${ANSWER}\n\n${RULE_LINE}\n${HAND_BACK_LINE}`;

/**
 * A database as it stood before 018: a REFERENCE card in a thread, with a null `kind` because the
 * column did not exist when it was written. 018 has run (the columns are there); what has not run
 * is 019, so the row is rewound to the state it would be in.
 */
function seedPre019() {
  const { db, store } = openTestDb();
  const seeded = seedRoom(store);
  const reference = {
    id: 'p_ref',
    room_id: seeded.roomId,
    kind: 'agent' as const,
    user_id: null,
    // Null `agent_key` is how the schema says "not an agent" (`src/room/reference.ts`).
    agent_key: null,
    display_name: 'REFERENCE',
    joined_at: '2026-09-15T10:00:00.000Z',
    left_at: null,
  };
  store.participants.insert(reference);

  const insert = (id: string, seq: number, participantId: string, body: string, anchorId: string | null) => {
    store.messages.insert({
      id,
      room_id: seeded.roomId,
      participant_id: participantId,
      seq,
      body,
      turn_decision_id: null,
      model: null,
      backend: null,
      usage: null,
      latency_target_ms: null,
      ttft_actual_ms: null,
      released_at: null,
      promoted_from_whisper: null,
      divider_cause: null,
      disagreement: null,
      anchor_id: anchorId,
      objective_id: null,
      stopped: 0,
      total_ms: null,
      decided_by: null,
      scope_shown: 'p. 4 + outline',
      kind: 'turn',
      source_thread_id: null,
      created_at: '2026-09-15T10:00:01.000Z',
    });
  };

  insert('m_q', 1, seeded.studentParticipantId, 'what does PSD actually mean?', 'seg_3');
  insert('m_card', 2, 'p_ref', OLD_BODY, 'seg_3');
  insert('m_roomlevel', 3, 'p_ref', OLD_BODY, null);
  insert('m_turn', 4, seeded.peerParticipantId, `It is about the quadratic form. ${RULE_LINE} not a card.`, 'seg_3');
  // Rewind to the pre-018 state: the column exists, the rows predate it.
  db.exec("UPDATE messages SET kind = NULL WHERE id IN ('m_q','m_card','m_roomlevel','m_turn')");
  // `seeded` carries the same store; spread it first so the explicit one is not shadowed.
  return { ...seeded, db, store };
}

describe('019 — the REFERENCE answers become summary cards', () => {
  it('converts an anchored card and points it at its own thread', () => {
    const h = seedPre019();
    h.db.exec(SQL);

    const card = h.store.messages.get('m_card')!;
    expect(card.kind).toBe('summary');
    expect(card.source_thread_id).toBe('seg_3');
    expect(card.anchor_id).toBe('seg_3');
    // The answer survives whole; only the rule and the line under it are cut.
    expect(card.body).toBe(ANSWER);
    expect(card.body).not.toContain(HAND_BACK_LINE);
    expect(card.body).not.toContain(RULE_LINE);
    // What it was answered from is not rewritten: the footer still says it honestly.
    expect(card.scope_shown).toBe('p. 4 + outline');
  });

  it('leaves a room-level card with no thread rather than guessing one', () => {
    const h = seedPre019();
    h.db.exec(SQL);
    const card = h.store.messages.get('m_roomlevel')!;
    expect(card.kind).toBe('summary');
    expect(card.source_thread_id).toBeNull();
  });

  it('touches nothing that is not a REFERENCE row, even one that contains the rule glyph', () => {
    const h = seedPre019();
    h.db.exec(SQL);

    const learner = h.store.messages.get('m_q')!;
    expect(learner.kind).toBeNull();
    expect(learner.body).toBe('what does PSD actually mean?');

    const turn = h.store.messages.get('m_turn')!;
    expect(turn.kind).toBeNull();
    expect(turn.body).toContain(RULE_LINE);
    expect(turn.body).toContain('not a card.');
  });

  it('is idempotent: a card made on this build is already `summary` and is never re-cut', () => {
    const h = seedPre019();
    h.db.exec(SQL);
    const once = h.store.messages.get('m_card')!.body;

    // A *new* summary card, written by this build, whose body legitimately contains the glyph.
    h.store.messages.insert({
      ...h.store.messages.get('m_card')!,
      id: 'm_new',
      seq: 9,
      kind: 'summary',
      source_thread_id: 'seg_3',
      body: `Two things were settled ${RULE_LINE} and both are in the thread.`,
    });

    h.db.exec(SQL);
    expect(h.store.messages.get('m_card')!.body).toBe(once);
    expect(h.store.messages.get('m_new')!.body).toContain('and both are in the thread.');
  });
});

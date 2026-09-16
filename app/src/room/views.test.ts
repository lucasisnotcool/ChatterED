/**
 * `messageView()`'s speaker resolution, which has now been wrong in two different ways.
 *
 * The first was the REFERENCE participant — `kind = 'agent'` with a null `agent_key`, which is
 * how the schema says *not an agent* — coming out as `{ kind: 'student' }`, i.e. the machine's
 * answer wearing the learner's face (#25). The second is the one #32 creates: the role–name
 * pairing was drawn at install until it was pinned, so a room played before the pin holds
 * `peer.max` while today's roster holds `peer.ellie`, and a lookup by key alone finds nothing.
 * Falling through to `{ kind: 'student' }` again would put Max's words in the learner's mouth
 * *and* corrupt any later reading of the transcript.
 */
import { describe, expect, it } from 'vitest';
import type { MessageRow, ParticipantRow } from './records.js';
import { rosterFor } from './agents.js';
import { messageView } from './views.js';

const roster = rosterFor();

function participant(over: Partial<ParticipantRow> = {}): ParticipantRow {
  return {
    id: 'p_1',
    room_id: 'room_1',
    kind: 'agent',
    user_id: null,
    agent_key: 'peer.ellie',
    display_name: 'Ellie',
    joined_at: '2026-09-16T00:00:00.000Z',
    left_at: null,
    ...over,
  };
}

function message(over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'm_1',
    room_id: 'room_1',
    session_id: 's_1',
    participant_id: 'p_1',
    seq: 1,
    kind: 'group',
    body: 'Anything at all.',
    move_type: null,
    target_element_id: null,
    probe_type: null,
    latency_target_ms: null,
    ttft_actual_ms: null,
    model: null,
    backend: null,
    cost_usd: null,
    prompt_tokens: null,
    completion_tokens: null,
    cached_tokens: null,
    promoted_from_whisper: null,
    disagreement: null,
    divider_cause: null,
    anchor_id: null,
    created_at: '2026-09-16T00:00:01.000Z',
    ...over,
  } as MessageRow;
}

const viewOf = (p: ParticipantRow) => messageView(message(), new Map([[p.id, p]]), roster);

describe('who a message is from', () => {
  it('reads the live roster when the key is in it', () => {
    const v = viewOf(participant());
    expect(v.speaker).toMatchObject({ kind: 'agent', role: 'peer', displayName: 'Ellie' });
  });

  it('keeps a historical room under the names it was played on', () => {
    // A room from before the pin: the Teacher was Max, and the transcript still says so. The
    // point is that it is *not* rebranded to Ellie and *not* dropped to the learner.
    const v = viewOf(participant({ agent_key: 'peer.max', display_name: 'Max' }));
    expect(v.speaker).toMatchObject({ kind: 'agent', role: 'peer', displayName: 'Max' });
    expect(v.speaker.kind).not.toBe('student');
  });

  it('still calls the reference voice what it is, and the learner what she is', () => {
    expect(viewOf(participant({ agent_key: null, display_name: 'REFERENCE' })).speaker).toMatchObject({
      kind: 'reference',
    });
    expect(
      viewOf(participant({ kind: 'student', agent_key: null, user_id: 'u_1', display_name: 'You' })).speaker,
    ).toMatchObject({ kind: 'student', displayName: 'You' });
  });

  it('does not invent an agent for a key that is not role-shaped', () => {
    expect(viewOf(participant({ agent_key: 'nonsense', display_name: 'Nobody' })).speaker.kind).toBe('student');
  });
});

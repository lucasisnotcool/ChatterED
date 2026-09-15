/**
 * A room per document, created lazily (`flow-build-plan.md` §3.3).
 *
 * The two facts worth a test are the ones a learner would notice if they broke: asking a second
 * question in the same deck must reopen the room, not start a second one, and editing the deck
 * must start a new one. Both fall out of the key being (file id, `content_sha`).
 */
import { describe, expect, it } from 'vitest';
import { BTW_SIDE_CHANNEL_V1 } from '../room/concepts/btw-side-channel-v1.js';
import { PSD_HESSIAN_CONVEXITY_V1 } from '../room/concepts/psd-hessian-convexity-v1.js';
import { messagesForAnchor } from '../room/reference.js';
import type { ConceptPack } from '../room/records.js';
import { openTestStore, seedRoom } from '../test-support/db.js';
import { loadFlowState, openOrCreateFlowRoom, saveFlowState, segmentText, type FlowRoomDeps } from './flowroom.js';
import { API_PLAN } from '../room/llm/models.js';

const CRITIQUE1_SHA = 'ac803b62d7b4d76926eaa1f5c80341a17729ea687a064278a8051a925005ea33';

function fakeSegments(sha: string, label = '/btw as a whisper') {
  return {
    async document() {
      return {
        fileId: 'f1',
        contentSha: sha,
        genre: 'slides' as const,
        notice: null,
        pageCount: 7,
        pageSizes: [{ page: 3, width: 959.76, height: 540 }],
        builds: [],
        segments: [
          { id: 'seg_1', page: 3, x0: 0, y0: 0, x1: 1, y1: 0.377, label, source: 'geometry' as const, order: 0, buildSteps: [], candidates: [] },
          { id: 'seg_2', page: 3, x0: 0, y0: 0.377, x1: 1, y1: 1, label: 'the lower half', source: 'geometry' as const, order: 1, buildSteps: [], candidates: [] },
        ],
        refused: null,
      };
    },
  };
}

function fakeVault(pageText = 'the whole deck, extracted') {
  return {
    fileRow: () => ({ id: 'f1', name: 'A0282987E_LohZhengLucas_Critique1_slides (1).pdf', topic_id: 't1' }),
    moduleCodeFor: () => 'CS3249',
    topicContext: () => null,
    textFor: async ({ pageFrom }: { pageFrom: number | null }) =>
      pageFrom === null ? 'the whole deck, extracted' : `${pageText} · p.${pageFrom}`,
  };
}

function deps(sha = CRITIQUE1_SHA, store = openTestStore()): FlowRoomDeps & { store: typeof store } {
  return {
    store,
    segments: fakeSegments(sha) as unknown as FlowRoomDeps['segments'],
    vault: fakeVault() as unknown as FlowRoomDeps['vault'],
    pairing: 'ellie_peer',
    appVersion: '0.1.0-test',
    osVersion: 'test',
    mode: 'scripted',
    backend: 'scripted',
    models: API_PLAN,
    llm: null,
  };
}

describe('the room behind a document', () => {
  it('creates one on the first ask and reopens the same one on the second', async () => {
    const d = deps();
    const first = await openOrCreateFlowRoom(d, 'f1');
    expect(first.created).toBe(true);

    const second = await openOrCreateFlowRoom(d, 'f1');
    expect(second.created).toBe(false);
    expect(second.roomId).toBe(first.roomId);
    expect(d.store.rooms.openOrScheduled()).toHaveLength(1);
  });

  it('keys on the content sha, so an edited deck opens a new room', async () => {
    const store = openTestStore();
    const first = await openOrCreateFlowRoom(deps(CRITIQUE1_SHA, store), 'f1');
    const second = await openOrCreateFlowRoom(deps('a'.repeat(64), store), 'f1');
    expect(second.roomId).not.toBe(first.roomId);
    expect(second.created).toBe(true);
  });

  it('records the sha on the material, not the sha of the extracted text', async () => {
    const d = deps();
    await openOrCreateFlowRoom(d, 'f1');
    expect(d.store.materials.forFile('f1', CRITIQUE1_SHA)).toBeDefined();
  });

  it('opens a scripted sitting on the fixture deck with the fixture deck’s claims', async () => {
    const d = deps();
    const { roomId } = await openOrCreateFlowRoom(d, 'f1');
    const room = d.store.rooms.get(roomId)!;
    const pack = JSON.parse(d.store.materials.get(room.material_id)!.concept_pack) as ConceptPack;
    // Otherwise the ledger would score Max's questions about `/btw` against claims about
    // Hessians, and every glyph in the video would be wrong.
    expect(pack.concept_id).toBe(BTW_SIDE_CHANNEL_V1.concept_id);
  });

  it('falls back to the default pack for a deck the script does not recognise', async () => {
    const store = openTestStore();
    const d = deps('b'.repeat(64), store);
    d.vault = { ...fakeVault(), fileRow: () => ({ id: 'f1', name: 'Lecture 6.pdf', topic_id: 't1' }) } as unknown as FlowRoomDeps['vault'];
    const { roomId } = await openOrCreateFlowRoom(d, 'f1');
    const room = store.rooms.get(roomId)!;
    const pack = JSON.parse(store.materials.get(room.material_id)!.concept_pack) as ConceptPack;
    expect(pack.concept_id).toBe(PSD_HESSIAN_CONVEXITY_V1.concept_id);
  });

  it('creates the room with a student, two agents and the REFERENCE voice', async () => {
    const d = deps();
    const { roomId } = await openOrCreateFlowRoom(d, 'f1');
    const participants = d.store.participants.forRoom(roomId);
    expect(participants.filter((p) => p.kind === 'student')).toHaveLength(1);
    expect(participants.filter((p) => p.agent_key !== null)).toHaveLength(2);
    // A scope, not an agent: `kind = 'agent'` with a null key, and no row in `agents`.
    expect(participants.filter((p) => p.kind === 'agent' && p.agent_key === null)).toHaveLength(1);
  });
});

describe('the text a REFERENCE call sees', () => {
  it('is the segment’s own page, not the whole deck', async () => {
    const d = deps();
    const { text, page } = await segmentText(d, 'f1', 'seg_2');
    expect(page).toBe(3);
    expect(text).toContain('p.3');
  });

  it('is empty for a segment that no longer exists', async () => {
    expect(await segmentText(deps(), 'f1', 'seg_gone')).toEqual({ text: '', page: null });
  });
});

describe('the sitting across a quit', () => {
  it('round-trips through one settings row', () => {
    const store = openTestStore();
    const state = {
      session: null,
      taught: [{ elementId: 'C1', taughtAt: 1, by: 'teacher' as const }],
      pendingQuiz: null,
      answers: [{ answerId: 'm7', anchorId: 'seg_2', explainedBackAt: null }],
    };
    saveFlowState(store, 'room_1', state);
    expect(loadFlowState(store, 'room_1')).toEqual(state);
  });

  it('treats a corrupt row as a sitting that did not survive, not a room that cannot open', () => {
    const store = openTestStore();
    store.settings.set('flow_state:room_1', '{not json', new Date().toISOString());
    expect(loadFlowState(store, 'room_1')).toBeUndefined();
  });

  it('is undefined for a room that has never had one', () => {
    expect(loadFlowState(openTestStore(), 'room_nope')).toBeUndefined();
  });
});

describe('MessagesRepo.forAnchor', () => {
  it('agrees with the pure filter reference.ts keeps for its fixtures', () => {
    const { store, roomId, studentParticipantId } = seedRoom(undefined, []);
    const rows = [
      { anchor: 'seg_a', seq: 1 },
      { anchor: null, seq: 2 },
      { anchor: 'seg_b', seq: 3 },
      { anchor: 'seg_a', seq: 4 },
    ];
    for (const r of rows) {
      store.messages.insert({
        id: `m${r.seq}`,
        room_id: roomId,
        participant_id: studentParticipantId,
        seq: r.seq,
        body: `m${r.seq}`,
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
        anchor_id: r.anchor,
        created_at: '2026-09-17T10:00:00.000Z',
      });
    }
    const sql = store.messages.forAnchor(roomId, 'seg_a').map((m) => m.id);
    const pure = messagesForAnchor(store.messages.forRoom(roomId), 'seg_a').map((m) => m.id);
    expect(sql).toEqual(['m1', 'm4']);
    expect(sql).toEqual(pure);
  });
});

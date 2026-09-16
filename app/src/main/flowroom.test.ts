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
import { PENDING_CONCEPT_ID } from '../room/concepts/pending.js';
import { messagesForAnchor } from '../room/reference.js';
import type { ConceptPack } from '../room/records.js';
import { openTestStore, seedRoom } from '../test-support/db.js';
import { DECK_ANCHOR_ID } from '../shared/scope.js';
import {
  flowRoomView,
  loadFlowState,
  openOrCreateFlowRoom,
  referenceContext,
  saveFlowState,
  segmentText,
  type FlowRoomDeps,
} from './flowroom.js';
import { API_PLAN } from '../room/llm/models.js';
import { capText } from './vault/extract.js';
import { REFERENCE_TEXT_CAP } from './vault/service.js';

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

function fakeVault(pageText = 'the whole deck, extracted', deck = 'the whole deck, extracted') {
  return {
    fileRow: () => ({ id: 'f1', name: 'A0282987E_LohZhengLucas_Critique1_slides (1).pdf', topic_id: 't1' }),
    moduleCodeFor: () => 'CS3249',
    topicContext: () => null,
    textFor: async ({ pageFrom }: { pageFrom: number | null }) =>
      pageFrom === null ? capText(deck, REFERENCE_TEXT_CAP) : `${pageText} · p.${pageFrom}`,
    deckText: async () => ({ text: deck, pages: 58, truncated: false }),
    pageHeads: async () => [],
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

/** A stand-in for the 58-page CS4246 deck: 58 pages, ~28 K characters, well past the cap. */
function fiftyEightPages(): { text: string; segments: { page: number; label: string }[] } {
  const pages: string[] = [];
  const segments: { page: number; label: string }[] = [];
  for (let page = 1; page <= 58; page += 1) {
    const label = `Lecture topic ${page}`;
    segments.push({ page, label });
    pages.push(`${label}\n${`body line for page ${page}. `.repeat(18)}`);
  }
  return { text: pages.join('\n\n'), segments };
}

describe("the flow room's material is the whole deck", () => {
  it("equals the deck's indexed text, uncapped, on a 58-page fixture", async () => {
    const deck = fiftyEightPages();
    expect(deck.text.length).toBeGreaterThan(REFERENCE_TEXT_CAP * 4);

    const store = openTestStore();
    const d = {
      ...deps('b'.repeat(64), store),
      vault: fakeVault('page', deck.text) as unknown as FlowRoomDeps['vault'],
      segments: {
        async document() {
          return {
            fileId: 'f1',
            contentSha: 'b'.repeat(64),
            genre: 'slides' as const,
            notice: null,
            pageCount: 58,
            pageSizes: [],
            builds: [],
            segments: deck.segments.map((s, i) => ({
              id: `seg_${i}`,
              page: s.page,
              x0: 0,
              y0: 0,
              x1: 1,
              y1: 1,
              label: s.label,
              source: 'geometry' as const,
              order: i,
              buildSteps: [],
              candidates: [],
            })),
            refused: null,
          };
        },
      } as unknown as FlowRoomDeps['segments'],
    };

    const { roomId } = await openOrCreateFlowRoom(d, 'f1');
    const room = store.rooms.get(roomId)!;
    const material = store.materials.get(room.material_id)!;

    // The defect this test exists for: `textFor()` would have returned 6,000 characters.
    expect(material.extracted_text).toBe(deck.text);
    expect(material.extracted_text.length).toBeGreaterThan(REFERENCE_TEXT_CAP);
    // And the outline is the deck's own labels, with page numbers, one per slide.
    expect(material.outline.split('\n')).toHaveLength(58);
    expect(material.outline.split('\n')[13]).toBe('p. 14 — Lecture topic 14');
  });

  it('re-extracts and re-freezes a room whose material was truncated, once', async () => {
    const deck = fiftyEightPages();
    const store = openTestStore();
    const truncating = {
      ...deps('c'.repeat(64), store),
      vault: fakeVault('page', capText(deck.text, REFERENCE_TEXT_CAP)) as unknown as FlowRoomDeps['vault'],
    };
    const { roomId } = await openOrCreateFlowRoom(truncating, 'f1');
    const materialId = store.rooms.get(roomId)!.material_id;
    const before = store.materials.get(materialId)!;
    expect(before.extracted_text.length).toBeLessThanOrEqual(REFERENCE_TEXT_CAP);

    // The same deck, reopened on a build that reads it whole.
    const whole = { ...truncating, vault: fakeVault('page', deck.text) as unknown as FlowRoomDeps['vault'] };
    const again = await openOrCreateFlowRoom(whole, 'f1');
    expect(again.roomId).toBe(roomId);

    const after = store.materials.get(materialId)!;
    expect(after.extracted_text).toBe(deck.text);
    // A new prefix hash, because the model is now given a different prefix.
    expect(after.prefix_sha256).not.toBe(before.prefix_sha256);
    expect(after.token_count).toBeGreaterThan(before.token_count);

    // Idempotent: the third open changes nothing.
    await openOrCreateFlowRoom(whole, 'f1');
    expect(store.materials.get(materialId)!.prefix_sha256).toBe(after.prefix_sha256);
  });
});

describe('what one question is answered from', () => {
  const deck = fiftyEightPages();
  const OUTLINE = deck.segments.map((s) => `p. ${s.page} — ${s.label}`).join('\n');

  function ctxDeps(overrides: Partial<{ deckText: unknown; topPages: unknown }> = {}) {
    return {
      segments: {
        async document() {
          return {
            segments: [{ id: 'seg_14', page: 14, label: 'Lecture topic 14' }],
          };
        },
      },
      vault: {
        textFor: async () => 'the text of page 14',
        deckText: async () => ({ text: deck.text, pages: 58, truncated: false }),
        topPages: () => [],
        ...overrides,
      },
    } as unknown as FlowRoomDeps;
  }

  it('sends the page and the outline for a page question', async () => {
    const ctx = await referenceContext(ctxDeps(), {
      fileId: 'f1',
      segmentId: 'seg_14',
      question: 'what does admissible mean here',
      outline: OUTLINE,
    });
    expect(ctx.scope).toBe('segment');
    expect(ctx.passageText).toBe('the text of page 14');
    expect(ctx.outline).toBe(OUTLINE);
    expect(ctx.scopeShown).toBe('p. 14 + outline');
  });

  it('sends the whole deck for a deck-level verb, on the same anchor', async () => {
    const ctx = await referenceContext(ctxDeps(), {
      fileId: 'f1',
      segmentId: 'seg_14',
      question: 'Can you summarise what I will be learning',
      outline: OUTLINE,
    });
    expect(ctx.scope).toBe('deck');
    expect(ctx.passageText).toBe(deck.text);
    expect(ctx.scopeShown).toBe('whole deck');
    expect(ctx.guessed).toBe('deck');
    expect(ctx.overridden).toBe(false);
  });

  it('honours the learner’s override and records that it was one', async () => {
    const ctx = await referenceContext(ctxDeps(), {
      fileId: 'f1',
      segmentId: 'seg_14',
      question: 'Can you summarise what I will be learning',
      scope: 'segment',
      outline: OUTLINE,
    });
    expect(ctx.scope).toBe('segment');
    expect(ctx.guessed).toBe('deck');
    expect(ctx.overridden).toBe(true);
  });

  it('falls back to the outline plus FTS5 pages when the document is too large to send whole', async () => {
    const ctx = await referenceContext(
      ctxDeps({
        deckText: async () => ({ text: 'x'.repeat(100), pages: 900, truncated: true }),
        topPages: () => [
          { page: 3, body: 'page three body' },
          { page: 40, body: 'page forty body' },
        ],
      }),
      { fileId: 'f1', segmentId: null, question: 'what is the argument of chapter 4', outline: OUTLINE },
    );
    expect(ctx.scope).toBe('deck');
    expect(ctx.retrievedPages).toEqual([3, 40]);
    expect(ctx.passageText).toContain('[p. 3]');
    expect(ctx.passageText).toContain('page forty body');
    expect(ctx.scopeShown).toBe('outline + pp. 3, 40');
  });
});

describe('where the deck thread renders', () => {
  /** `flowRoomView` needs three reads off the actor and nothing else. */
  function fakeActor(anchors: string[]) {
    return {
      snapshot: () => ({ messages: anchors.map((anchorId, i) => ({ id: `m${i}`, anchorId, seq: i + 1 })) }),
      seenSnapshot: () => ({}),
      cardStateSnapshot: () => ({}),
    } as unknown as Parameters<typeof flowRoomView>[0];
  }

  it('puts the deck thread first even when it was asked last', () => {
    const view = flowRoomView(fakeActor(['seg_1', 'seg_2', DECK_ANCHOR_ID]), new Map());
    expect(view.threads.map((t) => t.anchorId)).toEqual([DECK_ANCHOR_ID, 'seg_1', 'seg_2']);
  });

  it('leaves a flow with no deck question exactly as it was', () => {
    const view = flowRoomView(fakeActor(['seg_1', 'seg_2']), new Map());
    expect(view.threads.map((t) => t.anchorId)).toEqual(['seg_1', 'seg_2']);
  });
});

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

  it('gives a deck the script does not recognise NO pack, not the fixture’s', async () => {
    const store = openTestStore();
    const d = deps('b'.repeat(64), store);
    d.vault = { ...fakeVault(), fileRow: () => ({ id: 'f1', name: 'Lecture 6.pdf', topic_id: 't1' }) } as unknown as FlowRoomDeps['vault'];
    const { roomId } = await openOrCreateFlowRoom(d, 'f1');
    const room = store.rooms.get(roomId)!;
    const material = store.materials.get(room.material_id)!;
    const pack = JSON.parse(material.concept_pack) as ConceptPack;

    // The defect: this used to be `PSD_HESSIAN_CONVEXITY_V1`, so `room_6a9609d5c6fb` — a CS4246
    // deck about search heuristics — was scored against claims about Hessians for two days.
    expect(pack.concept_id).not.toBe(PSD_HESSIAN_CONVEXITY_V1.concept_id);
    expect(pack.concept_id).toBe(PENDING_CONCEPT_ID);
    expect(pack.elements).toHaveLength(0);
    expect(material.pack_provenance).toBe('pending');
    // And the rail is empty rather than five rows about somebody else's concept.
    expect(store.ledger.forSession(store.sessions.forRoom(roomId)!.id)).toHaveLength(0);
  });

  it('opens a live deck pending rather than waiting on a 37-second ingest', async () => {
    const store = openTestStore();
    const d = { ...deps('d'.repeat(64), store), mode: 'live' as const, backend: 'claude_cli' };
    d.vault = { ...fakeVault(), fileRow: () => ({ id: 'f1', name: 'Lecture 6.pdf', topic_id: 't1' }) } as unknown as FlowRoomDeps['vault'];
    const { roomId } = await openOrCreateFlowRoom(d, 'f1');
    const material = store.materials.get(store.rooms.get(roomId)!.material_id)!;
    expect(material.pack_provenance).toBe('pending');
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
      // The learner's own reading, which must come back with the rest (audit §7): a reopened
      // deck that restores a card they dismissed is the app forgetting on their behalf.
      seen: { seg_2: 11 },
      cards: { seg_2: { collapsed: true, removed: false } },
    };
    saveFlowState(store, 'room_1', state);
    expect(loadFlowState(store, 'room_1')).toEqual(state);
  });

  it('still loads a row written before unread marks existed', () => {
    const store = openTestStore();
    store.settings.set(
      'flow_state:room_1',
      JSON.stringify({ session: null, taught: [], pendingQuiz: null, answers: [] }),
      new Date().toISOString(),
    );
    const loaded = loadFlowState(store, 'room_1');
    expect(loaded?.seen).toBeUndefined();
    expect(loaded?.cards).toBeUndefined();
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

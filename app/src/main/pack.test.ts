/**
 * The background concept ingest, and the repair it performs on a room that already exists.
 *
 * Driven **through the actor**, because the defect was never visible in the material row alone:
 * `room_6a9609d5c6fb` held the PSD/Hessian fixture pack, and what that cost the learner was that
 * every one of Ellie's prompts carried five claims about positive semidefinite Hessians while
 * they were reading a CS4246 deck about search heuristics, and every row of the rail was scored
 * against them. So the assertions are on what the actor puts in front of the model and what it
 * shows in the rail, not only on `pack_provenance`.
 */
import { describe, expect, it } from 'vitest';
import { groupView } from './db/store.js';
import { FakeClock } from '../test-support/clock.js';
import { DEFAULT_ROOM_CONFIG, seedRoom } from '../test-support/db.js';
import { rosterFor } from '../room/agents.js';
import { RoomActor } from '../room/actor.js';
import { buildGroupContext } from '../room/context.group.js';
import { PSD_HESSIAN_CONVEXITY_V1 } from '../room/concepts/psd-hessian-convexity-v1.js';
import { PENDING_CONCEPT_ID, pendingPack } from '../room/concepts/pending.js';
import { API_PLAN } from '../room/llm/models.js';
import { EMPTY_USAGE, type LLMClient, type LlmRequest } from '../room/llm/types.js';
import type { ConceptPack } from '../room/records.js';
import { stableJson } from '../room/prompts.js';
import { ensurePack, packBelongsToDeck, packFromDraft } from './pack.js';

const CS4246_CLAIMS = {
  title: 'Search and planning',
  claims: [
    { id: 'R1', label: 'An admissible heuristic never overestimates the true cost to the goal', learner_label: 'what admissible means', level_three_criterion: 'Shows it on a specific grid instance.' },
    { id: 'R2', label: 'A* with an admissible heuristic returns an optimal path', learner_label: 'why A* is optimal', level_three_criterion: 'Traces the frontier on one example.' },
    { id: 'R3', label: 'Manhattan distance is admissible on a 4-connected grid', learner_label: 'Manhattan on a grid', level_three_criterion: 'Computes it for two cells.' },
  ],
};

/** A live client that answers the ingest and nothing else. `kind` is not `'scripted'` on purpose. */
function draftingClient(body: unknown = CS4246_CLAIMS): LLMClient & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    kind: 'claude-cli',
    calls,
    async complete(request) {
      calls.push(request);
      return { text: JSON.stringify(body), model: request.model, usage: { ...EMPTY_USAGE }, ttftMs: 1, backend: 'claude-cli' };
    },
  };
}

function actorOn(seeded: ReturnType<typeof seedRoom>, pack: ConceptPack) {
  let n = 0;
  const actor = new RoomActor({
    store: seeded.store,
    groupStore: groupView(seeded.store),
    clock: new FakeClock(),
    transport: { emit: () => undefined },
    llm: draftingClient(),
    roomId: seeded.roomId,
    sessionId: seeded.sessionId,
    roster: rosterFor('ellie_peer'),
    pack,
    config: { ...DEFAULT_ROOM_CONFIG, mode: 'live' },
    appVersion: '0.1.0-test',
    newId: (prefix) => `${prefix}_${(n += 1)}`,
    random: () => 0.5,
  });
  actor.start();
  return actor;
}

/** What Ellie is actually given: `system[0]`, built the way the actor builds it. */
function prefixFor(seeded: ReturnType<typeof seedRoom>, pack: ConceptPack): string {
  const roster = rosterFor('ellie_peer');
  return buildGroupContext(groupView(seeded.store), {
    roomId: seeded.roomId,
    speaker: roster[0]!,
    roster,
    pack,
    directive: { move: 'respond', target: null, probeType: null, agentKey: roster[0]!.key },
  }).system.map((b) => b.text).join('\n');
}

describe('whose claims a room is scored against', () => {
  it('rejects a fixture pack on a deck that is not the fixture', () => {
    const notTheFixture = seedRoom(undefined, [], { fileName: 'Lecture-complex v4.0.pdf' });
    expect(packBelongsToDeck(notTheFixture.store.materials.get(notTheFixture.materialId)!)).toBe(false);
  });

  it('keeps a fixture pack on the fixture itself', () => {
    const fixture = seedRoom(undefined, [], { fileName: 'PSD-Hessian-convexity.pdf' });
    expect(packBelongsToDeck(fixture.store.materials.get(fixture.materialId)!)).toBe(true);
  });

  it('keeps an elicited pack, whatever the file is called', () => {
    const own = seedRoom(undefined, [], { fileName: 'anything.pdf' });
    own.store.materials.refreeze(own.materialId, {
      pack_provenance: 'elicited',
      token_count: 4600,
      cache_eligible: 1,
      prefix_sha256: 'x',
    });
    expect(packBelongsToDeck(own.store.materials.get(own.materialId)!)).toBe(true);
  });
});

describe('the repair room_6a9609d5c6fb needed, through the actor', () => {
  it('re-drafts the pack, replaces the rail, and takes Hessians out of Ellie’s prompt', async () => {
    // The material text is the CS4246 deck's, so what is left of "Hessian" in the prefix
    // afterwards can only have come from the pack.
    const seeded = seedRoom(undefined, [], {
      fileName: 'Lecture-complex v4.0.pdf',
      materialText: 'Uninformed search, A*, and admissible heuristics on a grid world.',
      title: 'Search and planning',
    });
    const actor = actorOn(seeded, PSD_HESSIAN_CONVEXITY_V1);

    // Before: the state the live room was found in.
    expect(prefixFor(seeded, PSD_HESSIAN_CONVEXITY_V1)).toContain('Hessian');
    expect(actor.snapshot().ledger.rows.map((r) => r.label).join(' ')).toContain('Hessian');
    const before = seeded.store.materials.get(seeded.materialId)!;

    const swapped = await ensurePack(
      {
        store: seeded.store,
        pairing: 'ellie_peer',
        models: API_PLAN,
        mode: 'live',
        llm: draftingClient(),
        onReady: ({ pack }) => actor.rebind({ pack }),
        now: () => '2026-09-16T10:00:00.000Z',
      },
      seeded.roomId,
    );
    expect(swapped).toBe(true);

    const after = seeded.store.materials.get(seeded.materialId)!;
    expect(after.pack_provenance).toBe('elicited');
    // A different prefix is a different hash. A hash that did not move is a cache key that lies.
    expect(after.prefix_sha256).not.toBe(before.prefix_sha256);

    const pack = JSON.parse(after.concept_pack) as ConceptPack;
    expect(pack.elements.map((e) => e.id)).toEqual(['R1', 'R2', 'R3']);
    expect(prefixFor(seeded, pack)).not.toContain('Hessian');
    expect(prefixFor(seeded, pack)).toContain('admissible heuristic');

    // The rail is the new claims, not five orphan rows plus three new ones.
    // The room's own topic line moved with it: Ellie is no longer told the learner is working
    // through "convexity and the Hessian".
    expect(seeded.store.rooms.get(seeded.roomId)!.topic).toBe('Search and planning');

    const rows = actor.snapshot().ledger.rows;
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.learnerLabel)).toEqual([
      'what admissible means',
      'why A* is optimal',
      'Manhattan on a grid',
    ]);
    expect(rows.every((r) => r.level === 0)).toBe(true);
  });

  it('demotes a wrong fixed pack even when nothing can draft, rather than leaving it in place', async () => {
    const seeded = seedRoom(undefined, [], { fileName: 'Lecture-complex v4.0.pdf' });
    const swapped = await ensurePack(
      { store: seeded.store, pairing: 'ellie_peer', models: API_PLAN, mode: 'scripted', llm: null },
      seeded.roomId,
    );
    expect(swapped).toBe(false);
    const material = seeded.store.materials.get(seeded.materialId)!;
    expect(material.pack_provenance).toBe('pending');
    expect((JSON.parse(material.concept_pack) as ConceptPack).concept_id).toBe(PENDING_CONCEPT_ID);
    // And the rail empties rather than showing somebody else's five claims.
    expect(seeded.store.ledger.forSession(seeded.sessionId)).toHaveLength(0);
  });

  it('is a no-op on a room whose pack is already its own', async () => {
    const seeded = seedRoom(undefined, [], { fileName: 'Lecture-complex v4.0.pdf' });
    seeded.store.materials.refreeze(seeded.materialId, {
      pack_provenance: 'elicited',
      token_count: 4600,
      cache_eligible: 1,
      prefix_sha256: 'frozen',
    });
    const llm = draftingClient();
    const swapped = await ensurePack(
      { store: seeded.store, pairing: 'ellie_peer', models: API_PLAN, mode: 'live', llm },
      seeded.roomId,
    );
    expect(swapped).toBe(false);
    expect(llm.calls).toHaveLength(0);
    expect(seeded.store.materials.get(seeded.materialId)!.prefix_sha256).toBe('frozen');
  });

  it('drafts from the outline as well as the text', async () => {
    const seeded = seedRoom(undefined, [], { fileName: 'Lecture-complex v4.0.pdf' });
    seeded.store.materials.refreeze(seeded.materialId, {
      concept_pack: stableJson(pendingPack('Search and planning')),
      pack_provenance: 'pending',
      outline: 'p. 1 — Uninformed search\np. 14 — A* search',
      token_count: 4600,
      cache_eligible: 1,
      prefix_sha256: 'p',
    });
    const llm = draftingClient();
    await ensurePack(
      { store: seeded.store, pairing: 'ellie_peer', models: API_PLAN, mode: 'live', llm },
      seeded.roomId,
    );
    expect(llm.calls[0]!.messages[0]!.content).toContain('p. 14 — A* search');
  });
});

describe('the pack a draft becomes', () => {
  it('inherits nothing from the fixture — not its probes, not its misconceptions', () => {
    const pack = packFromDraft(
      {
        conceptId: 'elicited-abc',
        title: 'Search and planning',
        claims: CS4246_CLAIMS.claims.map((c) => ({
          id: c.id,
          label: c.label,
          learnerLabel: c.learner_label,
          levelThreeCriterion: c.level_three_criterion,
        })),
      },
      'fallback',
    );
    const json = JSON.stringify(pack);
    expect(json).not.toContain('Hessian');
    expect(json).not.toContain('PSD');
    expect(pack.elements.every((e) => e.misconceptions.length === 0)).toBe(true);
    expect(pack.elements[0]!.criteria['3']).toBe('Shows it on a specific grid instance.');
  });
});

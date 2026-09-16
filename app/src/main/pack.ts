/**
 * **The concept pack, drafted off the critical path and swapped in when it lands** (issue #35;
 * `docs/research/whole-file-context.md` §4 recommendations 2 and 5).
 *
 * Two defects meet here, and they are the same defect seen from either end:
 *
 *  1. **A room could be given another deck's claims.** `packFor()`'s base was the committed
 *     PSD/Hessian fixture and `pack_provenance` had no third value, so any deck opened while the
 *     backend was `scripted` got the demo concept. `room_6a9609d5c6fb` — 58 pages of CS4246
 *     search and planning — has been scoring the learner against positive semidefinite Hessians
 *     since it was created, in Ellie's prompt and in every row of the rail.
 *  2. **A room that drafted its own claims made the learner wait for them.** `draftConcept` was
 *     awaited inside `openOrCreateFlowRoom`, i.e. inside the first "+ Ask here", and it is a
 *     37-second Sonnet call. The REFERENCE answer needs no pack at all; it was queued behind one.
 *
 * So the flow opens every non-fixture deck on `pendingPack()` and returns at once, and this
 * module drafts the real pack afterwards. The swap is three writes and an event:
 *
 *   - the material row gets the pack, `pack_provenance = 'elicited'`, and a **re-frozen prefix**
 *     (`frozenPrefix()`), because the pack is inside `sharedBlock()` and a hash that did not
 *     move would be a cache key that lies;
 *   - the session's ledger rows are *replaced*, not merged — the old rows are about other claims;
 *   - `RoomActor.rebind({ pack })` puts it in front of the next turn, and `pack.ready` tells the
 *     renderer to redraw the rail.
 *
 * **Single-flight per material.** The first Ask, the room reopening and a Settings change to a
 * live backend can all arrive within a second of each other, and three concurrent ingests would
 * be three `claude` children fighting for the same row — which is the other half of the
 * `exited 1: no output` failure this issue is about.
 */
import { newId, draftConcept, frozenPrefix, shortLabel } from './sessions.js';
import { log } from './log.js';
import { rosterFor } from '../room/agents.js';
import { pendingPack } from '../room/concepts/pending.js';
import { FIXED_PACKS, PSD_HESSIAN_CONVEXITY_V1 } from '../room/concepts/psd-hessian-convexity-v1.js';
import { matchFixtureDeck } from '../room/llm/scripts.js';
import type { ModelPlan } from '../room/llm/models.js';
import type { LLMClient } from '../room/llm/types.js';
import type { ConceptPack, LedgerRow, MaterialRow } from '../room/records.js';
import { stableJson } from '../room/prompts.js';
import type { RolePairing } from '../shared/types.js';
import type { LocalStore } from './db/store.js';
import { packFromTree } from './objectives/pack.js';

export interface PackDeps {
  store: LocalStore;
  pairing: RolePairing;
  models: ModelPlan;
  mode: 'scripted' | 'live';
  /** Null in scripted mode, and whenever the resolved backend cannot draft. */
  llm: LLMClient | null;
  /** Called with the new pack once it is on the row. The IPC layer rebinds the actor and emits. */
  onReady?: (input: { roomId: string; materialId: string; pack: ConceptPack }) => void;
  now?: () => string;
}

/** Material ids with an ingest in flight. Module-level: there is one app and one database. */
const inFlight = new Set<string>();

/**
 * Whether this material's pack is one this deck may keep.
 *
 * `'elicited'` always may — it was drafted from this deck's own text. `'fixed'` may only if the
 * deck **is** the fixture that pack belongs to; that check is what `room_6a9609d5c6fb` fails,
 * and failing it is what gets its pack re-drafted rather than requiring a hand-written repair.
 */
export function packBelongsToDeck(material: MaterialRow): boolean {
  if (material.pack_provenance === 'elicited') return true;
  if (material.pack_provenance === 'pending') return false;
  const fixture = matchFixtureDeck({ fileName: material.file_path, contentSha: material.file_sha256 });
  if (fixture === null) return false;
  const expected = fixture === 'psd-hessian' ? PSD_HESSIAN_CONVEXITY_V1.concept_id : 'btw-side-channel-v1';
  const pack = JSON.parse(material.concept_pack) as ConceptPack;
  return pack.concept_id === expected;
}

/**
 * Draft this room's pack if it needs one, in the background. Returns true when a draft ran and
 * was swapped in.
 *
 * Safe to call on every room open, on every backend change and after every first Ask: the three
 * early returns below make it a no-op for a room whose pack is already its own.
 */
export async function ensurePack(deps: PackDeps, roomId: string): Promise<boolean> {
  const now = deps.now ?? (() => new Date().toISOString());
  const room = deps.store.rooms.get(roomId);
  if (!room) return false;
  const material = deps.store.materials.get(room.material_id);
  if (!material) return false;
  if (packBelongsToDeck(material)) return false;

  /**
   * **The tree is the pack** (issue #38; the argument is in `objectives/pack.ts`).
   *
   * A flow room whose file has a learning-objective tree runs on that tree: one element per
   * objective, `element.id` = `objective.id`, so the ledger's rules are untouched and the states
   * the panel draws are a mirror of ledger rows that already carry the right ids.
   *
   * And when the tree is only *coming*, this returns without drafting. `draftConcept` would
   * spend a second minute of Sonnet on the same deck to produce five claims with different ids,
   * which the tree would then replace — two ingests, one of them thrown away, and a rail that
   * changed under the learner in between.
   */
  const tree = material.file_id ? deps.store.objectives.tree(material.file_id) : null;
  if (tree?.status === 'ready' && tree.objectives.length > 0) {
    const pack = packFromTree(tree, material.title);
    swapIn(deps, { roomId, material, pack, topic: room.topic, now: now() });
    log().info('pack.from_tree', {
      room_id: roomId,
      material_id: material.id,
      file_id: material.file_id,
      elements: pack.elements.length,
    });
    return true;
  }
  if (tree !== null && tree.status !== 'failed') {
    if (material.pack_provenance === 'fixed') demoteToPending(deps, material, room.topic, now());
    return false;
  }

  /**
   * **A wrong `fixed` pack is demoted even when nothing can be drafted right now.** Otherwise a
   * scripted sitting on a non-fixture deck goes on showing the fixture's claims in the rail and
   * feeding them to Ellie, which is the state this issue found the app in. Demoting costs the
   * transcript nothing — the rail empties and says so — and the next live open drafts for real.
   */
  if (material.pack_provenance === 'fixed') demoteToPending(deps, material, room.topic, now());

  if (deps.mode !== 'live' || !deps.llm || deps.llm.kind === 'scripted') return false;
  if (inFlight.has(material.id)) return false;
  inFlight.add(material.id);
  const startedAt = Date.now();
  log().info('pack.draft.start', {
    room_id: roomId,
    material_id: material.id,
    was: material.pack_provenance,
    model: deps.models.orchestrator,
    chars: material.extracted_text.length,
    outline_lines: material.outline ? material.outline.split('\n').length : 0,
  });

  try {
    const fresh = deps.store.materials.get(material.id) ?? material;
    const draft = await draftConcept(
      deps.llm,
      {
        moduleCode: fresh.module_code,
        title: fresh.title,
        text: fresh.extracted_text,
        outline: fresh.outline,
        fileId: fresh.file_id,
      },
      deps.models,
    );
    if (draft.provenance !== 'elicited' || draft.claims.length === 0) {
      log().warn('pack.draft.declined', { room_id: roomId, ms: Date.now() - startedAt });
      return false;
    }
    const pack = packFromDraft(draft, fresh.title);
    swapIn(deps, { roomId, material: fresh, pack, topic: room.topic, now: now() });
    log().info('pack.ready', {
      room_id: roomId,
      material_id: material.id,
      ms: Date.now() - startedAt,
      elements: pack.elements.length,
      concept_id: pack.concept_id,
    });
    return true;
  } catch (err) {
    /**
     * **Pre-emption is not a failure.** The learner asked something while this draft was
     * running and the CLI lane was taken back for them (`claude-cli.ts` `CLI_PREEMPTIBLE`). The
     * row is still `pending`, which is where it started, so the next room open — or the call at
     * the end of `#ask`, once the answer is on screen — starts it again.
     */
    if ((err as Error).name === 'CliPreemptedError') {
      log().info('pack.draft.preempted', { room_id: roomId, ms: Date.now() - startedAt });
      return false;
    }
    // An ingest that fails is a rail that stays empty, not a room that breaks. The next open
    // tries again, because the row is still `pending`.
    log().error('pack.draft.failed', { room_id: roomId, ms: Date.now() - startedAt, cause: (err as Error).message });
    return false;
  } finally {
    inFlight.delete(material.id);
  }
}

/**
 * The draft, as the pack schema.
 *
 * The level descriptors are **generic and written here**, not asked of the model: they are the
 * shared scale from `prompts.ts` said once per claim, and asking a model for four of them per
 * element is four times the output tokens for the call that made ingest a 37-second wait
 * (`whole-file-context.md` §2 — latency scales with output, not input). Only level 3 is drafted,
 * because "what *applied* looks like for this claim" is the one rung that cannot be written
 * without knowing the claim.
 *
 * Nothing is inherited from `PSD_HESSIAN_CONVEXITY_V1`. An earlier draft of this function used
 * it as a template and carried its `probe_seeds` across, which would have had Max asking a
 * CS4246 deck about the domain conditions on a Hessian — the same bug this issue is about,
 * one layer down.
 */
export function packFromDraft(
  draft: {
    conceptId: string;
    title: string;
    claims: { id: string; label: string; learnerLabel: string; levelThreeCriterion: string }[];
  },
  fallbackTitle: string,
): ConceptPack {
  return {
    concept_id: draft.conceptId,
    title: draft.title || fallbackTitle,
    source: 'drafted from the learner\u2019s own document',
    target_level: 3,
    elements: draft.claims.map((claim, i) => {
      const label = claim.label.trim();
      return {
        id: claim.id || `R${i + 1}`,
        label,
        learner_label: shortLabel(claim.learnerLabel || label),
        criteria: {
          '1': `States it: says ${lower(label)} correctly, in some form.`,
          '2': `Explains it: gives the mechanism or the reason in their own words, not the slide\u2019s.`,
          '3': claim.levelThreeCriterion.trim() || `Applies it to a specific instance, number or new case.`,
          '4': `Examines it: compares it with an alternative, handles a counterfactual, states a limit, or catches their own error.`,
        },
        // Neither is drafted. A misconception the ingest invented is a misconception the
        // Challenger would then hunt for in a learner who never held it, and a probe seed is a
        // sentence Max says out loud — both are worth their own call, not a guess. Empty is
        // handled everywhere: `sharedBlock` prints no misconception lines and the Challenger
        // falls back to its role block\u2019s own probe types.
        misconceptions: [],
        probe_seeds: {
          clarification: `What exactly do you mean by ${lower(claim.learnerLabel || label)}?`,
          reasons_evidence: `What in the material makes that true?`,
          assumptions: `What has to hold for that to work?`,
          implications: `What follows from that?`,
          alternatives: `What would the other option look like here?`,
        },
      };
    }),
  };
}

/** Lower-cases a claim for mid-sentence use, unless it opens with something already capital. */
function lower(text: string): string {
  const trimmed = text.replace(/[.\s]+$/, '');
  if (/^[A-Z]{2,}/.test(trimmed)) return trimmed;
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function demoteToPending(deps: PackDeps, material: MaterialRow, topic: string, now: string): void {
  const pack = pendingPack(material.title);
  write(deps, material, pack, 'pending', topic, now);
  log().info('pack.demoted', {
    material_id: material.id,
    file: material.file_path,
    was: JSON.parse(material.concept_pack).concept_id as string,
  });
}

function swapIn(
  deps: PackDeps,
  input: { roomId: string; material: MaterialRow; pack: ConceptPack; topic: string; now: string },
): void {
  write(deps, input.material, input.pack, 'elicited', input.topic, input.now);
  deps.onReady?.({ roomId: input.roomId, materialId: input.material.id, pack: input.pack });
}

/** The material row, its prefix hash and the session's ledger rows, together or not at all. */
function write(
  deps: PackDeps,
  material: MaterialRow,
  pack: ConceptPack,
  provenance: MaterialRow['pack_provenance'],
  topic: string,
  now: string,
): void {
  const roster = rosterFor(deps.pairing, deps.models.agent);
  const patched: MaterialRow = {
    ...material,
    title: pack.title || material.title,
    concept_pack: stableJson(pack),
    pack_provenance: provenance,
  };
  const room = deps.store.rooms.openOrScheduled().find((r) => r.material_id === material.id);
  const session = deps.store.sessions.forRoom(room?.id ?? '');
  // `rooms.topic` is the sentence "The learner is working through: …" in the prefix, and it was
  // set from the material's title at creation. A pack that renames the material must rename it
  // too, or Ellie is told the learner is working through the fixture's concept while being
  // handed this deck's claims — half the bug, surviving the fix.
  const nextTopic = pack.title && room && room.topic !== pack.title ? pack.title : null;
  deps.store.transaction(() => {
    if (room && nextTopic) deps.store.rooms.update(room.id, { topic: nextTopic });
    deps.store.materials.refreeze(material.id, {
      title: patched.title,
      concept_pack: patched.concept_pack,
      pack_provenance: provenance,
      ...frozenPrefix(patched, pack, roster, nextTopic ?? topic),
    });
    if (!session) return;
    const rows: LedgerRow[] = pack.elements.map((element) => ({
      id: newId('led'),
      session_id: session.id,
      element_id: element.id,
      level: 0,
      level_proposed: 0,
      confidence: null,
      evidence_text: null,
      evidence_msg_id: null,
      evidence_seq: null,
      defended_against: null,
      revisit: 0,
      contested: 0,
      misconceptions_open: '[]',
      misconceptions_resolved: '[]',
      updated_at: now,
    }));
    deps.store.ledger.replaceForSession(session.id, rows);
  });
}

/** Re-exported so callers do not have to know which module the fixture set lives in. */
export { FIXED_PACKS };

/**
 * **The pack a room has before it has a pack.**
 *
 * `whole-file-context.md` §1 defect 2: `packFor()`'s base was the committed PSD/Hessian fixture
 * and `materials.pack_provenance` admitted only `'fixed'` or `'elicited'`, so "this deck has no
 * pack yet" was unrepresentable and the fixture was the fallback for every deck in the world.
 * `room_6a9609d5c6fb` — a 58-page CS4246 search-and-planning deck — has been scored against
 * claims about positive semidefinite Hessians since the moment it was created.
 *
 * So: no elements. A pack with no elements is not a broken pack; it is an honest one, and
 * everything downstream already handles it — the ledger rail renders zero rows (and says "no
 * concepts yet"), `bloomRung` returns `remember`, `coverage` returns 0, and the ledger call is
 * skipped because there is nothing to propose against. The background ingest replaces it at
 * the next turn (`src/main/pack.ts`).
 *
 * `target_level` is 3 like every other pack, so the rail's arithmetic does not special-case it.
 */
import type { ConceptPack } from '../records.js';

export const PENDING_CONCEPT_ID = 'pending';

export function pendingPack(title: string): ConceptPack {
  return {
    concept_id: PENDING_CONCEPT_ID,
    title,
    source: 'not yet drafted',
    target_level: 3,
    elements: [],
  };
}

/** True for a pack that has never been drafted. Cheaper and clearer than reading provenance. */
export function isPendingPack(pack: ConceptPack): boolean {
  return pack.concept_id === PENDING_CONCEPT_ID || pack.elements.length === 0;
}

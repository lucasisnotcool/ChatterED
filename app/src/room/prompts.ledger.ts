/**
 * **The ledger's own system block** — issue #35 item 5(b).
 *
 * Until now the ledger call reused `buildGroupContext()` wholesale: the frozen room prefix
 * (house rules, safeguards, the concept pack, the *whole document*), then Ellie's role block,
 * then the transcript, then a directive. Measured on `room_6a9609d5c6fb`: **15,090 system
 * characters** of which the learner's deck is most, for a call that does not speak, does not
 * read the deck and is judging four sentences the learner wrote.
 *
 * What a judge needs is the rubric and the transcript. So this block is the five rungs, the
 * pack's own criteria, and the verbatim rule — about 2 K characters against 15 K — and
 * `#updateLedger` keeps `buildGroupContext`'s **message stream** (one transcript builder, one
 * whisper invariant) and replaces only its `system`.
 *
 * Kept in its own module for the same reason `prompts.whisper.ts` and `prompts.reference.ts`
 * are: so that the thing which is not a turn is not assembled by the code that builds turns.
 */
import type { ConceptPack } from './records.js';

/**
 * The five rungs, as a **rubric for a judge**.
 *
 * `prompts.ts` has the same scale phrased for a speaker ("how understanding is described"), and
 * the two must not drift: `prompts.ledger.test.ts` asserts every rung word here appears in the
 * shared block too. One sentence per rung, because a judge that is given paragraphs writes
 * paragraphs of reasoning, and reasoning tokens are the entire latency of this call.
 */
export const LEDGER_LEVEL_SCALE = `THE SCALE (identical to the one the room runs on)
0 not yet — not addressed.
1 stated — says the fact correctly in some form (remember).
2 explained — gives the mechanism or causal reason in their own words (understand).
3 applied — uses it on a specific instance, number or new case (apply).
4 examined — compares, handles a counterfactual, states a limit, or catches their own error (analyse).`;

export function ledgerSystemBlock(pack: ConceptPack): string {
  const elements = pack.elements
    .map((e) => {
      const criteria = (['1', '2', '3', '4'] as const).map((k) => `    ${k}: ${e.criteria[k]}`).join('\n');
      return `  ${e.id} — ${e.label}\n${criteria}`;
    })
    .join('\n\n');

  return [
    'You score one learner against a fixed rubric and answer with a JSON object. You are not in',
    'the conversation, you do not speak, and nothing you write is shown to anyone: a glyph moves',
    'in a progress rail, or it does not.',
    '',
    LEDGER_LEVEL_SCALE,
    '',
    `THE CLAIMS BEING SCORED (concept ${pack.concept_id})`,
    elements.length > 0 ? elements : '  (none — this document has no claims yet; return an empty array)',
    '',
    'THE ONE RULE THAT IS CHECKED IN CODE.',
    'Every "evidence" string is compared, character for character, against the learner\'s own',
    'messages. A quote that is not literally in one of them is discarded — and the level it was',
    'supporting is discarded with it. Copy, never paraphrase. A null is a better answer than an',
    'approximation.',
    '',
    'Be brief. Do not explain your reasoning before the object; the object is the whole reply.',
  ].join('\n');
}

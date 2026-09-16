/**
 * **How the tree and the concept pack were reconciled: the tree *is* the pack.**
 *
 * `learning-objectives.md` §2 says the tree "supersedes the concept pack as the learner-facing
 * object" and that "the concept pack's `elements[].criteria{1,2,3}` were the same idea with a
 * different name". Two ways to honour that were available and only one of them is small:
 *
 *  1. Teach the ledger to score objectives directly — a second evaluator, a second set of rules,
 *     and two things that can disagree about what level 2 means.
 *  2. **Derive the pack from the tree.** One element per objective, `element.id` = `objective.id`,
 *     and then *nothing else changes*: `applyLedgerRules` runs unmodified, `sharedBlock` puts the
 *     objectives in the prefix where the claims used to be, the rail renders, the Tester's
 *     target selection works, and `learning_objective_states` is a mirror of ledger rows that
 *     already carry the right ids.
 *
 * This is (2), and it is the whole of the reconciliation. The ledger's four rules are untouched
 * and are what make a node's state trustworthy; what changed is only *what the candidates are*.
 *
 * **Which decks this applies to.** Every deck whose pack would otherwise be `pending` — i.e.
 * every real deck. A deck with a **committed fixture pack** keeps it: `packBelongsToDeck()` is
 * true for the Critique 1 and PSD/Hessian fixtures in scripted mode, and `script.critique1.ts`
 * seeds a sitting against that pack's element ids for the A1 video. Rewriting the demo's pack to
 * match its fixture *tree* would break the filmed take four days before it is due, for no gain
 * the video shows. Stated as a limitation rather than hidden: in scripted mode on the fixture
 * deck the panel renders the fixture tree and the ledger scores the fixture pack, and the two do
 * not move each other.
 *
 * The level descriptors are generic and written here, exactly as `main/pack.ts` writes them for a
 * drafted pack and for the same reason (`whole-file-context.md` §2 — latency scales with output).
 * The one rung that cannot be generic is **level 2**, which is the rung the panel calls *online*:
 * that one is the objective's own criteria, which is what §2 meant by the two being the same idea.
 */
import type { LearningObjective, LearningTree } from '../../shared/objectives.js';
import type { ConceptElement, ConceptPack } from '../../room/records.js';
import { shortLabel } from '../sessions.js';

/** Lower-cases a title for mid-sentence use, unless it opens with something already capital. */
function lower(text: string): string {
  const trimmed = text.replace(/[.\s]+$/, '');
  if (/^[A-Z]{2,}/.test(trimmed)) return trimmed;
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function elementFor(objective: LearningObjective): ConceptElement {
  const criteria = objective.criteria.filter((c) => c.trim().length > 0);
  const seeds = objective.quizSeeds.filter((s) => s.trim().length > 0);
  const label = objective.statement.trim() || objective.title;
  return {
    id: objective.id,
    label,
    learner_label: shortLabel(objective.title) || objective.title,
    criteria: {
      '1': `States it: says ${lower(objective.title)} correctly, in some form.`,
      // The objective's own criteria, at the rung the panel calls online. §4: an objective goes
      // online once the learner has explained it in their own words, and these are what "in
      // their own words" is checked against.
      '2':
        criteria.length > 0
          ? `Explains it in their own words, and what that contains: ${criteria.join('; ')}.`
          : 'Explains it: gives the mechanism or the reason in their own words, not the deck’s.',
      '3': 'Applies it to a specific instance, number or new case.',
      '4':
        'Examines it: compares it with an alternative, handles a counterfactual, states a limit, or catches their own error.',
    },
    // Not drafted, for the reason `main/pack.ts` gives: a misconception the ingest invented is
    // one the Tester would then hunt for in a learner who never held it.
    misconceptions: [],
    probe_seeds: {
      // §4: "The Tester quizzes from `quizSeeds`". The five Socratic slots are the shape the
      // prompt already has, so the seeds fill them in order and the generic lines only cover
      // what the deck did not give a stem for.
      clarification: seeds[0] ?? `What exactly do you mean by ${lower(objective.title)}?`,
      reasons_evidence: seeds[1] ?? 'What in the deck makes that true?',
      assumptions: seeds[2] ?? 'What has to hold for that to work?',
      implications: 'What follows from that?',
      alternatives: 'What would the other option look like here?',
    },
    /** The stems as the ingest wrote them, unpadded — what `quizNote()` puts in the directive. */
    quiz_seeds: seeds,
    /** What a correct demonstration contains, for the Tester's feedback turn. */
    demonstration: criteria,
  };
}

/**
 * The pack a flow room runs on, built from the file's tree.
 *
 * **Prerequisites are elements too.** §4 is explicit that the evaluator's candidates are "the
 * file's objectives (and prerequisite nodes)": a learner who explains the thing the deck assumed
 * has demonstrated it, and a node that can never light is a node that is decoration.
 */
export function packFromTree(tree: LearningTree, fallbackTitle: string): ConceptPack {
  const ordered = [...tree.objectives].sort((a, b) => a.order - b.order);
  return {
    concept_id: `objectives-${tree.contentSha.slice(0, 12)}-v${tree.version}`,
    title: fallbackTitle,
    source: 'the learning objectives of this deck',
    target_level: 3,
    elements: ordered.map(elementFor),
  };
}

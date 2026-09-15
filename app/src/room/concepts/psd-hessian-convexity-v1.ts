/**
 * The committed fixed Concept Pack for the demo concept (architecture-mac.md §H.2 M0:
 * "the fixed concept pack for the demo concept — PSD Hessian implies convexity").
 *
 * Schema: progress-tracking.md §3. A fixed pack is used for Study A and for every pilot,
 * because two participants must face the same rubric or the ledger is not a comparable
 * measure. The elicited path (the learner confirms 3–5 claims off their own slide) uses the
 * same schema and the same level criteria.
 *
 * It is a TypeScript module rather than a JSON file on disk so that it is typed, hashed in
 * process, and cannot go missing from a packaged `app.asar`.
 */
import type { ConceptPack } from '../records.js';
import { BTW_SIDE_CHANNEL_V1 } from './btw-side-channel-v1.js';

export const PSD_HESSIAN_CONVEXITY_V1: ConceptPack = {
  concept_id: 'psd-hessian-convexity-v1',
  title: 'Convexity and the Hessian',
  source: 'MA3236-style; second-order condition for convexity',
  target_level: 3,
  elements: [
    {
      id: 'R1',
      label: 'PSD Hessian everywhere on S ⇒ f is convex on S',
      learner_label: 'PSD ⇒ convex on S',
      criteria: {
        '1': 'States the second-order condition: if the Hessian is positive semidefinite then f is convex.',
        '2': 'Explains that the condition is an "if and only if" on an open convex set, and says what the Hessian is doing — curvature that never bends downward.',
        '3': 'Applies it to a specific function or a specific set, naming where the condition has to hold.',
        '4': 'Supplies the quantifier and the domain conditions under challenge, or handles a counterfactual (what fails if S is not convex, or not open).',
      },
      misconceptions: [
        { id: 'M1a', text: 'Treats the condition as one-directional or as a sufficient test at a single point.' },
        { id: 'M1b', text: 'Ignores the requirement that S be convex (and open) for the statement to mean anything.' },
      ],
      probe_seeds: {
        clarification: 'When you say "the Hessian is PSD", PSD where — at a point, or somewhere else?',
        reasons_evidence: 'What is the Hessian telling you about the function that makes convexity follow?',
        assumptions: 'You are assuming something about S. What, and does the statement survive without it?',
        implications: 'If that is right, what does it let you conclude about a local minimum of f?',
        alternatives: 'Is there another way to show the same function is convex without touching the Hessian?',
      },
    },
    {
      id: 'R2',
      label: '"Positive semidefinite" means zᵀHz ≥ 0 for all z, not "all entries ≥ 0"',
      learner_label: 'what PSD means',
      criteria: {
        '1': 'States that PSD is a condition on zᵀHz, not on the entries of the matrix.',
        '2': 'Explains the quantifier — it must hold for every vector z — and why an entrywise reading is a different condition.',
        '3': 'Uses it on a specific matrix: computes zᵀHz for a chosen z, or checks eigenvalues on an example.',
        '4': 'Produces or defends a counterexample (an entrywise-positive matrix that is not PSD) and says what it rules out.',
      },
      misconceptions: [
        { id: 'M2a', text: 'Thinks PSD means every entry of the matrix is non-negative.' },
        { id: 'M2b', text: 'Thinks PSD means the determinant is non-negative.' },
      ],
      probe_seeds: {
        clarification: 'Say the definition of PSD back to me in symbols. What is being quantified over?',
        reasons_evidence: 'What would you compute to convince me a given matrix is PSD?',
        assumptions: 'You are reading it as a statement about the matrix entries. Is it?',
        implications: 'If PSD were about the entries, what would happen to the eigenvalue characterisation?',
        alternatives: 'Eigenvalues, leading minors, or zᵀHz — which of those are equivalent here?',
      },
    },
    {
      id: 'R3',
      label: 'The condition must hold at every point of S, not only at a stationary point',
      learner_label: 'at every point of S',
      criteria: {
        '1': 'States that the Hessian condition is required across the set, not at one point.',
        '2': 'Explains why a pointwise check is not enough — convexity is a statement about the whole set.',
        '3': 'Gives a concrete case where PSD at a point coexists with non-convexity nearby.',
        '4': 'Separates this from the second-order condition for a local minimum and says which is which.',
      },
      misconceptions: [
        { id: 'M3a', text: 'Conflates the convexity test with the second-order optimality condition at a stationary point.' },
        { id: 'M3b', text: 'Believes PSD at a minimum implies convexity on a neighbourhood.' },
      ],
      probe_seeds: {
        clarification: 'Where exactly does the Hessian have to be PSD for your sentence to be true?',
        reasons_evidence: 'What goes wrong if it is PSD at one point and indefinite just next to it?',
        assumptions: 'You checked it at the stationary point. What made that the right place to check?',
        implications: 'Give me a function on ℝ where the Hessian is PSD at a point and f is not convex near it.',
        alternatives: 'Is there a version of your claim that is true pointwise? What would it be about?',
      },
    },
  ],
};

export const FIXED_PACKS: Record<string, ConceptPack> = {
  [PSD_HESSIAN_CONVEXITY_V1.concept_id]: PSD_HESSIAN_CONVEXITY_V1,
  // The Critique 1 deck's pack (#32): the A1 video is filmed on it, so a session started from
  // that file must be able to name it by `conceptId` rather than eliciting claims on camera.
  [BTW_SIDE_CHANNEL_V1.concept_id]: BTW_SIDE_CHANNEL_V1,
};

/** The slide text the demo session is pinned to (product-design.md §B2/§B3 source pane). */
export const PSD_HESSIAN_SLIDE_TEXT = `Second-order condition for convexity

Let f be twice continuously differentiable on an open convex set S ⊆ ℝⁿ.
Then f is convex on S if and only if the Hessian ∇²f(x) is positive semidefinite
for every x ∈ S.

Positive semidefinite: a symmetric matrix H is PSD when zᵀHz ≥ 0 for all z ∈ ℝⁿ.

Remark. The condition is required at every point of S. Positive semidefiniteness of
∇²f at a single point — for instance at a stationary point — does not imply convexity
on any neighbourhood of that point.`;

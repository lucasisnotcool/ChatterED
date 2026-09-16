/**
 * The REFERENCE voice — **register, not disguise**.
 *
 * `pivot-spec.md` §B1 and `flow-build-plan.md` §4.3: an "+ Ask here" answer is authored by
 * *the system*, not by Ellie or Max. The argument is a contract argument, not an aesthetic one.
 * Ellie may never hand over the explanation the learner is about to be asked for and Max may
 * never state the answer he is fishing for; if the inserted answer wore either face, every
 * subsequent turn from that agent would be read against a broken persona contract. A neutral
 * voice keeps both intact and makes the difference between *what the machine knows* and *what my
 * study partners think* structural rather than tonal.
 *
 * It is kept in its own module for the same reason `prompts.whisper.ts` is: so that nothing on
 * the group path imports it, and so the one rule that matters here — it may borrow the deck's
 * register and may never borrow its appearance — is stated in one place.
 *
 * The **120-word cap is not in this prompt**. It is applied in `reference.ts`, in code, because
 * a cap a model is asked to respect is a cap that will be exceeded on camera.
 */

import type { AskScope } from '../shared/scope.js';

export const REFERENCE_LABEL = 'REFERENCE';

export interface ReferenceBlockInput {
  deckTitle: string;
  /**
   * What the question is about (issue #35). `'segment'` sends the page and the outline;
   * `'deck'` sends the outline and the whole document. The difference is not tone — it is what
   * the model is allowed to have read, and the card's footer says which it was.
   */
  scope: AskScope;
  /** The passage: one page for a segment question, the whole document for a deck question. */
  passageText: string;
  /** The deck's own table of contents, when it has one. `''` for pasted text. */
  outline?: string;
  /** Set on the retrieval fallback, so the prompt can say the passage is not the whole file. */
  retrievedPages?: number[];
}

export function referenceSystemBlock(input: ReferenceBlockInput): string {
  const outline = input.outline?.trim() ?? '';
  /**
   * **The outline goes to both scopes, and it is why.** A page answer that can see the deck's
   * table of contents can say *where the page sits* — "this is the admissibility slide, before
   * A* on p. 22" — without being given the other fifty-seven pages to wander into
   * (`whole-file-context.md` §4 recommendation 3). It is a locator, not a source, and the
   * paragraph below says so in those words, because a model handed a list of headings will
   * otherwise answer from the headings.
   */
  const outlineBlock = outline
    ? `\nTHE OUTLINE OF THE DOCUMENT (for locating the passage, not for answering from):\n${outline}\n`
    : '';

  const passageHeading =
    input.scope === 'deck'
      ? input.retrievedPages && input.retrievedPages.length > 0
        ? `THE PASSAGES (pages ${input.retrievedPages.join(', ')} of this document, selected because they bear on the question):`
        : 'THE DOCUMENT, IN FULL:'
      : 'THE PASSAGE:';

  /**
   * The one instruction that differs by scope. A deck question wants the shape of the whole
   * thing and is allowed to name parts of it; a page question is still answered from the page,
   * and the outline is only there so the answer can place it.
   */
  const scopeRule =
    input.scope === 'deck'
      ? `WHAT YOU HAVE BEEN GIVEN.
The whole of the learner's document. The question is about the document as a whole, so answer
it from the whole: name the topics it actually covers, in the document's own words, and where
it helps say roughly where in it they sit. Do not answer from the outline alone — the outline
says what the headings are, and the text says what they mean. Do not list every heading; say
what the document is about.`
      : `WHAT YOU HAVE BEEN GIVEN.
One passage of the learner's document — the part they asked on — and the document's outline.
Answer from the passage. The outline is there only so that you can say where this passage sits
if that is part of the answer; it is not a source, and you may not answer from a heading you
have not been given the text of.`;

  return `You are the reference voice of a study application. You are not a person and you are not
one of the learner's study partners. You answer a factual question about the learner's own
lecture material, and nothing else.

REGISTER, NOT DISGUISE.
You may adopt the material's vocabulary, its notation, its symbols and its level of formality,
so that the answer reads as continuous with the page rather than as a translation of it.
You may not adopt its appearance, wear a persona, use "I" or "we", address the learner as
"you", greet them, encourage them, or ask them a question. You never speak in the first person
and you never speak in the second person.

${scopeRule}

WHAT YOU DO.
State the definition, the distinction or the fact that answers the question, in the terms the
material itself uses. Prefer the general statement to a worked example. If the material's own
wording settles the question, use that wording.

WHAT YOU DO NOT DO.
- You do not explain what the learner is about to be asked to explain. Answer what was asked;
  do not extend it into a tutorial.
- You do not evaluate the question, the learner, or the material.
- You do not refer to the study partners, to this application, or to yourself.
- You do not end with a question, an offer, or a next step. A hand-back line is appended by the
  application; do not write one.

Write prose. One paragraph, no headings, no bullet list, no sign-off.

THE MATERIAL THIS QUESTION IS ABOUT: ${input.deckTitle}
${outlineBlock}
${passageHeading}
${input.passageText}`;
}

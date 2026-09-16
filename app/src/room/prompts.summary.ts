/**
 * **The summary card's voice** (issue #41, `conversation-refinement.md` §5).
 *
 * Lucas's second and third points in #41 are one feature: *"for artefact creation and generation,
 * this should be provided as a button, which will create a slide / segment that basically
 * summarises what was taught in that conversational chain. the concept is that these artifacts /
 * references help the user to review and recall, without having to go through the conversation
 * again."*
 *
 * So the one rule that matters here is **written from the thread, not from the slide**. A summary
 * of the slide is already on the slide; the learner has it, and they did not ask a question about
 * it for nothing. What they want back later is what *this conversation* established — the
 * prerequisite Ellie had to teach first, the analogy that made it land, the misreading that was
 * corrected — and a model handed a deck and a transcript will summarise the deck unless told
 * otherwise, because that is the easier document.
 *
 * It keeps the REFERENCE register of `pivot-spec.md` §B1, and for §B1's own reason: this is a
 * durable block in the learner's document, not a turn in a conversation, so it wears no persona,
 * uses no "I", and addresses nobody. The entry card that argument was written for is retired
 * (#41); the argument itself was always about the *artefact*, and the artefact is this.
 *
 * The **150-word cap is not in this prompt**. It is applied in `summary.ts`, in code, for the same
 * reason §B1's 120 was: a cap a model is asked to respect is a cap that is exceeded on camera.
 */

export interface SummaryBlockInput {
  /** The deck, so the card can use its vocabulary. */
  deckTitle: string;
  /** The learner's label for the segment this thread hangs off, when it has one. */
  segmentLabel?: string | null;
  page?: number | null;
}

export function summarySystemBlock(input: SummaryBlockInput): string {
  const where =
    input.page === null || input.page === undefined
      ? input.segmentLabel?.trim()
        ? `the part of the document the learner labelled “${input.segmentLabel.trim()}”`
        : 'one part of the document'
      : input.segmentLabel?.trim()
        ? `p. ${input.page} of the document, which the learner labelled “${input.segmentLabel.trim()}”`
        : `p. ${input.page} of the document`;

  return `You are the reference voice of a study application. You are not a person and you are not
one of the learner's study partners. You are writing one block that will be inserted into the
learner's own lecture document, under ${where}, and read weeks later by the learner alone.

WHAT YOU ARE SUMMARISING.
A conversation that happened under that part of the document: the learner's questions and the
teacher's answers, in order, below. **Summarise the conversation, not the slide.** The slide is
still there and the learner can read it; what they cannot get back without scrolling through the
whole exchange is what this conversation established — the thing that was explained, the
prerequisite that had to be taught first, the example or analogy that made it land, the
misreading that was corrected. Write that down.

If the conversation settled nothing — small talk, a question that was never answered — say so in
one sentence rather than inventing a conclusion.

REGISTER, NOT DISGUISE.
You may adopt the material's vocabulary, its notation and its level of formality, so that the
block reads as continuous with the document. You may not adopt its appearance, wear a persona,
use "I" or "we", address the learner as "you", greet them, or ask them a question. Do not name
the teacher or the tester, and do not narrate the conversation ("Ellie explained that…"). State
what was established, as the document would state it.

WHAT YOU DO NOT DO.
- You do not add anything the conversation did not contain. This is a record, not a lesson.
- You do not evaluate the learner, the conversation or the material.
- You do not end with a question, an offer, or a next step.

Write prose, short, in at most two paragraphs. A numbered or bulleted list is allowed and is
often right when the conversation established several separate things. Maths typesets: $…$
inline, $$…$$ on its own line. No headings, no tables, no links, no code fences, no HTML.

THE DOCUMENT THIS CONVERSATION WAS ABOUT: ${input.deckTitle}`;
}

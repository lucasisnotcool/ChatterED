/**
 * **The collab doc's prompt blocks** (#48, `docs/research/collab-doc.md` §4 and §5).
 *
 * They live beside `prompts.ts` rather than in it for the reason `prompts.ledger.ts` and
 * `prompts.summary.ts` do: these are the words of turns the collab-doc brief invented, and keeping
 * them together makes the brief and the prompt readable against each other. `turnDirective` is
 * still the one thing appended after the last cache breakpoint; what this file exports is what it
 * appends.
 *
 * Two of these are **structured** calls rather than prose, and both for the same reason
 * (architect §E6): a fact the closure rule has to check may not be a sentence a model was asked
 * to self-report in. Ellie's cue reports whether it planted a mistake and what the claim was; the
 * doc-edit planner reports an edit or the block that already says it.
 *
 * The register split is the thing to get right here. Ellie is the **Teacher** everywhere else in
 * the app — she answers in full, she explains from the slide, she is the one who knows. In §4.3
 * she is a **peer**: unsure, partial, hedged, possibly wrong. Two registers for one agent is a
 * real risk to the interaction — a learner who reads the guess as teaching has been taught
 * something false — so the prompt says the difference out loud, the thread tags the turn *Ellie's
 * guess*, and the cue is **never written to the doc**.
 */
import type { AgentProfile } from '../shared/types.js';
import { teacherName, testerName } from './agents.js';
import { VERDICT_OPENERS } from './flow.js';
import { NO_REMARKS } from './prompts.js';

// ── §4.2 row 1, first turn: Ellie answers ──────────────────────────────────

/**
 * What Ellie's answer owes the doc chat.
 *
 * **The chat holds the short half; the notes hold the long half** (2026-09-23, A1 report §1.4 and
 * DG4: *"Replies in chat are kept short while longer explainers are written into notes"*). Until
 * this date the chat was held to `attempt-first.md` §4's ~120 / 180 words and the notes got
 * whatever `planAnswerEdit` condensed out of the reply — so on the live app the lengths ran the
 * wrong way: chat replies at a median of 202 words, notes additions at ~80. The five-step shape
 * the Teacher is given cannot fit 120 words and it won every time.
 *
 * So in the doc chat the shape is **split**: the answer, the plain meaning and one example go in
 * the chat; the rigorous version and how the slide uses it are written into the notes by the
 * §5.1 edit, which is now given the question and the slide rather than only the reply. When the
 * notes are **frozen** nothing reaches them, so `notesTakeTheRest: false` gives her the full
 * answer back.
 */
export function ellieAnswersBlock(input: { page?: number | null; notesTakeTheRest?: boolean } = {}): string {
  const lines =
    input.notesTakeTheRest === false
      ? [
          'THIS IS THE DOC CHAT',
          'Answer what they asked, in full, in your first sentence — then teach it. About 120 words,',
          'ceiling 180. The notes are frozen, so this answer is the whole of it.',
          'Do not end on a question. Max asks the next one.',
        ]
      : [
          'THIS IS THE DOC CHAT — SHORT HERE, THE REST GOES INTO THE NOTES',
          '**About 60 words, ceiling 90.** This replaces the lengths in house rule 3 and the five-step',
          'shape for this turn. Say, in this order and nothing more:',
          '  1. the answer to what they asked, in your first sentence;',
          '  2. what it means in plain words, no notation;',
          '  3. one concrete example or analogy, in a sentence.',
          'As running prose: no labels on the parts ("Plainly:", "Analogy:"), no headings, no list.',
          'The rigorous version, the conditions and how the slide uses it are written into the notes',
          'beside where they asked, separately from this reply — **do not write them here**, and do not',
          'say that you are adding anything to the notes.',
          'Do not end on a question. Max asks the next one.',
        ];
  /**
   * **Answers stay anchored** (interview finding, `docs/research/interviews/findings.md` §6). All
   * three interviewees described the same drift: rounds of clarification that end up somewhere
   * the slide never was, with no way back. The fix is cheap and it is a prompt-level one — name
   * the page each answer is about — and it pairs with the code-level half in `docedit.ts`, where
   * a span thread's edit is pinned to that span's own block.
   */
  if (typeof input.page === 'number') {
    lines.push(
      `**Say which slide this is about**: name \`p. ${input.page}\` in the answer, and if you have to`,
      'reach elsewhere in the deck to explain it, come back and land it there.',
    );
  } else {
    lines.push(
      '**Say which slide this is about** as `p. N` somewhere in the answer. An answer with no page',
      'on it is one the learner cannot check, and three rounds later neither of you knows where it',
      'started.',
    );
  }
  return lines.join('\n');
}

/**
 * **What the learner has written in their own notes, near where they asked** (interview finding,
 * `findings.md` §6).
 *
 * One interviewee's central complaint was that what he writes down is *never registered to the
 * AI*: he takes notes, the assistant never reads them, and every answer starts from nothing. The
 * doc makes that fixable for the first time, because the learner's own spans are marked in the
 * document model (`author.by === 'user'`) and the outline says which blocks carry them.
 *
 * So they go into the context, labelled as theirs, with one instruction: **build on it, do not
 * repeat it**. A reply that re-explains what the learner has already written down correctly is
 * the same failure in a new place.
 */
export function learnerNotesBlock(
  notes: readonly { blockId: string; text: string; pages: readonly number[] }[],
): string | undefined {
  if (notes.length === 0) return undefined;
  const lines = [
    'WHAT THE LEARNER HAS WRITTEN IN THEIR OWN NOTES, HERE',
    'These are **their** words, in the document, beside the part they are asking about:',
  ];
  for (const note of notes) {
    const where = note.pages.length > 0 ? ` (p. ${note.pages.join(', ')})` : '';
    lines.push(`- ${note.text}${where}`);
  }
  lines.push(
    'Build on this rather than repeating it. If it is right, say so in a clause and go past it; if',
    'it is wrong or half-right, correct that specific thing. Do not re-explain what they have',
    'already got down — that is the failure they complained about in the first place.',
    '**Never rewrite their words.** They are theirs.',
  );
  return lines.join('\n');
}

// ── §4.2 row 1, second turn: rule:max_followup ─────────────────────────────

/**
 * **One Socratic follow-up, on something the answer touched that the learner has not shown.**
 *
 * The objective is picked in code (lowest ledger level first, the same pick `+ Try this` used),
 * and how hard it is comes from `pitch.pitchBlock`. What is left for the prompt is the shape: one
 * question, about what they have just been told, answerable in their own words — and emphatically
 * not a comprehension check on the sentence Ellie just wrote, which is the failure mode of a
 * follow-up generated straight off an answer.
 */
export function maxFollowupBlock(input: {
  objectiveLabel: string | null;
  /** Every question already asked on this file, so a session cannot circle (interview finding). */
  askedBefore?: readonly string[];
}): string {
  const about = input.objectiveLabel ? ` It is about: ${input.objectiveLabel}.` : '';
  const lines = [
    'ASK ONE FOLLOW-UP QUESTION',
    `Ellie has just answered the learner’s question.${about} Ask **one** question that makes them`,
    'use what they have just read — in their own words, or applied to a case.',
    'Not a comprehension check on Ellie’s sentence ("what did she mean by X?"), and not two',
    'questions. Two sentences at most, and the last one is the question.',
    'Do not answer it, and do not hint at the answer.',
    '',
    /**
     * **Only what they now have** (#49). The 2026-09-23 run: Ellie answered what separates
     * search-, SAT- and graph-based planning, the page (p. 7) says only *"Encode as SAT (CNF)"*, and
     * Max asked the learner to write the CNF variables and clauses for the air-cargo problem — a
     * construction neither the page nor the answer had given them. The learner had to ask for the
     * format before they could begin, and then gave up.
     */
    '**Answerable from what they now have.** The learner must be able to answer from the page and',
    'Ellie’s answer alone. If answering needs a method, a notation or a format that neither of them',
    'gave the learner — building an encoding the page only names, a derivation the slide does not',
    'show — it is too far: ask about what the page and the answer actually say.',
  ];
  /**
   * **Two interview findings, both about the same decay** (`findings.md` §6). One interviewee said
   * AI quiz quality drops through a long session and the answers become obvious; another asked
   * for *"easier questions first… a progression"* (which is `pitchBlock`'s job, and this is the
   * other half).
   *
   * An obvious question is one whose answer is readable off its own wording, and a circling
   * session is one that re-asks what it has already asked in new words. Neither is something a
   * model can avoid without being told what it has already asked — so it is told.
   */
  const asked = (input.askedBefore ?? []).filter((q) => q.trim().length > 0);
  if (asked.length > 0) {
    lines.push(
      '',
      'YOU HAVE ALREADY ASKED, ON THIS FILE:',
      ...asked.map((q) => `- ${q}`),
      'Do not ask any of these again, and do not ask a rephrasing of one. If the only question left',
      'on this objective would be a rephrasing, move to a different angle on it.',
    );
  }
  lines.push(
    '',
    '**The answer must not be readable off the question.** No question that contains its own answer,',
    'no yes/no, no "is it X or Y?" where one of them is obviously wrong. If reading your question',
    'aloud would tell them the answer, ask a different one.',
  );
  return lines.join('\n');
}

// ── §4.3: Ellie's cue, and Max's prompt ────────────────────────────────────

/**
 * The structured shape of Ellie's cue (architect §E6).
 *
 * `has_mistake` and `claim` are what make §4.7's second invariant enforceable: *"If Ellie's cue
 * contained a mistake and the thread ends by any path, the resolving Max turn corrects it
 * explicitly."* Asked for as fields, they are facts on `PendingQuiz` that the closure rule can
 * check; asked for in prose, they would be a model marking its own homework.
 */
export const ELLIE_CUE_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['text', 'has_mistake'],
  additionalProperties: false,
  properties: {
    text: {
      type: 'string',
      description:
        'What Ellie says, at most 60 words. Hedged, partial, in the first person. Never the full answer.',
    },
    has_mistake: {
      type: 'boolean',
      description: 'True if this take contains a plausible mistake of the kind a student makes.',
    },
    claim: {
      type: ['string', 'null'],
      description:
        'When has_mistake is true: the wrong claim, in one clause, so it can be corrected later. Null otherwise.',
    },
  },
};

/**
 * **A peer, not the Teacher** (§4.3 step 1). The instruction that matters most is the one about
 * register, and it is stated as a contrast because that is the only way a model that has just read
 * Ellie's Teacher role block will hear it.
 *
 * The mistake is **optional and permitted**, not required: a cue that must be wrong is a cue that
 * will be wrong in a way no student would be. §1 of the brief lists the risk it takes on (*"a
 * learner who reads it and leaves"*) and names the mitigation (§4.7's closure rule), which is why
 * `has_mistake` is reported rather than guessed at afterwards.
 */
export function ellieCueBlock(input: { question: string; roster: readonly AgentProfile[] }): string {
  const max = testerName(input.roster);
  return [
    'YOU ARE THINKING ALOUD AS A PEER, NOT TEACHING',
    `${max} asked the learner a question and they have gone quiet. You are not stepping in to`,
    'answer it for them. You are doing what a classmate does: saying what you *think* it might be,',
    'out loud, so there is something on the table to argue with.',
    '',
    `The question was: ${input.question}`,
    '',
    'Hard limits, all of them:',
    '- **At most 60 words.**',
    '- Hedged, and in the first person: "I think…", "isn’t it something like…", "I’d probably say…".',
    '- **Part of it right, and never the whole of it.** You may leave out the half that matters.',
    '- You may include **one** plausible mistake — the kind a student makes, not a silly one. If',
    '  you do, set `has_mistake` and put the wrong claim in `claim`, in one clause.',
    `- Never the full correct answer. ${max} has not marked anything yet and you are not marking it.`,
    '- No question at the end. You are offering something, not asking for something.',
    '',
    'Your role everywhere else in this app is the teacher, and this turn is not that. Do not',
    'explain, do not open with a definition, and do not land it. Say the unsure thing and stop.',
  ].join('\n');
}

/**
 * **Max answers Ellie, aimed at the learner** (§4.3 step 2). The whole of the design decision is
 * in "aimed at the learner": a Tester who talks to Ellie about Ellie's answer has turned the
 * learner into an audience, which is the failure the MASG brief is about.
 */
export function maxPromptBlock(input: { guess: string; roster: readonly AgentProfile[] }): string {
  const ellie = teacherName(input.roster);
  return [
    'RESPOND TO THE GUESS — AIMED AT THE LEARNER',
    `${ellie} has just offered an unsure take on your question:`,
    '"""',
    input.guess,
    '"""',
    '',
    '**Do not confirm it and do not correct it yet.** Name the one part of it worth looking at, and',
    `ask the learner either to improve on it or to say whether ${ellie} is right.`,
    '',
    'Hard limits:',
    '- **At most 50 words.**',
    '- Talk to the learner, not to her. Second person.',
    '- Do not give the answer, do not say which part is wrong, and do not add a hint of your own.',
    '- Your question is still open. Leave it open.',
  ].join('\n');
}

// ── §4.4 and §4.7: releasing the answer ────────────────────────────────────

/**
 * **The released answer** (§4.4): *"Max gives the full answer with grounds, says what any earlier
 * attempt had of it, and corrects Ellie's guess if she made one."*
 *
 * It is given the same way whether the learner gave up, pressed Pass, or the sitting went idle —
 * the difference is one clause of framing, because a release at closure is the app paying a debt
 * and a release on a give-up is the learner deciding they are done. Neither is a reprimand, and
 * the prompt says so: a released answer that reads as disappointed is the surest way to stop the
 * next give-up being honest.
 */
export function releaseBlock(input: {
  releasedBy: 'give_up' | 'pass' | 'closure';
  attempts: number;
  /** §4.7: the claim Ellie's cue got wrong, when it made one. */
  cueClaim: string | null;
  roster: readonly AgentProfile[];
}): string {
  const ellie = teacherName(input.roster);
  const lines = ['GIVE THE ANSWER'];
  if (input.releasedBy === 'closure') {
    lines.push(
      'This question has been sitting open and the session has gone quiet. No question you asked is',
      'left without its answer, so give it now, unprompted and without remarking on the delay.',
    );
  } else if (input.releasedBy === 'pass') {
    lines.push('The learner pressed Pass on this question. That is theirs to press.');
  } else {
    lines.push('The learner has said they are done with this one. That is theirs to say.');
  }
  lines.push(
    'Give the answer to **the question you asked**, in full, under 150 words. No new question, and',
    'do not withhold any part of it.',
  );
  if (input.attempts > 0) {
    lines.push(
      'They did attempt it. One sentence on what their attempt already had of the answer — what they',
      'had, not what they missed. If nothing they wrote was an answer to it, leave that sentence out.',
    );
  }
  lines.push(NO_REMARKS);
  if (input.cueClaim) lines.push(...cueCorrectionLines(input.cueClaim, ellie));
  lines.push(
    'No reproach, no "as I said", no sigh. A learner who expects to be marked down for giving up',
    'stops giving up honestly, and the next thing they do is guess.',
  );
  return lines.join('\n');
}

/**
 * **§4.7's second invariant, as a directive clause.** *"No mistake Ellie made is left
 * uncorrected."* It goes on whichever Max turn resolves the question — feedback, release or
 * closure — and the actor asserts that it did, because that is the only half of the invariant
 * code can enforce: the prompt is asked, the check is that it was asked.
 */
export function cueCorrectionLines(claim: string, ellieName: string): string[] {
  return [
    `**Correct ${ellieName}’s guess explicitly.** She said, in effect: "${claim}" — and that is wrong.`,
    'Say so in one clause, say what is right instead, and do not let it stand as if nobody had',
    'noticed. She was thinking aloud as a classmate; being wrong out loud is the point of that, and',
    'leaving it uncorrected is the one thing it must not cost.',
  ];
}

// ── §6: the lesson card's Start ────────────────────────────────────────────

/**
 * **Start**, on a lesson card (§6): *"posts an Ellie message in the doc chat announcing what we
 * need to understand and the objective… has Ellie prompt the learner to ask a question to begin."*
 *
 * It teaches nothing, and that is deliberate — the brief has the learner *ask* to begin, which is
 * the one behaviour every studied session already had (R1, R3, R4 all open by asking) and the one
 * the app should not take away from them by lecturing first.
 */
export function lessonStartBlock(input: {
  title: string;
  statement: string;
  criteria: readonly string[];
  pages: readonly number[];
}): string {
  const lines = [
    'THE LEARNER PRESSED START ON A LESSON',
    `It is: ${input.title}`,
    input.statement,
  ];
  const criteria = input.criteria.filter((c) => c.trim().length > 0);
  if (criteria.length > 0) {
    lines.push('By the end they should be able to:', ...criteria.map((c) => `- ${c}`));
  }
  if (input.pages.length > 0) {
    lines.push(`The notes for it are on ${input.pages.length === 1 ? 'p.' : 'pp.'} ${input.pages.join(', ')}.`);
  }
  lines.push(
    '',
    'Say in two or three sentences what this is and why it is worth understanding — no more.',
    '**Do not teach it yet.** End by asking them to ask you something about it to begin: name one',
    'or two things they could ask, so the invitation is concrete rather than "any questions?".',
  );
  return lines.join('\n');
}

// ── §4.2 row 3: @Max ───────────────────────────────────────────────────────

/** The learner named Max. He answers, and does not take it as a licence to start quizzing. */
export function mentionReplyBlock(): string {
  return [
    'THE LEARNER ADDRESSED YOU DIRECTLY',
    'Answer what they asked you, in your own register — you are the tester, so you may say what you',
    'would want to see in an answer, and what you would push on.',
    'Under 120 words. **Do not ask a new question** unless they asked you for one: they called you',
    'over, they did not volunteer.',
  ].join('\n');
}

// ── §6: the learner's own doc text, assessed ───────────────────────────────

/**
 * **The learner wrote in the doc, and it counts** (§6, architect §E4).
 *
 * It reaches Max as a synthetic `doc_text` learner message in the span's thread, so every ledger
 * rule applies untouched — verbatim evidence, the eight-word floor, agreement-is-not-evidence.
 * The feedback is the ordinary feedback turn; what this block adds is the two things that are
 * different about the surface it came from.
 */
export function docTextBlock(input: { blockQuote: string }): string {
  return [
    'THIS ANSWER WAS WRITTEN IN THE DOCUMENT, NOT IN THE CHAT',
    'The learner wrote this in their own notes:',
    '"""',
    input.blockQuote,
    '"""',
    'Mark it exactly as you would mark an answer typed in the chat, with the same verdict opener.',
    `(${VERDICT_OPENERS.join(' / ')})`,
    'If the **text itself** needs correcting, say what the corrected sentence should read — quoting',
    'the part of their own wording that has to change, word for word, so it can be offered to them',
    'as a suggestion they accept or reject. Never rewrite it over their heads.',
  ].join('\n');
}

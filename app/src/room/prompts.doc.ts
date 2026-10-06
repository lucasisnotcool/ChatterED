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
import { NO_REMARKS, NOT_READABLE_OFF } from './prompts.js';
import { PARTIALS_BEFORE_SHOW_ME } from '../core/pitch.js';

// ── §4.2 row 1, first turn: Ellie answers ──────────────────────────────────

/**
 * What Ellie's answer owes the doc chat.
 *
 * **The whole answer, in the chat** (`notebooks.md` §4.2, contract C7, 1 Oct 2026). From
 * 2026-09-23 to this date the doc chat held the short half (~60 words, ceiling 90) and the §5.1
 * edit wrote the long half into the notes. Lucas reversed it: *"the answer usually does not fit
 * verbosely into the doc, so need two separate outputs for explaining to user vs. doc edit."* So
 * the chat gets the full Teacher answer at the usual size (about 120, ceiling 180), and the notes
 * get one line of at most 25 words, written by a separate call (`docedit.planBlockNote`) after
 * this reply has gone out. The code, not this turn, says that a line was added, and only when it
 * was, so the turn must not.
 *
 * `maxFollows` is the #48 loop (`maxOnlyOnRequest: false`), where Max's follow-up comes next and
 * Ellie leaves the question to him. Under `notebooks.md` §5.2 nobody asks next unless the learner
 * presses Quiz me, and the line says only what she must not do.
 */
export function ellieAnswersBlock(input: { page?: number | null; maxFollows?: boolean } = {}): string {
  const lines = [
    'THIS IS THE DOC CHAT',
    'Answer what they asked, in full, in your first sentence — then teach it. About 120 words,',
    'ceiling 180. This answer is the whole of it. Do not say that you are adding anything to the',
    'notes; the app does that itself.',
    input.maxFollows === true ? 'Do not end on a question. Max asks the next one.' : 'Do not end on a question.',
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
      `**Say which slide this is about**: name p. ${input.page} in the answer, and if you have to`,
      'reach elsewhere in the deck to explain it, come back and land it there.',
    );
  } else {
    lines.push(
      '**Say which slide this is about** as p. N somewhere in the answer. An answer with no page',
      'on it is one the learner cannot check, and three rounds later neither of you knows where it',
      'started.',
    );
  }
  return lines.join('\n');
}

// ── notebooks §4: Explain and Example on a block ──────────────────────────

/**
 * **Explain** and **Example** on a block of the overview (`notebooks.md` §4.1, contract C7).
 *
 * The chat half of the two outputs: Ellie's full answer, in the block's span thread. The doc half
 * is a separate call (`docedit.planBlockNote`) for one line under the block, so nothing here is
 * squeezed to fit the notes and nothing here mentions them. The block's slide text reaches the
 * turn as the *where* block in front of this one; this says what the button asked for.
 *
 * - **Explain** is the Teacher's usual shape (`turnDirective`'s answer-first, then teach) at the
 *   usual size: about 120 words, ceiling 180, grounded in the slide pages.
 * - **Example** is one worked example, the slide's own when it has one, then one sentence on
 *   what it shows: the overview is scaffolding (§3.3), and the worked case is what this is for.
 *
 * **Never a question at the end**, in either: §5.2 has Max ask only when the learner presses Quiz
 * me, and a Teacher who ends on one is asking in his place.
 */
export function blockActionBlock(input: { kind: 'explain' | 'example'; quote: string; page?: number | null }): string {
  const lines = [
    input.kind === 'explain'
      ? 'THE LEARNER PRESSED EXPLAIN ON THIS LINE OF THEIR NOTES'
      : 'THE LEARNER PRESSED EXAMPLE ON THIS LINE OF THEIR NOTES',
    '"""',
    input.quote.trim(),
    '"""',
  ];
  if (input.kind === 'explain') {
    lines.push(
      'Explain it in full: what it says, in your first sentence; what it means in plain words; then the',
      'rigorous version and how the source uses it, in its own notation. An example or analogy only',
      'when the line is abstract enough to need one, and then one sentence of it: a method or a result',
      'is better shown with the source’s own numbers than with an analogy. **About 120 words, 150 at',
      'most.** Ground it in the page text above and cite it as p. N.',
    );
  } else {
    lines.push(
      'Work **one** example of it. Use the slide’s own example when it has one and say which page it',
      'is on as p. N; when it has none, one small case of your own that the slide equips them for.',
      'Go through it step by step, then end with **one sentence** on what the example shows about this',
      'line. **About 120 words, ceiling 180.**',
    );
  }
  lines.push(
    'Start with the substance: no greeting, no "Great question", and do not restate the line first.',
    'Do not say that you are adding anything to the notes; the app does that itself.',
    '**Do not end on a question, and ask them nothing.** Max asks only when they press Quiz me.',
  );
  if (typeof input.page === 'number') {
    lines.push(`This line is on p. ${input.page}: name it, and if you reach elsewhere in the deck, land it back there.`);
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
  /**
   * **The follow-up is a fill-in-the-blank** (§4.5, amended 2026-10-01): the last question on this
   * objective ended in a release. Everything this block says about own words and about an answer
   * not being readable off the question is the opposite of a blank, so the cloze gets a block of
   * its own and `pitchBlock` says how the blank is written.
   */
  cloze?: boolean;
}): string {
  const about = input.objectiveLabel ? ` It is about: ${input.objectiveLabel}.` : '';
  if (input.cloze === true) {
    const already = (input.askedBefore ?? []).filter((q) => q.trim().length > 0);
    return [
      'ASK ONE FILL-IN-THE-BLANK',
      `Ellie has just answered the learner’s question.${about} The last question on this objective`,
      'ended with the answer being given, so this one is small: one sentence the page says, with one',
      'key term for them to supply. The block below says exactly how to write it.',
      'The sentence must be one they can complete from the page and Ellie’s answer alone, and the',
      'term must matter: if the blank could be filled by a word that teaches nothing, pick another',
      'sentence. Do not give the term, its first letter, or a list to choose from.',
      ...(already.length > 0
        ? [
            '',
            'YOU HAVE ALREADY ASKED, ON THIS FILE:',
            ...already.map((q) => `- ${q}`),
            'Do not blank a sentence you have already used.',
          ]
        : []),
    ].join('\n');
  }
  const lines = [
    'ASK ONE FOLLOW-UP QUESTION',
    `Ellie has just answered the learner’s question.${about} Ask **one** question that makes them`,
    'use what they have just read — in their own words, or applied to a case the page or Ellie’s',
    'answer works through.',
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

/**
 * **The blank gave its answer away; write the turn again** (2026-10-06 decision, the
 * `notebooks.md` / `collab-doc.md` amendment, D3). `core/pitch.blankGiveaway` found the blank's
 * term readable off the screen, so the turn is generated once more with what to leave out. If the
 * second draft gives it away too, the third is asked for with `open: true`: no blank at all, one
 * open question instead, because a blank on that point keeps being one the learner can read back.
 */
export function blankGivenAwayBlock(input: {
  kind: 'sentence' | 'term' | 'mirror';
  term: string | null;
  quoted: string;
  open: boolean;
}): string {
  const term = input.term?.trim() ? `"${input.term.trim()}"` : null;
  const why =
    input.kind === 'mirror'
      ? `The sentence "${input.quoted}" is on screen and mirrors the one you blanked${term ? `, filling its gap with ${term}` : ''}.`
      : input.kind === 'term'
        ? `The blanked term${term ? ` ${term}` : ''} is already on screen, in "${input.quoted}".`
        : `The sentence you blanked is already on screen whole, in "${input.quoted}", so the blank is filled by reading it back.`;
  const lines = [
    input.open ? 'NO FILL-IN-THE-BLANK THIS TIME' : 'YOUR LAST DRAFT GAVE THE BLANK AWAY',
    why,
    `Write the turn again. Do not quote that sentence${term ? `, and do not use ${term}` : ''} anywhere in it.`,
  ];
  if (input.open) {
    lines.push(
      'A blank on this point keeps giving its answer away, so do not write one: no "Fill in the blank",',
      'no ____. End instead on one short open question about the part that is still missing, for them to',
      'answer in their own words.',
      NOT_READABLE_OFF,
    );
  } else {
    lines.push('Blank a sentence that is not on screen, or a different term, so the learner has to recall it.');
  }
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
    '  you do, set `has_mistake` and put the wrong claim in `claim`, in one clause. A mistake is a',
    '  claim the page contradicts. Being unsure is not one: if everything you said is true, however',
    '  hedged, `has_mistake` is false.',
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
    `**Correct ${ellieName}’s guess explicitly, once.** She said, in effect: "${claim}", and flagged`,
    'it as her mistake. Say in one clause what is wrong with it and what is right instead, and do not',
    'let it stand as if nobody had noticed. She was thinking aloud as a classmate; being wrong out',
    'loud is the point of that, and leaving it uncorrected is the one thing it must not cost.',
    /**
     * **Unless the page says she was right** (live run, 2026-10-03). Her flagged claim, that "P1 at
     * SFO" comes from the problem's `:init`, was true, and "and that is wrong" had Max argue a
     * distinction the deck does not draw, in six turns running.
     */
    'If the page shows the claim is in fact right, say she was right instead; never invent a fault.',
  ];
}

// ── §6: the lesson card's Start ────────────────────────────────────────────

/**
 * **Start**, on a lesson card (§6, revised 2026-10-01 and again 2026-10-06, D2): Ellie walks the
 * learner through the section, and nobody asks.
 *
 * From 1 Oct a lesson opened on Max's first question, asked within seconds of Ellie's two-sentence
 * introduction. In the 10-03 to 10-05 runs all 30 quizzes came that way, the learner never pressed
 * Quiz me, and the cold openers were the unready ones. So Start now teaches: Ellie takes the learner
 * through what the notes say on it, in order, from the notes and the slides, and asks nothing.
 * The check is offered later, by code, when the learner has worked on the section
 * (`core/readiness`), and the learner presses it.
 */
export function lessonStartBlock(input: {
  title: string;
  statement: string;
  criteria: readonly string[];
  pages: readonly number[];
  /** The section of the notes this lesson is, as text, for her to walk through. */
  section?: string | null;
  /** Max already has a question open (one at a time, §5.2): she points back to it at the end. */
  maxQuestionOpen?: boolean;
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
    lines.push(`The slides for it are ${input.pages.length === 1 ? 'p.' : 'pp.'} ${input.pages.join(', ')}.`);
  }
  const section = input.section?.trim() ?? '';
  if (section.length > 0) {
    lines.push('THE NOTES FOR IT, AS THE LEARNER SEES THEM', '"""', section.slice(0, 4_000), '"""');
  }
  lines.push(
    '',
    '**Walk them through it**: what each idea in these notes says, in order, in plain words, with the',
    'slide’s own example where it has one and its page as p. N. About 150 words, 220 at most. Do not',
    'add what the notes and slides do not cover. **Ask the learner nothing**: no question, no "any',
    'questions?", and do not say that a question or a check is coming.',
    input.maxQuestionOpen === true
      ? 'Max already has a question open for them; end by pointing them back to it in a few words.'
      : 'End by saying they can press Explain or Example on any line they want more on.',
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
/**
 * **Marking a fill-in-the-blank** (§4.5, amended 2026-10-01).
 *
 * The ordinary feedback turn asks for what the answer had and what it lacked, and ends on a
 * follow-up about the gap. A blank has one term in it, so the mark is whether that term is right,
 * and the way on from a wrong one is where on the page to look, not a second question.
 */
export function clozeFeedbackBlock(input: { followUp?: boolean } = {}): string {
  const [done, , notYet] = VERDICT_OPENERS;
  const bare = (v: string): string => v.replace(/\.$/, '');
  return [
    ...(input.followUp === true
      ? [
          'YOUR LAST FOLLOW-UP WAS A FILL-IN-THE-BLANK',
          'Their message answers that blank, not the whole question above. Mark the term, and only it.',
        ]
      : ['YOUR QUESTION WAS A FILL-IN-THE-BLANK']),
    `Mark the term they gave. **${done}** if it is the term, a plain synonym of it, or the term with`,
    `a harmless slip in spelling. Otherwise **${notYet}** A blank has no *Partly there*.`,
    `After ${bare(done)}: the completed sentence, quoted once with its page, and nothing else.`,
    `After ${bare(notYet)}: do not give the term. Say in one sentence where on the page to look, and`,
    'repeat the sentence with its blank so they can try again. No other question. Under 60 words.',
  ].join('\n');
}

/**
 * **The second try onwards, and the offer of Show me** (live run, 2026-10-03; amended 2026-10-06,
 * D3; `core/pitch.followUpPlan`).
 *
 * One question on the p. 4 `Fly` action was marked *Partly there* six times: each answer marked
 * alone against the whole question, each follow-up narrower. So from the second try the answers
 * are marked together. The 2026-10-03 fix then ended a run on a fill-in-the-blank, and in the runs
 * that followed every such blank was scored complete, 6 of 8 with the term on screen and one on
 * the wrong word. Since 2026-10-06 (`collab-doc.md` §4.2, §4.5 amended) the second try, or a
 * guess, gets no smaller question: Max says what landed and offers **Show me**. Nothing when
 * neither applies: the first try's feedback is the ordinary one.
 */
export function followUpBlock(input: { attempts: number; together: boolean; guess: boolean; showMe: boolean }): string | undefined {
  if (!input.together && !input.showMe) return undefined;
  const lines = [`THIS IS THEIR TRY ${input.attempts} AT THIS QUESTION`];
  if (input.together) {
    lines.push(
      'Mark everything they have written on it since you asked it, **taken together**, against the',
      'question you asked (above), not against your follow-ups. If together it answers that question,',
      'it is **Well done**, even where a follow-up of yours went further than the question did. A',
      'follow-up asks only for a part of the question you asked, never for something it did not ask.',
    );
  }
  if (input.guess) {
    lines.push(
      'Their answer is a few words ending in a question mark: they are guessing at what you want, not',
      'answering it. Another question asks them to guess again.',
    );
  }
  if (input.showMe) {
    lines.push(
      `${input.guess ? 'So unless' : `They have had ${PARTIALS_BEFORE_SHOW_ME - 1} follow-up on it already. Unless`} it is Well done,`,
      '**ask nothing**: no follow-up, no smaller question and no fill-in-the-blank. Say what their',
      'answers have so far, name the part still missing without stating or quoting it, and end on one',
      'sentence offering to show them the answer (the **Show me** button) or to try once more in',
      'their own words.',
    );
  } else {
    // 2026-10-06 (D3): an open follow-up from the second try on carries the same rule.
    lines.push(NOT_READABLE_OFF);
  }
  return lines.join('\n');
}

/**
 * **The learner wrote their own question in the notes, answered it, and asked for a mark** (§5.6,
 * 2026-10-01). Max did not ask this question, so there is no objective behind it and no list of
 * what a correct demonstration contains: he marks the answer against the deck. It fills no
 * progress, which is decided in code and is not his to mention.
 */
export function ownQuestionBlock(input: { question: string; answer: string }): string {
  const [done, partly, notYet] = VERDICT_OPENERS;
  return [
    'THE LEARNER WROTE THIS QUESTION THEMSELVES, IN THEIR NOTES, AND ANSWERED IT',
    'Their question:',
    '"""',
    input.question,
    '"""',
    'Their answer:',
    '"""',
    input.answer,
    '"""',
    'Mark the answer against what the deck says, as you would mark an answer to a question of your',
    `own. Your first line is exactly one of **${done}** / **${partly}** / **${notYet}** and nothing else.`,
    'Then what the answer had, what was missing or wrong, and the correction, each point grounded',
    'as p. N: "…" in the page’s own words.',
    'If the question cannot be answered from this deck, or asks something the deck gets no closer',
    `to than a name, say so in one sentence after **${notYet}** and say what the deck does cover.`,
    'Do not ask a question of your own and do not rewrite theirs: they may revise the answer and',
    'submit it again. Under 100 words.',
  ].join('\n');
}

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

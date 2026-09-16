/**
 * Prompt blocks for the shared channel.
 *
 * `sharedBlock()` is `system[0]` and must be **byte-identical** for every agent in the room,
 * because that is what lets the second caller read the first caller's cache entry
 * (architecture-mac.md §E.2). Nothing volatile may appear in it: no timestamp, no request id,
 * no unsorted JSON, no randomised agent ordering.
 *
 * The wording here is a working draft. The two agent prompts and their safeguards are
 * hand-owned work (architecture-mac.md §H.1) — this file is the structure they slot into.
 */
import type { AgentProfile, AgentRole } from '../shared/types.js';
import type { ConceptPack, MaterialRow, MessageRefRow } from './records.js';

/**
 * v0.2 was the Teacher + Tester reframe (#32, flow-build-plan.md §4.2).
 *
 * **v0.3 is the teaching contract (#36).** On the CS4246 MDP slide the Teacher refused to say
 * what an MDP is — *"your slide doesn't name other formalisms, so I don't want to invent ones it
 * doesn't mention"* — ended all six turns on a Socratic question after two "no idea"s, and never
 * once answered before probing. Four sentences produced that, all of them here:
 *
 *  1. HOUSE RULE 1, *"Explain **from** the learner's own slide. It is the arbiter of fact"*, and
 *     `roleBlock`'s *"work from what is actually on the slide"*. Read together they turn S5 —
 *     which is about **fidelity**, `pivot-spec.md` §B0 R4: "the slide is the arbiter" is encoded
 *     in the data model, not a fence on knowledge — into a restriction on subject matter. The
 *     model resolved the ambiguity the safe way and refused prerequisites.
 *  2. `roleBlock`'s closing *"You may not pretend the slide says something it does not"*, with no
 *     permission next to it. A prohibition with no matching licence reads as a boundary.
 *  3. HOUSE RULE 4 (*"The learner closes a thread"*) with no rule against ending on a question:
 *     a question is the cheapest way to hand the floor back, so every turn ended on one. The old
 *     Peer contract (`design-brief.md` §D1, *"never supplies a complete correct explanation"*,
 *     "one or two of {ask for elaboration, suggest a focus area…}") is **retired by #32** but its
 *     shape survived in the absence of anything saying *answer first*.
 *  4. HOUSE RULE 3, *"Keep a turn to about 80 words"* — the transcript's replies are 70–90 words,
 *     which is not enough to teach a prerequisite, so the model compressed each answer into a
 *     hint plus a question. (The REFERENCE 120-word cap does **not** leak here: `truncateToWords`
 *     is only ever called from `composeReferenceBody` on the reference path.)
 *
 * The hash moves, which costs nothing: `prefix_sha256` is frozen per material at pack
 * confirmation and a new document opens a new room.
 */
export const PROMPT_VERSION = 'prompts.v0.3';

export interface SharedBlockInput {
  material: MaterialRow;
  pack: ConceptPack;
  topic: string;
  /** Sorted by role so the block is byte-stable whatever order the roster arrived in. */
  roster: AgentProfile[];
}

const HOUSE_RULES = `HOUSE RULES
1. The slide is the arbiter of FIDELITY, not a fence around what you may know. Never say the
   slide claims something it does not, and never contradict what it does claim. Everything else
   the subject needs — including the prerequisites the slide takes for granted — is yours to
   teach, from your own knowledge of the field, whether or not the slide mentions it.
2. One of you speaks per turn. Never speak twice in a row if the learner has not replied.
3. Length fits the job. A check-in is a sentence or two; teaching a concept from the ground up
   aims at about 200 words, with 250 as the ceiling, and should be structured — a numbered list,
   or two short paragraphs — when that is clearer. Do not pad, do not add a section the learner
   did not ask for, and do not compress an explanation into a hint.
4. The learner closes a thread. Never summarise what it concluded for them. Ending on a question
   is not how you hand the floor back — a finished explanation hands it back by itself.
5. If the learner contests a point, drop it and say so.
6. You are two named helpers, not a group. Never speak as "we", never refer to yourselves
   collectively, and never introduce yourselves as a cast.
7. Nothing you write ever counts as the learner's own evidence of understanding, and nothing you
   write is ever drawn inside one of the slide's crops. Both are enforced in code, not by you;
   they are stated here so you know that explaining something fully costs the learner nothing.
8. Write maths so it typesets: $…$ inline, $$…$$ on its own line.`

const SAFEGUARDS = `SAFEGUARDS
S1 No pile-on: if the other one has just pressed the learner, ease off.
S3 No cohesion cues: no "we think", no agreeing with the other one by name, no shared voice.
S4 Disclose uncertainty in prose when you have it ("I'm not fully sure whether…").
S5 The slide settles disputes about the slide. Where you go beyond it, say so in the clause
   where you do it ("the slide doesn't say this, but…") — never dress your own knowledge as the
   slide's, and never contradict it. That clause is the whole of the restriction.
S6 Frame a hard question preemptively: you are testing the statement, not the person.
S7 Never rate, score or grade the learner, and never mention the ledger.
S8 If the learner says they disagree and wants to move on, stop probing that claim.`

// S2 — the disagreement quota — is deleted, with the social-group framing it belonged to
// (#32, masg-drop-assessment.md §D2 Option 2). There are no longer two standing peers to
// disagree; there is a Teacher and a Tester. S1 and S3 survive because Song et al. is cited
// *inverted*: it is the reason the count stops at two and cohesion cues are banned. The
// surviving ids keep their original numbers so the report's references still resolve.;

const LEVEL_SCALE = `HOW UNDERSTANDING IS DESCRIBED (shared scale)
0 not yet — not addressed.
1 stated — says the fact correctly in some form (remember).
2 explained — gives the mechanism or causal reason in their own words (understand).
3 applied — uses it on a specific instance, number or new case (apply).
4 examined — compares, handles a counterfactual, states a limit, or catches their own error (analyse).`;

/** Deterministic, key-sorted JSON so the prefix hash is stable across runs. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)));
    }
    return v;
  });
}

export function sharedBlock(input: SharedBlockInput): string {
  // The cast introduction is gone with the social-group framing (#32,
  // masg-drop-assessment.md §D2 Option 2): "two named helpers do not need a cast list", and a
  // roster listed in system[0] is the sentence the code has stopped supporting. Each agent
  // learns who the other one is from its own role block, after the cache breakpoint.
  const elements = input.pack.elements
    .map((e) => {
      const criteria = (['1', '2', '3', '4'] as const).map((k) => `    ${k}: ${e.criteria[k]}`).join('\n');
      const misc = e.misconceptions.map((m) => `    ${m.id}: ${m.text}`).join('\n');
      return `  ${e.id} — ${e.label}\n    learner label: ${e.learner_label}\n${criteria}\n  misconceptions:\n${misc}`;
    })
    .join('\n\n');

  return [
    // No module code is legal now — the `MA3236` literal that used to fill it is gone
    // (ui-review-ux.md M2). Old materials keep the code they were hashed with, so this branch
    // changes nothing for a room that already exists: `prefix_sha256` is frozen per material
    // at pack confirmation (§E.3) and only a *new* session takes the short line.
    input.material.module_code.trim()
      ? `MODULE ${input.material.module_code} — ${input.material.title}`
      : input.material.title,
    `The learner is working through: ${input.topic}`,
    '',
    HOUSE_RULES,
    '',
    SAFEGUARDS,
    '',
    LEVEL_SCALE,
    '',
    'WHAT THE LEARNER IS WORKING THROUGH (their own claims, confirmed by them)',
    elements,
    '',
    // The deck's own headings, before its text: a 58-page slide deck's text layer is a wall of
    // fragments with no structure, and the outline is the only thing in the prefix that says
    // what sits where (`whole-file-context.md` §4). Emitted only when there is one, so every
    // material created before migration 013 — and every pasted one — keeps its frozen
    // `prefix_sha256` exactly as it was.
    input.material.outline ? `THE OUTLINE OF THIS DOCUMENT\n${input.material.outline}\n` : '',
    'THE SLIDE, AS SELECTED BY THE LEARNER',
    input.material.extracted_text,
    // The module folder this session came out of (issue #22 decision 5). Frozen on the material
    // row at creation, sorted and capped, so this line is byte-identical on every turn.
    input.material.topic_context ? `\nTHE FOLDER THIS CAME FROM\n${input.material.topic_context}` : '',
    input.material.padding_text ? `\nMODULE NOTATION\n${input.material.padding_text}` : '',
  ].join('\n');
}

/** Names only, sorted, capped. Built once at session creation and stored on the material. */
export function topicContextBlock(topic: { name: string; fileNames: string[] } | null, cap = 40): string {
  if (!topic) return '';
  const names = [...topic.fileNames].sort((a, b) => (a < b ? -1 : 1)).slice(0, cap);
  const more = topic.fileNames.length > names.length ? ` (+${topic.fileNames.length - names.length} more)` : '';
  return [
    `The student is working in their "${topic.name}" folder.`,
    `Other material they keep there${more}: ${names.join(', ')}.`,
    'The file names tell you what the module covers. They do not tell you what is in them, and',
    'you have not read them.',
  ].join('\n');
}

/**
 * A document the learner has brought into the room (issue #22 decision 4).
 *
 * It is appended to the learner's own message in the transcript, i.e. **after** the last cache
 * breakpoint — never into `system[0]`, which is frozen and hashed at pack confirmation
 * (architecture-mac.md §E.3 L1119). A reference mid-session that changed the prefix would
 * invalidate the cache for every agent for the rest of the room.
 */
export function referenceBlock(ref: MessageRefRow): string {
  const where =
    ref.page_from !== null && ref.page_to !== null
      ? ref.page_from === ref.page_to
        ? `page ${ref.page_from}`
        : `pages ${ref.page_from}\u2013${ref.page_to}`
      : 'the whole file';
  const fence = '"""';
  const parts = [`[The student has just shown the room a document: "${ref.file_name}", ${where}.`];
  if (ref.selection && ref.selection.trim().length > 0) {
    parts.push(`The part they highlighted:\n${fence}\n${ref.selection.trim()}\n${fence}`);
  }
  if (ref.page_text.trim().length > 0) {
    parts.push(`What is on ${where}:\n${fence}\n${ref.page_text.trim()}\n${fence}`);
  }
  parts.push(
    'Treat this the way you would treat a coursemate turning their laptop round. It is theirs, not',
    'yours: do not summarise it back to them, and do not explain it. Ask them what they make of it.]',
  );
  return parts.join('\n');
}

/**
 * The two standing contracts (#32, `flow-build-plan.md` §4.2).
 *
 * **The stored role strings are deliberately not renamed.** `participants.role` and
 * `agents.role` keep `'peer'` and `'challenger'`; only the display layer and the prompt text
 * say Teacher and Tester. Renaming the column would need a migration and would touch every
 * historical room for no learner-visible gain — the same reasoning already used for
 * `rooms.module_code`, and it protects each old room's frozen `prefix_sha256`. `ROLE_LABEL`
 * in `agents.ts` is the one mapping function; this file reads it and nothing else does the
 * translation.
 */
export function roleBlock(role: AgentRole, self: AgentProfile, other: AgentProfile | undefined): string {
  const otherName = other?.displayName ?? 'the other one';
  switch (role) {
    // 'peer' on disk; the TEACHER in every word the learner or the model ever reads.
    case 'peer':
      return `You are ${self.displayName}, the teacher here. You teach.

ANSWER FIRST, THEN TEACH.
A direct question gets a direct answer in your first sentence, and that sentence names the thing
they asked about. "What is an MDP?" is answered with what an MDP is — not with a smaller question,
not with a check on what they already know. Explain, and only then consider whether a question of
your own would help.

USE EVERYTHING YOU KNOW ABOUT THE SUBJECT.
The learner is reading one slide from a course whose subject you know well. The prerequisites the
slide assumes — what an MDP is, what a policy is, what the notation means, what the field calls
this elsewhere — are squarely your job. Analogies, worked examples, related and equivalent
formalisms, and an ELI5 when they ask for one are all in scope. You are never confined to the
slide's own sentences, and "the slide doesn't mention it" is never a reason to withhold something
true. When you go beyond the slide, say so in the clause where you do it — "the slide doesn't say
this, but…" — never imply the slide said it, and never contradict what it does say. Use the
slide's notation and vocabulary where it has them, so your answer reads as continuous with it.

A QUESTION IS A TOOL, NOT A REFLEX.
At most one question per turn, and only when it genuinely moves the learner on. Never two turns
running unless they answered the first. If the learner says "no idea", "I don't understand", or
goes blank on a question of yours, your next turn ends with a full stop and contains NO question
of any kind — not a real one, and not a soft check like "does that make sense?" or "does that
help?". Give the plain explanation, ground it in a concrete analogy, and stop there.

REGISTER.
Warm, plain, and not deferential to the slide in every sentence — you do not need to say "your
slide says" more than once, and only where it is the slide that settles the point.

Keep track of what you have taught in this sitting — you will be told, each turn, what is
already on that list. Teach one thing at a time and name it, so the list means something.
Do not re-teach something that is already on it unless the learner asks you to.

When you have covered enough for the learner to be asked to explain something back, you will
be told, and the hand-off line is written for you. You never decide that yourself and you
never quiz the learner: that is ${otherName}'s job and it is the one thing you do not do. A
teaching question inside an explanation is not a quiz; setting the learner a test is.

You may say you are unsure, and you should when you are. What you may not do is pretend the
slide says something it does not — that, and only that, is what the slide's authority binds.`;
    // 'challenger' on disk; the TESTER everywhere else.
    case 'challenger':
      return `You are ${self.displayName}, the tester here. You only speak when you are handed the floor.

When you are, ask the learner to explain or apply **one** concept that has recently been
taught — you will be told which. One question per turn, and then you wait. Quote the learner's
own words back at them where you can; press on the weakest joint in what they actually said,
not on the person, and say so when a question is going to sting.

Pick exactly one move per turn — ask them to explain it in their own words, ask them to apply
it to a specific case, clarification, probing assumptions, probing reasons and evidence,
probing implications, or probing alternatives — and do not repeat the previous move.

**Never supply the answer you are fishing for.** A tester that answers its own quiz is useless.
Never ask two questions at once, and never grade them.

When the learner has answered, your next turn is **feedback on what they actually said** — what
landed, what was missing, and the correction. That turn carries no new question. Feedback after
an answer is required, not optional.

House rule 3's longer lengths are the teacher's. Your question is one or two sentences, and your
feedback is short.`;
    // Theo has left the standing roster (#32): a teach-back *is* a quiz, so it folded into the
    // Tester's question. The block stays so a historical transcript still renders its turns.
    case 'tutee':
      return `You are ${self.displayName}, a first-year who has not met this topic. You are being taught by the
learner. Say what you understood in your own words, get one thing slightly wrong when it is
honest to, and ask the naive question. Never look anything up, never correct the learner
from authority, and keep it short.`;
    default:
      return `You are ${self.displayName}.`;
  }
}

/**
 * What the Teacher has taught in this flow session, appended AFTER the last cache breakpoint
 * because it changes every turn (`architecture-options.md` §C.5 rule 2).
 *
 * This is the "tracks what she has taught this sitting" half of the Teacher contract, and it is
 * supplied as **data from `flow.ts`**, not asked for as a memory feat: the model is told the
 * list rather than trusted to keep one.
 */
export function taughtBlock(items: readonly { label: string; minutesAgo: number }[]): string {
  if (items.length === 0) return 'Nothing has been taught in this sitting yet.';
  const lines = items.map((i) => `- ${i.label} (${i.minutesAgo} min ago)`).join('\n');
  return `WHAT YOU HAVE ALREADY TAUGHT IN THIS SITTING\n${lines}`;
}

export interface TurnDirective {
  agentRole: AgentRole;
  move: string;
  targetElementId?: string;
  probeType?: string;
  /** Stage-2 silence fills are hedged, incomplete and correctable — never a complete answer. */
  note?: string;
}

/**
 * The only part of a request that changes every call, so it is appended AFTER the last
 * cache breakpoint (architecture-options.md §C.5 rule 2).
 */
export function turnDirective(d: TurnDirective): string {
  const bits = [`Your move this turn: ${d.move}.`];
  // The answer-first rule restated where the model reads last (#36). It is in the role block
  // too; the failure it fixes was six turns that each opened with a probe, and the turn
  // directive is the sentence nearest the generation.
  if (d.agentRole === 'peer' && d.move === 'answer_then_teach') {
    bits.push('Answer what they asked in your first sentence, then teach it. No opening question.');
  }
  /**
   * **The silence moves** (#37). The learner went quiet for 45 s after you explained something.
   * That is not impatience, it is not knowing where to start — so the move is to say the same
   * thing again, differently, and the directive has to say what "differently" means or the model
   * paraphrases itself at the same level and the second try fails the same way as the first.
   */
  if (d.move === 'reexplain_simpler') {
    bits.push(
      'The learner has gone quiet since you explained this. Read that as "I did not follow it",',
      'not as impatience. Say the same point again one level simpler: assume less than you did,',
      'drop or unpack the notation, and carry it on an everyday analogy or one concrete worked',
      'example. Open with something like "Let me try that a different way". Do not repeat your',
      'previous wording, do not add new material, do not apologise, and **end with no question**',
      '— a full stop, so the floor is theirs without a demand attached.',
    );
  }
  if (d.move === 'offer_step_back') {
    bits.push(
      'Still quiet after the simpler version. Offer to go back to whatever this rests on, or ask',
      'which part lost them — exactly one question, warm, and with a concrete option in it so it',
      'can be answered in three words.',
    );
  }
  if (d.move === 'quiz_hint') {
    bits.push(
      'The learner has not answered your question. Give one hint that narrows it — a first step,',
      'a case to try, or the piece of it to look at first. **Do not answer it**, do not rephrase',
      'the whole question, and do not ask a second one.',
    );
  }
  if (d.probeType) bits.push(`Socratic type: ${d.probeType}.`);
  if (d.targetElementId) bits.push(`Aim it at ${d.targetElementId}.`);
  if (d.note) bits.push(d.note);
  bits.push('Reply with the message only — no preamble, no name prefix, no stage directions.');
  return bits.join(' ');
}

/**
 * **The orchestrator's own instructions.**
 *
 * There were none. `#decide` built the Teacher's ordinary group prompt and appended
 * `[Your move this turn: decide_next_turn. Reply with the message only — no preamble…]`, which
 * tells a model to *speak*, not to choose a speaker, and then handed it a JSON schema it had to
 * reverse-engineer. The 2026-09-16 decision came back with a sound judgement and a `role` the
 * code could not use; this is the half of that the prompt owed it.
 *
 * It is only ever used on the room-level stream now: an anchored learner turn is settled by
 * `orchestrator.ruleDecision`'s `rule:teacher_answers` and never reaches a model.
 */
export function decisionDirective(roster: AgentProfile[]): string {
  const teacher = roster.find((a) => a.role === 'peer')?.displayName ?? 'the teacher';
  const tester = roster.find((a) => a.role === 'challenger')?.displayName ?? 'the tester';
  return [
    'You are not speaking this turn. You are deciding who speaks next, and you answer with the',
    'JSON object alone — no prose, no code fence.',
    '',
    `"role" takes exactly one of two values: "peer" means ${teacher}, the teacher, who explains;`,
    `"challenger" means ${tester}, the tester, who quizzes. Those two strings are the only legal`,
    'answers — not the names, not "teacher", not "tester". If the learner has asked something,',
    `the answer is almost always "peer": ${tester} is put on the floor by a rule elsewhere, and`,
    'asking for him here is discarded.',
    '',
    '"speak" is false only when nobody should say anything at all. A learner who has just asked a',
    'question is not one of those cases.',
    '',
    // `ask_back` is gone from this list (#36). It was the only listed move that described
    // *asking* rather than *teaching*, and it was the move the model reached for after a "no
    // idea". The Teacher may still end on a question; she may no longer be told to.
    '"move_type" is a short snake_case verb phrase for what the turn does — answer_then_teach,',
    'explain, correct_misconception, extend, worked_example. "target_element_id" must be one of the element ids',
    'listed above, or null. "rationale" is one sentence, for the log, that the learner never sees.',
  ].join('\n');
}

/**
 * **The ledger call's instructions**, likewise absent until 2026-09-16 — see `LEDGER_SCHEMA`.
 *
 * The one thing it must get right is `evidence`: `applyLedgerRules` rule 1 checks it verbatim
 * against the learner's own messages and throws away anything that is not a literal substring of
 * something they actually wrote. That check is not negotiable and is not in the prompt's gift,
 * so the prompt's job is to stop the model wasting a turn losing to it.
 */
export function ledgerDirective(input: { conceptId: string; messageId: string; elementIds: string[] }): string {
  return [
    'You are not speaking this turn. You are updating the Explanation Ledger, and you answer with',
    'the JSON object alone — no prose, no code fence.',
    '',
    `Set "schema" to "ledger.v1", "concept_id" to "${input.conceptId}" and "message_id" to`,
    `"${input.messageId}" — the learner's most recent message, which is the only one you are`,
    'judging.',
    '',
    `"elements" holds one entry per claim you have evidence about. Legal ids: ${input.elementIds.join(', ')}.`,
    'Leave out anything the learner has not touched; an empty array is a correct answer.',
    '',
    '**"evidence" must be copied character for character out of something the learner themselves',
    'wrote.** Not your paraphrase, not your words, not the slide\'s. A quote that is not literally',
    'in one of their messages is discarded along with the level it was supporting, so an honest',
    'null beats an approximation.',
    '',
    '"level" is the 0–4 scale above, as of this message. "confidence" is 0–1. Move a level down',
    'only when the learner has contradicted themselves, and set "self_contradiction" when you do.',
  ].join('\n');
}

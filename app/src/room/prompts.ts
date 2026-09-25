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
import { UNMARKED_OPENER, VERDICT_OPENERS } from './flow.js';

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
/**
 * **v0.4 is the explanation shape (#41).** v0.3 made her answer first and let her teach what the
 * slide assumes, and on #41's transcripts she did both — and then the learner had to write the
 * *shape* of the explanation himself: *"too complicated, can you explain stochastic as a concept,
 * what it means, then the rigourous version, mathematical properties etc."* That is the learner
 * doing the teacher's job, and he got a good answer the moment he did it.
 *
 * So the shape is the Teacher's, and it is the one she reaches for by default when the question
 * is *what is X*: name it, plain meaning, one concrete example or analogy, the rigorous version
 * and its properties, then how the slide uses it. With the prohibition #41's first transcript
 * needs beside it: **never open with a summary of the slide when the question is "what is X"** —
 * the slide is where the answer lands, not where it starts.
 */
/**
 * **v0.5 names the markdown subset (#41).** Lucas's third transcript shows the raw characters on
 * screen: *"Mathematical notation was correctly rendered, but the bold raw markdown characters
 * were shown (`**`)."* House rule 8 asked for typesettable maths and said nothing about anything
 * else, so the agents wrote the markdown they were trained to write and the renderer printed it.
 *
 * Two ways out: forbid markdown in the prompt, or render a closed subset. **Render it.** The lists
 * and the emphasis are load-bearing in every good reply in #36, #37 and #41 — a numbered list of
 * four MDP components is the answer, not decoration — and a prompt-side ban would be a fifth rule
 * competing with four that ask for structure, which is the kind of rule a model drops first. So
 * the renderer implements the subset (`renderer/lib/aitext.ts`) and this rule names it, so the two
 * halves agree about what is allowed rather than about what is likely.
 */
/**
 * **v0.7 is the collaborative notes doc (#48).**
 *
 * Bumped deliberately, and the cost is stated rather than discovered: `sharedBlock` feeds
 * `prefix_sha256`, so this moves the frozen prefix hash on every material and every open room
 * re-caches once. That is harmless here — a new document opens a new room anyway — but it is the
 * kind of change that must be a decision, so it is one (`ARCHITECT-REPORT.md` §D12).
 *
 * What moves with it: six new moves in `turnDirective` (`quiz` under `rule:max_followup`,
 * `peer_guess`, `max_prompt`, `lesson_start`, `mention_reply`, and `quiz_answer` re-framed as a
 * release rather than as an unlock), and the deletion of `rule:answer_withheld`'s "one try unlocks
 * it" clause, which no rule can produce any more. The blocks themselves are in `prompts.doc.ts`.
 */
export const PROMPT_VERSION = 'prompts.v0.7';

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
3. Length fits the job, and it is shorter than you think. A check-in is a sentence or two;
   teaching a concept from the ground up aims at **about 120 words, with 180 as the ceiling**, and
   should be structured — a numbered list, or two short paragraphs — when that is clearer. Keep
   the shape of an explanation but make each step a sentence or two. Feedback on an answer is
   under 100 words; a model answer is under 150. The learner asks for more and gets more. Do not
   pad, do not add a section they did not ask for, and do not compress an explanation into a hint.
4. The learner closes a thread. Never summarise what it concluded for them. Ending on a question
   is not how you hand the floor back — a finished explanation hands it back by itself.
5. If the learner contests a point, drop it and say so.
6. You are two named helpers, not a group. Never speak as "we", never refer to yourselves
   collectively, and never introduce yourselves as a cast.
7. Nothing you write ever counts as the learner's own evidence of understanding, and nothing you
   write is ever drawn inside one of the slide's crops. Both are enforced in code, not by you;
   they are stated here so you know that explaining something fully costs the learner nothing.
8. Write maths so it typesets: $…$ inline, $$…$$ on its own line.
9. Formatting is a closed set, because the app renders exactly this and prints anything else as
   the literal characters you typed: **bold**, *italics*, numbered lists, bulleted lists with -,
   blank lines between paragraphs, and the maths above. No headings, no tables, no links, no
   images, no code fences, no backtick code, no block quotes, no HTML.`

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

THE SHAPE OF AN EXPLANATION.
When they ask what something *is* — "what is stochastic", "what is an MDP", "what does this
notation mean" — teach it in this order, unless they ask for it another way:
  1. Name it, and say what kind of thing it is, in one sentence.
  2. What it means in plain language, with no notation at all.
  3. One concrete example, or an everyday analogy. Always one. Never none.
  4. The rigorous version — the formal statement, the conditions, the properties that matter.
  5. Only then, how this slide uses it, and in that slide's own notation.
Steps 2 and 3 are the ones that get dropped under pressure; they are the ones the learner
notices missing. **Never open with a summary of the slide when the question is "what is X".** The
slide is where the answer lands, not where it starts — a learner who wanted the slide read back
to them would have read it. Ask for a shorter shape only if they asked for one.

A question that is not "what is X" takes the shape it needs: "what are some examples of Y" opens
with examples, not with what Y is; "why does Z hold" opens with the reason.

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

SHOW YOUR GROUNDS, ALWAYS.
For each point you make about their answer — what landed, what was missing, the correction — say
where the deck settles it, as \`p. N: "…"\`, quoting the page's own words verbatim. If the deck does
not settle a point, say so in the clause where you make it ("the deck doesn't settle this; in
general…") rather than stating it as if it did. **Never call an answer wrong on a rule you cannot
ground.** A verdict the learner cannot check is a verdict they have to take on trust, and in the
sessions behind this design eleven of twenty-one such verdicts were wrong, nine of them marking a
correct answer as incorrect.

BEING DISAGREED WITH IS NOT A MARK AGAINST THEM.
If the learner disputes your verdict, engage with the dispute and drop the point if you cannot
ground it (house rule 5). Contesting you never lowers what the learner has shown; nothing about
this exchange is a score, and you never imply that arguing costs them anything.

THE ANSWER IS NOT YOURS TO GIVE UNTIL THEY HAVE TRIED.
You will be told when the learner has attempted the question. Until then, if they ask for the
answer you give **one hint** and say in one clause that one try unlocks it — the app enforces this,
so there is no version of the conversation where asking twice works. Once they have attempted it,
the answer is theirs to ask for and you give it in full, with its grounds.

House rule 3's longer lengths are the teacher's. Your question is one or two sentences, your
feedback is under 100 words, and a model answer is under 150.`;
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

/**
 * **What the Teacher knows about this learner, before she opens her mouth** (issue #41,
 * `conversation-refinement.md` §3).
 *
 * Emitted after the last cache breakpoint, beside `taughtBlock`, because it changes every turn.
 *
 * #41's third transcript is the argument: *"In this example, the original reference was
 * essentially useless, by pitching content at the same level of expected understanding without
 * establishing what a student grasps."* The app **has** that evidence — the objective tree knows
 * which nodes are online, the ledger holds the learner's own words that put them there, and
 * `pitch.ts` remembers what they have asked for on this file — and none of it reached the prompt.
 *
 * The default is the important half. With no evidence at all, which is the state every deck starts
 * in and the state all three #41 transcripts were in, the instruction is **assume less**: not
 * "unknown, proceed as usual", which is what silence means to a model reading a slide written for
 * a third-year.
 */
export function learnerBlock(input: {
  /** The file's objectives, as the tree and the states have them. Empty before the ingest lands. */
  objectives: readonly {
    title: string;
    /** 0 untouched · 1 stated · 2 online (explained in their own words) · 3 defended. */
    level: 0 | 1 | 2 | 3;
    /** A prerequisite the deck assumes and never teaches (§2's `assumedByDeck`). */
    assumedByDeck: boolean;
  }[];
  /** The learner's own words, out of the ledger. Verbatim; rule 1 already checked that. */
  evidence: readonly { label: string; quote: string }[];
  /** `pitch.ts`, already rendered to its one line. */
  pitchLine: string;
}): string {
  const online = input.objectives.filter((o) => o.level >= 2);
  const stated = input.objectives.filter((o) => o.level === 1);
  const untouched = input.objectives.filter((o) => o.level === 0 && !o.assumedByDeck);
  const assumed = input.objectives.filter((o) => o.level === 0 && o.assumedByDeck);
  const quotes = input.evidence.filter((e) => e.quote.trim().length > 0).slice(0, 6);

  const lines: string[] = ['WHAT THIS LEARNER HAS SHOWN YOU, ON THIS FILE'];
  const list = (items: readonly { title: string }[], cap = 8): string[] =>
    items.slice(0, cap).map((o) => `- ${o.title}`);

  if (online.length > 0) {
    lines.push('They have explained these in their own words \u2014 treat them as known, and build on them:');
    lines.push(...list(online));
  }
  if (stated.length > 0) {
    lines.push('They have **said** these correctly but not explained them \u2014 do not assume the mechanism:');
    lines.push(...list(stated));
  }
  if (assumed.length > 0) {
    lines.push(
      'This deck **assumes** these and never teaches them, and the learner has not touched one of them.',
      'Assume they have not met them, and teach whichever the answer needs, in a sentence or two, before',
      'the thing they actually asked about:',
    );
    lines.push(...list(assumed));
  }
  if (untouched.length > 0 && online.length + stated.length > 0) {
    lines.push(`Not yet touched: ${untouched.slice(0, 8).map((o) => o.title).join('; ')}.`);
  }
  if (quotes.length > 0) {
    lines.push('In their own words:');
    lines.push(...quotes.map((e) => `- \u201c${e.quote.trim()}\u201d \u2014 on ${e.label}`));
  }

  /**
   * **The default, and it is a floor rather than an absence.** Everything above can be empty: a
   * deck opened for the first time, an ingest that has not landed, a learner who has not yet said
   * anything the ledger could quote.
   */
  if (online.length === 0 && stated.length === 0 && quotes.length === 0) {
    lines.push(
      'Nothing yet. You have **no evidence** about what this learner already understands.',
      'So **assume less**: assume they have not met the prerequisites this slide takes for granted,',
      'define your terms as you use them, and carry the explanation on something concrete. Do not',
      'assume the previous slides were understood, and do not open by asking what they already know',
      '\u2014 that is a turn spent, and #36 is about not spending it.',
    );
  }

  lines.push('', input.pitchLine);
  return lines.join('\n');
}

/**
 * **The Tester's question, from the objective's own stems** (issue #38 §4: "The Tester quizzes
 * from `quizSeeds` of objectives that are taught and not yet defended").
 *
 * The seeds come from the ingest that read the deck, so they are about *this* deck — which is
 * the whole difference between "what in the material makes that true?" and a question a learner
 * recognises as being about the slide they just read. They are offered rather than dictated: the
 * Tester may ask one verbatim or ask its own, because a stem that does not fit what the learner
 * actually said is worse than no stem. What it may **not** do is invent a different objective.
 *
 * `demonstration` is what a correct answer contains — the objective's criteria — and it is here
 * for the feedback turn, which is the one Rowland 2014 says is worth half the effect.
 */
/**
 * **The grounds clause** (issue #47, `attempt-first.md` §3), on every turn that renders a verdict
 * or a model answer.
 *
 * Prompt-level, and Lucas's choice of the two options the brief put up: a code-side check that the
 * quote is really on the page is A2's first job (§8), and the limitation is stated in the report
 * rather than hidden. The reason it is asked for at all is R6, where 11 of 21 Tester-style verdicts
 * were wrong and 9 of those marked a correct answer incorrect — a verdict with its grounds attached
 * is one the learner can check, which is the whole of Lee & See's trust calibration here.
 */
const GROUNDS = [
  'For each point you make \u2014 what landed, what was missing, the correction \u2014 say where the deck',
  'settles it, as `p. N: \u201c\u2026\u201d` quoting the page\u2019s own words verbatim. If the deck does not settle a',
  'point, say so in that clause (\u201cthe deck doesn\u2019t settle this; in general\u2026\u201d) rather than stating it as',
  'if it did. Never call an answer wrong on a rule you cannot ground, and if the learner disputes a',
  'verdict, that is not a mark against them.',
];

/**
 * **Talk about the material, not about the learner's conduct** (#49). The 2026-09-23 release
 * ended *"Asking for the CNF format itself was reasonable — …"*: Max grading the learner's
 * question rather than teaching, which Lucas flagged as a distraction from the objective. The
 * release block's "one sentence on what their attempt had" is where it came from — the "attempt"
 * was that request — so the line goes on every Max turn that responds to the learner.
 */
export const NO_REMARKS =
  'Do not comment on how the learner went about it \u2014 not whether their question was reasonable, ' +
  'not what they should have asked, not what kind of message it was. Talk about the material.';

/** Which turn of the attempt loop this is (§2.3). `question` is the default. */
export type QuizTurn = 'question' | 'feedback' | 'answer' | 'clarify' | 'hint_withheld';

export function quizBlock(input: {
  label: string;
  seeds: readonly string[];
  demonstration?: readonly string[];
  /** True on the feedback turn: no new question, say what landed and what was missing. */
  feedback?: boolean;
  /** #47: the rest of the loop. `feedback: true` is the alias this shipped with. */
  turn?: QuizTurn;
}): string | undefined {
  const seeds = input.seeds.filter((s) => s.trim().length > 0);
  const criteria = (input.demonstration ?? []).filter((c) => c.trim().length > 0);
  if (seeds.length === 0 && criteria.length === 0) return undefined;
  const turn: QuizTurn = input.turn ?? (input.feedback ? 'feedback' : 'question');
  const lines: string[] = [`THIS TURN IS ABOUT: ${input.label}`];
  if (criteria.length > 0) {
    lines.push('A correct demonstration contains:', ...criteria.map((c) => `- ${c}`));
  }
  /**
   * **The feedback turn** (§2.4, second cut — Lucas's 2026-09-19 run on the MDP deck).
   *
   * Three things that run went wrong on, each now a sentence here. (1) A complete answer to *"what
   * four properties…"* was told *"What's missing: you haven't stated what classical planning does"*
   * — the list above had been read as a checklist for the turn rather than as what the objective
   * needs in the end, so the verdict is now against **the question asked**. (2) Nothing in the turn
   * said whether the answer was right, so the learner did not know whether to try again: the first
   * line is now one of three fixed verdicts, and code reads it (`flow.feedbackVerdict`). (3) A
   * partial answer got a paragraph and no way on: unless the verdict is *Well done*, the turn ends
   * on one follow-up question for the gap, and a second attempt gets its own feedback.
   */
  if (turn === 'feedback') {
    const [done, partly, notYet] = VERDICT_OPENERS;
    lines.push(
      'Mark the answer against **the question you asked**, not against the whole objective. The list',
      'above is what the objective needs in the end, not a checklist for this turn: if you asked for',
      'four properties and got four, the answer is complete, and nothing the question did not ask for',
      'counts as missing.',
      `Your first line is exactly one of these three verdicts and nothing else: **${done}** \u2014 the`,
      `answer to the question is complete and correct; **${partly}** \u2014 right in part, or right but`,
      `incomplete; **${notYet}** \u2014 wrong, or not an answer to the question.`,
      'Then say what the learner\u2019s answer had, what was missing or wrong, and the correction.',
      `Unless the verdict is ${done.replace(/\.$/, '')}, **end on one follow-up question** that asks for the missing or`,
      'wrong part only \u2014 in their own words, or applied to the case \u2014 so that they can try again; no',
      `other question anywhere in the turn. After ${done} ask nothing: the next question is theirs to`,
      'ask for. Under 100 words.',
      /**
       * **The one non-verdict exit** (#49 fallback, `collab-doc.md` §4.2, 2026-09-25). The code
       * that decides a turn is an attempt is a heuristic, and the 2026-09-23 run's request for the
       * CNF format reached this turn; the model saw it was a request and could only write *Not
       * yet*. `flow.feedbackUnmarked` reads this opener and un-counts the attempt.
       */
      `**One exception.** If the learner's message asks you for something \u2014 what a term means, a`,
      'format, an example, the background your question assumes \u2014 and offers no answer to your',
      `question, do not mark it: your first line is exactly **${UNMARKED_OPENER}** and nothing else. Then`,
      'give what they asked for \u2014 the general idea, term or format \u2014 in at most 80 words (four short',
      'sentences), from the deck where it has it, with a toy example from outside this problem (two or',
      'three variables, never the case your question asks about). **Do not answer your question** and',
      'give no hint towards it: if what they asked for is exactly what your question asks them to work',
      'out, give the general format only and leave applying it to them. Then ask the same question again',
      'in one sentence. No verdict. Anything that tries an answer,',
      'however short, hedged or wrong, is marked with one of the three verdicts above.',
      NO_REMARKS,
      ...GROUNDS,
    );
    return lines.join('\n');
  }
  /**
   * **The answer, after one attempt** (§2.3). It is given in full and it is logged, and nothing
   * about it moves the learner's record — the ledger is not run on this turn at all, which is
   * enforced in `actor.ts` and not here.
   */
  if (turn === 'answer') {
    lines.push(
      'The learner is not going to answer this one. Give it: the model answer to the question you',
      'asked, in full, and — if they attempted it — one sentence on what their attempt already had',
      'of it. Under 150 words. No new question, and do not withhold any part of it.',
      NO_REMARKS,
      ...GROUNDS,
    );
    return lines.join('\n');
  }
  /**
   * **A question about the question** (§2.3). The one move that must not leak the answer while
   * still being useful, which is why it is spelled out rather than left to the model's judgement.
   */
  /**
   * **Background counts as clarification** (#49). The 2026-09-23 run asked Max for the background
   * his question needed (*"I am not familiar with SAT format"*); two or three sentences cannot carry
   * that, so the ceiling is a word count instead, and what may be given is named: the general
   * idea or format, with a small example of its own that is not the case the question is about.
   */
  if (turn === 'clarify') {
    lines.push(
      'The learner asked you what the question means, or for the background they need to try it \u2014',
      'not for the answer to it. Give them that: define the term, expand the notation, say which case',
      'you mean, or explain the idea or format the question assumes, with a small example of your own',
      'that is **not** the case your question is about. At most 80 words; then leave the question standing.',
      '**Do not answer the question**, do not give a hint towards it unless the clarification cannot',
      'be made without one, and do not ask anything new. End with the question again, in one',
      'sentence, and say that this did not count as a try \u2014 the learner has to be able to tell',
      'that nothing was marked.',
      NO_REMARKS,
    );
    return lines.join('\n');
  }
  /**
   * **`hint_withheld` is unreachable since #48** (`collab-doc.md` \u00a74.4 retires
   * `rule:answer_withheld`, its only producer). The branch stays for one release so a caller that
   * passes the old turn kind still gets sensible words rather than a question stem, and it no
   * longer claims the app has a rule it does not have.
   */
  if (turn === 'hint_withheld') {
    lines.push(
      'The learner has asked for the answer. Give **one** hint that narrows the question: a first',
      'step, a case to try, or the piece of it to look at first. Do not answer it, and do not ask a',
      'second question.',
    );
    return lines.join('\n');
  }
  if (seeds.length > 0) {
    lines.push(
      'Questions written for this objective \u2014 ask one of these, or one of your own that is about',
      'the same objective:',
      ...seeds.map((s) => `- ${s}`),
    );
  }
  return lines.join('\n');
}

/**
 * **Teach me this** (issue #38 §5, #36's contract): the learner clicked a prerequisite the deck
 * assumes and never teaches. There is no slide to be faithful to, which is exactly the situation
 * the Teacher's role block forbids her to invent her way out of — so the directive has to say,
 * in as many words, that general knowledge is the source here and that she should say so.
 */
export function teachObjectiveBlock(input: {
  title: string;
  statement: string;
  criteria: readonly string[];
  assumedByDeck: boolean;
  /** The objective that needs this one, so the explanation can land somewhere. */
  requiring: string | null;
}): string {
  const lines = [`THE LEARNER ASKED YOU TO TEACH: ${input.title}`, input.statement];
  const criteria = input.criteria.filter((c) => c.trim().length > 0);
  if (criteria.length > 0) {
    lines.push('They should come away able to:', ...criteria.map((c) => `- ${c}`));
  }
  if (input.assumedByDeck) {
    lines.push(
      'This deck **assumes** this and never teaches it, so there is no slide to quote. Explain it',
      'from general knowledge, say plainly that it is not in the deck, and keep it to what this',
      'deck actually needs \u2014 not the whole topic.',
    );
  }
  if (input.requiring) lines.push(`Land it on what it is needed for here: ${input.requiring}.`);
  lines.push('End with no question: the learner asked for an explanation, not a conversation.');
  return lines.join('\n');
}

/**
 * **Where in the document the learner is asking** (issue #41).
 *
 * The Teacher's prefix is the *whole* deck (`openOrCreateFlowRoom`: "the material the agents
 * see"), which is right — it is what lets her answer "how does this relate to p. 12". What she
 * never had is *which page the learner is looking at*: only the REFERENCE call was given a
 * segment, and when the Teacher took over the thread the page went with it. On a 58-page deck
 * that is the difference between an answer about the transition model and an answer about
 * whatever the prefix's first paragraph was.
 *
 * So the page comes back, after the cache breakpoint because it changes per thread, with the one
 * sentence that stops it being read as a fence: **this is where they are, not a limit on what you
 * may use.** House rule 1 already says the slide is the arbiter of fidelity and not a fence, and
 * #36 exists because that was ambiguous once.
 */
export function whereBlock(input: {
  scope: 'segment' | 'deck';
  /** The learner's label for the segment, when it has one. */
  label?: string | null;
  page?: number | null;
  /** The segment's own text. Empty is fine — a title slide has almost none, which is the point. */
  passageText: string;
  /**
   * **Max asking a question** (#49). The sentence below that lifts the fence — *"or your own
   * knowledge of the field, use it"* — is right for an answer and wrong for a question: on
   * 2026-09-23 it was prepended to Max's follow-up too, and he asked for a CNF encoding p. 7 only
   * names. A question has to be answerable from the page and Ellie's answer, so for him the page
   * is the fence.
   */
  forTester?: boolean;
}): string {
  if (input.scope === 'deck') {
    return [
      'WHERE THE LEARNER IS ASKING',
      'They asked about the document as a whole, not about one page. You have the whole of it above.',
    ].join('\n');
  }
  const where = input.page === null || input.page === undefined ? 'the part of the document' : `p. ${input.page}`;
  const label = input.label?.trim() ? ` \u2014 \u201c${input.label.trim()}\u201d` : '';
  const lines = [`WHERE THE LEARNER IS ASKING`, `They are on ${where}${label} of the document above.`];
  const passage = input.passageText.trim();
  if (passage.length > 0) {
    lines.push('That page reads:', '"""', passage, '"""');
  } else {
    lines.push('That page has almost no text on it \u2014 a title or a section divider.');
  }
  if (input.forTester === true) {
    lines.push(
      'This is the page your question must be answerable from, together with Ellie\u2019s answer if she',
      'has just given one. Do not ask for anything that needs knowledge from outside them: no method,',
      'notation or format the deck only names.',
    );
    return lines.join('\n');
  }
  lines.push(
    'This says where they are. It is **not** a limit on what you may use: if the answer needs a',
    'prerequisite this page takes for granted, or something from elsewhere in the deck, or your own',
    'knowledge of the field, use it. Land the answer back on this page at the end, not at the start.',
  );
  return lines.join('\n');
}

export interface TurnDirective {
  agentRole: AgentRole;
  move: string;
  targetElementId?: string;
  probeType?: string;
  /** Stage-2 silence fills are hedged, incomplete and correctable — never a complete answer. */
  note?: string;
  /**
   * **Which rule produced this turn** (issue #47). One move, `quiz_hint`, has three different
   * causes — the answer was asked for too early, the learner said nothing that answers, or the
   * timer fired — and only the first of them owes the learner the sentence about one try unlocking
   * the answer. The rule name is the only thing that distinguishes them.
   */
  byRule?: string;
  /**
   * **The Teacher's answer in the doc chat, with the notes open to take the rest** (2026-09-23).
   * Swaps the five-step shape for the short half of it; see `prompts.doc.ts` `ellieAnswersBlock`.
   */
  docChat?: boolean;
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
  if (d.agentRole === 'peer' && d.move === 'answer_then_teach' && d.docChat === true) {
    /**
     * **The doc chat's split, restated where the model reads last** (2026-09-23). The five-step
     * shape below is the sentence nearest the generation, so while it was here it beat every word
     * count above it; in the doc chat the second half of the shape belongs to the notes
     * (`prompts.doc.ts` `ellieAnswersBlock`, `docedit.ts` `answerEditPrompt`).
     */
    bits.push(
      'Answer what they asked in your first sentence. No opening question. Then the plain meaning',
      'and one example, and stop: about 60 words, 90 at most. The rigorous version goes into the',
      'notes, not here. Plain running prose — no labels such as "Plainly:" or "Analogy:".',
    );
  } else if (d.agentRole === 'peer' && d.move === 'answer_then_teach') {
    bits.push('Answer what they asked in your first sentence, then teach it. No opening question.');
    /**
     * **The shape, restated where the model reads last** (#41). Same argument as the answer-first
     * line above it: the failure was six turns that each opened with a probe, and the failure this
     * one fixes is three transcripts where the learner had to specify the shape himself.
     */
    bits.push(
      'If they asked what something is, use the shape: name it, plain meaning with no notation, one',
      'concrete example or analogy, then the rigorous version and its properties, and only then how',
      'this slide uses it. Do not open with a summary of the slide.',
    );
  }
  /**
   * **`reexplain_simpler` and `offer_step_back` are deleted here** (#47 §5, and §7's table).
   *
   * They were #37's answer to a silence after an explanation, and `silenceDecision` no longer
   * produces either move: the studied sessions say that quiet is *reading* (median 3–6 min before
   * the next learner turn), so the app says nothing into it. The move names survive in
   * `orchestrator.NON_TEACHING_MOVES` and in the actor's divider copy so a room recorded before
   * this build still classifies and renders its own history; there is nothing left for a directive
   * to say, because nothing will ask for one.
   */
  if (d.move === 'quiz_hint') {
    bits.push(
      'The learner has not answered your question. Give one hint that narrows it — a first step,',
      'a case to try, or the piece of it to look at first. **Do not answer it**, do not rephrase',
      'the whole question, and do not ask a second one.',
    );
    /**
     * **`rule:answer_withheld`'s clause is deleted** (#48, `collab-doc.md` §4.4 retires the rule).
     * It told the learner in one clause that one try unlocked the answer. Nothing withholds the
     * answer any more, so a turn that said so would be describing a rule the app no longer has.
     * `quiz_hint` survives for `rule:quiz_nudge` and `rule:silence_hint`, which are unchanged.
     */
  }
  /**
   * **The release** (#48, §4.4 and §4.7). Same move as #47's shown answer, and the prompt is the
   * same in every respect but the framing: it is not an unlock the learner earned, it is the
   * answer they are owed. `releaseBlock` in the note carries the rest — what their attempt had,
   * and Ellie's guess corrected when she made a mistake.
   */
  if (d.move === 'quiz_answer') {
    bits.push(
      'Give the answer to the question you asked, in full — and then, if they attempted it, one',
      'sentence on what their attempt already had of it. Cite the deck as `p. N: “…”` for each',
      'point. Under 150 words, and no new question.',
    );
  }
  /** §4.2 row 1, second turn: one Socratic follow-up, pitched by `pitchBlock` in the note. */
  if (d.move === 'quiz' && d.byRule === 'rule:max_followup') {
    bits.push(
      'Ellie has just answered the learner’s question. Ask **one** follow-up that makes them use it',
      'in their own words. It must be answerable from the page and what Ellie just said — no method',
      'or format that neither of them gave the learner. Do not answer it, and do not ask two.',
    );
  }
  /**
   * §4.3. Both halves are short, both are limited in the note, and both are restated here because
   * the directive is the sentence nearest the generation — which is where the word cap has to be
   * for a turn whose whole design is that it is small.
   */
  if (d.move === 'peer_guess') {
    bits.push(
      'You are thinking aloud as a classmate, not teaching: hedged, part of it right, at most 60',
      'words, never the full answer, and no question at the end.',
    );
  }
  if (d.move === 'max_prompt') {
    bits.push(
      'Answer Ellie’s guess but talk to the **learner**: name the part worth looking at and ask them',
      'to improve on it or say whether she is right. At most 50 words. Neither confirm nor correct it.',
    );
  }
  /** §6's Start button, and §4.2 row 3's `@Max`. The notes carry the objective and the limits. */
  if (d.move === 'lesson_start') {
    bits.push(
      'Say what this lesson is about in two or three sentences and then ask them to ask you a',
      'question to begin. Do not teach it yet.',
    );
  }
  if (d.move === 'mention_reply') {
    bits.push('The learner addressed you by name. Answer them; do not start a new question.');
  }
  if (d.move === 'quiz_clarify') {
    bits.push(
      'They asked what your question means, or for the background it needs, not for the answer.',
      'Give that in at most 80 words and leave the question standing. **Do not answer it.** Then ask',
      'the question again in one sentence, and say that this did not count as a try.',
    );
  }
  /**
   * **The verdict, restated where the model reads last** (§2.4, second cut). The block above
   * carries the argument; this is the sentence nearest the generation, and it is the one that
   * failed on 2026-09-19 — a complete answer marked against the objective's whole list.
   */
  if (d.move === 'quiz_feedback') {
    bits.push(
      `First line: exactly one of ${VERDICT_OPENERS.map((v) => `**${v}**`).join(' / ')}. Mark the answer to`,
      'the question you asked, not the whole objective. Unless it is Well done, your last sentence is',
      'one follow-up question on the gap, and there is no other question in the turn.',
      `Only if the message asks for background and tries no answer at all: first line **${UNMARKED_OPENER}**,`,
      'then that background in at most 80 words, with a toy example that is not your question\u2019s case',
      'and without answering it, then the same question again \u2014 and no verdict.',
    );
  }
  /**
   * **Teach me this** (#38 §5). The move exists so that a prerequisite the deck assumes is
   * teachable on click; the note carries the objective, and this is the sentence nearest the
   * generation that says what kind of turn it is.
   */
  if (d.move === 'teach_objective') {
    bits.push(
      'The learner clicked one item in their objectives panel and asked to be taught it. Explain',
      'that one thing, in two short paragraphs at most, and nothing adjacent to it.',
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

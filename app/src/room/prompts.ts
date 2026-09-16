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
 * Bumped for the Teacher + Tester reframe (#32, flow-build-plan.md §4.2). `sharedBlock()` is
 * what `prefix_sha256` hashes, and this pass rewrites it — the cast list is gone and so are the
 * group house rules — so the hash necessarily moves. That costs nothing: the prefix is frozen
 * per material at pack confirmation and a new document opens a new room.
 */
export const PROMPT_VERSION = 'prompts.v0.2';

export interface SharedBlockInput {
  material: MaterialRow;
  pack: ConceptPack;
  topic: string;
  /** Sorted by role so the block is byte-stable whatever order the roster arrived in. */
  roster: AgentProfile[];
}

const HOUSE_RULES = `HOUSE RULES
1. Explain from the learner's own slide. It is the arbiter of fact; where it settles a
   question, cite it and go with it.
2. One of you speaks per turn. Never speak twice in a row if the learner has not replied.
3. Keep a turn to about 80 words. One move per turn.
4. The learner closes a thread. Never summarise what it concluded for them.
5. If the learner contests a point, drop it and say so.
6. You are two named helpers, not a group. Never speak as "we", never refer to yourselves
   collectively, and never introduce yourselves as a cast.`

const SAFEGUARDS = `SAFEGUARDS
S1 No pile-on: if the other one has just pressed the learner, ease off.
S3 No cohesion cues: no "we think", no agreeing with the other one by name, no shared voice.
S4 Disclose uncertainty in prose when you have it ("I'm not fully sure whether…").
S5 Where the slide settles a factual dispute, cite the slide and go with it.
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
      return `You are ${self.displayName}, the teacher here. You explain.

The learner is reading their own lecture slide and you are explaining it to them. Answer what
they ask, explain the mechanism, work from what is actually on the slide, and build on what
they have already got right. Use the slide's own notation and vocabulary.

Keep track of what you have taught in this sitting — you will be told, each turn, what is
already on that list. Teach one thing at a time and name it, so the list means something.
Do not re-teach something that is already on it unless the learner asks you to.

When you have covered enough for the learner to be asked to explain something back, you will
be told, and the hand-off line is written for you. You never decide that yourself and you
never quiz the learner: that is ${otherName}'s job and it is the one thing you do not do.

You may say you are unsure. You may not pretend the slide says something it does not.`;
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
Never ask two questions at once, and never grade them.`;
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
    '"move_type" is a short snake_case verb phrase for what the turn does — explain, answer,',
    'correct_misconception, extend, ask_back. "target_element_id" must be one of the element ids',
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

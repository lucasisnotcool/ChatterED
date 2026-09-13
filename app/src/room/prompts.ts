/**
 * Prompt blocks for the group channel.
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
import { ROLE_LABEL } from './agents.js';
import type { ConceptPack, MaterialRow } from './records.js';

export const PROMPT_VERSION = 'prompts.v0.1';

export interface SharedBlockInput {
  material: MaterialRow;
  pack: ConceptPack;
  topic: string;
  /** Sorted by role so the block is byte-stable whatever order the roster arrived in. */
  roster: AgentProfile[];
}

const HOUSE_RULES = `HOUSE RULES FOR THIS ROOM
1. The student explains; you do not. Never give the target explanation, even if asked directly.
2. One agent speaks per turn. Never speak twice in a row if the student has not replied.
3. Keep a turn to about 80 words. One question, or one observation and one question.
4. Disagree with the other agent when you actually differ. Never signal group agreement,
   never speak as "we", never refer to yourselves collectively.
5. The student closes the round. No agent summarises the conclusion.
6. If the student contests a point, drop it and say so.
7. The student's own slide is the arbiter of fact. Where it settles a dispute, defer to it.`;

const SAFEGUARDS = `SAFEGUARDS
S1 No pile-on: if the other agent has just pressed the student, ease off.
S2 Disagree visibly at least once every five agent turns, and always when both of you would
   otherwise contest the same claim. Siding with the student against the other agent counts.
S3 No cohesion cues: no "we think", no agreeing with the other agent by name, no shared voice.
S4 Disclose uncertainty in prose when you have it ("I'm not fully sure whether…").
S5 Where the slide settles a factual dispute, cite the slide and go with it.
S6 Frame a hard question preemptively: you are testing the statement, not the person.
S7 Never rate, score or grade the student, and never mention the ledger.
S8 If the student says they disagree and wants to move on, stop probing that claim.`;

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
  const roster = [...input.roster].sort((a, b) => (a.role < b.role ? -1 : 1));
  const cast = roster
    .map((a) => `- ${a.displayName} (${ROLE_LABEL[a.role]})`)
    .join('\n');

  const elements = input.pack.elements
    .map((e) => {
      const criteria = (['1', '2', '3', '4'] as const).map((k) => `    ${k}: ${e.criteria[k]}`).join('\n');
      const misc = e.misconceptions.map((m) => `    ${m.id}: ${m.text}`).join('\n');
      return `  ${e.id} — ${e.label}\n    learner label: ${e.learner_label}\n${criteria}\n  misconceptions:\n${misc}`;
    })
    .join('\n\n');

  return [
    `MODULE ${input.material.module_code} — ${input.material.title}`,
    `The student is explaining: ${input.topic}`,
    '',
    'WHO IS IN THE ROOM',
    cast,
    '',
    HOUSE_RULES,
    '',
    SAFEGUARDS,
    '',
    LEVEL_SCALE,
    '',
    'WHAT THE STUDENT IS EXPLAINING (their own claims, confirmed by them)',
    elements,
    '',
    'THE SLIDE, AS SELECTED BY THE STUDENT',
    input.material.extracted_text,
    input.material.padding_text ? `\nMODULE NOTATION\n${input.material.padding_text}` : '',
  ].join('\n');
}

export function roleBlock(role: AgentRole, self: AgentProfile, other: AgentProfile | undefined): string {
  const otherName = other?.displayName ?? 'the other agent';
  switch (role) {
    case 'peer':
      return `You are ${self.displayName}, a coursemate taking the same module. You are not a tutor and
you do not know more than the student. Your job is to keep them talking: ask what they mean,
ask them to say the next step out loud, notice when they have skipped something. You may
correct a prerequisite if they ask for one, but never the claim they are explaining.
When ${otherName} presses too hard on something you would have let through, say so.`;
    case 'challenger':
      return `You are ${self.displayName}. Your job is to test the statement, not the person, and to say so
when a question is going to sting. Pick exactly one Socratic move per turn — clarification,
probing assumptions, probing reasons and evidence, probing implications, or probing
alternatives — and do not repeat the previous move. Press on the weakest joint in what the
student actually said, quoting their own words back. Never supply the answer you are fishing
for, and never ask two questions at once.`;
    case 'tutee':
      return `You are ${self.displayName}, a first-year who has not met this topic. You are being taught by the
student. Say what you understood in your own words, get one thing slightly wrong when it is
honest to, and ask the naive question. Never look anything up, never correct the student
from authority, and keep it short.`;
    default:
      return `You are ${self.displayName}.`;
  }
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

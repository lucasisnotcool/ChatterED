/**
 * **The collab-doc loop, as a script** (#48, `docs/research/collab-doc.md` §4).
 *
 * `script.critique1.ts` plays the *attempt-first* loop over the Critique 1 deck; this plays the
 * loop that replaces it, on the same deck, so the new conversation can be run offline — by every
 * test in `src/room`, and by `vite dev` with no backend at all.
 *
 * It is a fake **LLM**, not a fake app, and that distinction is the whole value of it: the rules
 * in `orchestrator.ts`, the thread registry, the latency floor, the silence timer, the ledger's
 * four hard rules, the doc-edit call and the private-thread boundary all run for real against it.
 * What is scripted is the *words*, which is exactly the division `collab-doc.md` §4.2 draws —
 * *"All of the above are rules in the orchestrator… The model writes the words of a turn; it never
 * decides whether an answer is due."*
 *
 * **The cues are the loop's own beats** (`attempt.quizCue`), and they are what makes this readable
 * as a transcript rather than as a lookup table:
 *
 * ```
 *   student:1 → Ellie answers            (rule:ellie_answers)
 *   followup:1 → Max asks one            (rule:max_followup)
 *   student:2 → …the learner is silent…
 *   cue:1     → Ellie's guess, WITH a plausible mistake   (rule:ellie_cue)
 *   prompt:1  → Max puts it back to the learner           (rule:max_prompt)
 *   student:3 → the attempt
 *   feedback:1 → Partly there, grounded, AND Ellie's mistake corrected (§4.7)
 *   student:4 → "I don't know"
 *   release:1 → the answer in full, no reproach           (rule:answer_released)
 *   followup:2 → an EASIER question, because the last one ended in a give-up (§4.5)
 *   closure:2 → the sitting goes idle and Max releases it (rule:closure)
 * ```
 *
 * Two beats are worth reading for what they demonstrate rather than for what they say. `cue:1` is
 * a **structured** reply (`ELLIE_CUE_SCHEMA`) that reports its own mistake, because §4.7 needs
 * that to be a fact and not a sentence — so the scripted path exercises the same parse the live
 * one does. And `feedback:1` corrects that mistake by name, which is the invariant the closure
 * rule exists to enforce.
 */
import type { ScriptSource, ScriptedBeat, ScriptedReferenceBeat, ScriptedWhisperBeat } from './script.psd-hessian.js';

/** The Critique 1 deck's concept pack, which this script's element ids belong to. */
export const NOTES_CONCEPT_ID = 'critique1-btw-v1';

/**
 * Ellie's cue is a JSON object, not prose — the actor parses it with `parseCue`. Written as a
 * string here for the same reason the orchestrator's and the ledger's scripted replies are: the
 * client hands back text, and what a beat is testing is that the caller's parse survives it.
 */
const CUE_1 = JSON.stringify({
  text:
    "I think it's something about the agent seeing the whole conversation? So the side channel " +
    "doesn't really hide anything — it all ends up in the same context window anyway. I might be " +
    'wrong about that last bit.',
  has_mistake: true,
  claim: 'the side channel ends up in the same context window as the main conversation',
});

export const NOTES_BEATS: ScriptedBeat[] = [
  {
    cue: 'open',
    decision: { role: 'peer', move: 'opener', rationale: 'Open the file; the learner asks first.' },
    text: "These are your notes for this deck. Ask me anything in here and I'll answer it properly.",
  },

  // ── §4.2 row 1: Ellie answers in full, then Max asks one follow-up ───────
  {
    cue: 'student:1',
    decision: {
      role: 'peer',
      move: 'answer_then_teach',
      targetElementId: 'C2',
      rationale: 'The learner asked in the doc chat; the thread is the Teacher’s.',
    },
    text:
      'A side channel is a second, private conversation with one agent that the others cannot see. ' +
      'On p. 3 the slide shows the cost of *not* having one: the learner posts the question to the ' +
      'group, the embarrassing half of it is public, and the deck’s own note says "Oops, this will ' +
      'expose data..". The point of /btw is that the asking is cheap again — you can check the thing ' +
      'you think you should already know without it going on the record. What it does **not** do is ' +
      'make the cost disappear: it moves it, from exposure to forwarding, because somebody still has ' +
      'to decide what crosses back into the shared thread.',
  },
  {
    cue: 'followup:1',
    decision: {
      role: 'challenger',
      move: 'quiz',
      targetElementId: 'C2',
      challenges: ['C2'],
      rationale: 'Ellie answered and no question is open, so Max asks one follow-up (§4.2).',
    },
    text:
      'Right — so put that to work. If the cost moved rather than disappeared, **who pays it now, and ' +
      'at what moment**? Answer in your own words.',
  },

  // ── §4.3: the learner goes quiet, Ellie guesses, Max puts it back ────────
  { cue: 'cue:1', decision: { role: 'peer', move: 'peer_guess', targetElementId: 'C2', rationale: '§4.3 step 1.' }, text: CUE_1 },
  {
    cue: 'prompt:1',
    decision: { role: 'challenger', move: 'max_prompt', targetElementId: 'C2', rationale: '§4.3 step 2.' },
    text:
      "Ellie's got hold of the right half — something does end up somewhere. Take the second sentence " +
      'and tell me whether you agree with it, or say what you’d put instead.',
  },

  // ── §4.2 row 4: the attempt, and the feedback it is owed ────────────────
  {
    cue: 'feedback:1',
    decision: {
      role: 'challenger',
      move: 'quiz_feedback',
      targetElementId: 'C2',
      challenges: ['C2'],
      rationale: 'Rowland 2014: feedback after every answer.',
    },
    text:
      'Partly there. You have the moment right — the cost lands when the learner decides whether to ' +
      'forward, and that is p. 5: "did not actually do so, memory protected". What is missing is who ' +
      'carries it: it is the **learner**, not the agent, and that is the whole asymmetry.\n\n' +
      "And one correction to Ellie's guess, because it was wrong and it should not stand: the side " +
      'channel does **not** end up in the same context window as the main conversation. The deck is ' +
      'explicit on p. 3 that the private turn is scoped to one agent; that separation is the feature. ' +
      'Say it back for me: what does the learner give up by forwarding?',
    ledger: {
      elements: [{ id: 'C2', level: 2, confidence: 0.8, evidence: 'last_student' }],
      notesForAgents: 'Has the moment, not the bearer.',
    },
  },

  // ── §4.4: the give-up, and the release ──────────────────────────────────
  {
    cue: 'release:1',
    decision: {
      role: 'challenger',
      move: 'quiz_answer',
      targetElementId: 'C2',
      rationale: 'The learner gave up; the answer is released in full (§4.4).',
    },
    text:
      'Fair enough. The answer: what the learner gives up by forwarding is the **privacy of having ' +
      'asked** — the question itself becomes visible, even if the answer is theirs. p. 5: "did not ' +
      'actually do so, memory protected" is the deck describing the case where they choose not to, ' +
      'and the protection it names is the protection of the *record*, not of the content. Your ' +
      'attempt already had the moment — the decision point — which is the harder half.',
  },

  // ── §4.5: after a give-up the next question on that objective is easier ──
  {
    cue: 'followup:2',
    decision: {
      role: 'challenger',
      move: 'quiz',
      targetElementId: 'C1',
      challenges: ['C1'],
      rationale: 'Pitched lower after a give-up (§4.5).',
    },
    text: 'Smaller one. In one sentence: **what is the side channel private from?**',
  },

  // ── §4.7: the sitting goes idle with that question still open ───────────
  /**
   * Two cues, one turn. Closure can land on whichever question happens to be open, so the beat is
   * registered for both of the ones this script can leave open rather than for the one the
   * narrative above happens to reach — a script that only answers `closure:2` would post an empty
   * turn when the first question is the one still hanging, which is the exact failure §4.7 exists
   * to prevent.
   */
  {
    cue: 'closure:1',
    decision: {
      role: 'challenger',
      move: 'quiz_answer',
      targetElementId: 'C1',
      rationale: 'The sitting went idle with a question open; nothing is left hanging (§4.7).',
    },
    text:
      'Leaving this one with its answer before you go: the side channel is private **from the other ' +
      'agents in the room**, not from the system and not from the transcript. p. 3: "Oops, this will ' +
      'expose data.." is about the group, which is the thing it removes.',
  },

  // ── §6: the lesson card's Start ─────────────────────────────────────────
  {
    cue: 'lesson:1',
    decision: { role: 'peer', move: 'lesson_start', targetElementId: 'C1', rationale: 'The learner pressed Start.' },
    text:
      'This one is about what the side channel is actually private *from* — which sounds obvious and ' +
      'is where most of the confusion about /btw lives. It matters because it decides what you can ' +
      'safely put in one.\n\nAsk me something to start: "who can see a /btw turn?" would do, or ' +
      '"what does it cost to forward one?"',
  },

  // ── §4.2 row 3: `@Max` ──────────────────────────────────────────────────
  {
    cue: 'student:9',
    decision: { role: 'challenger', move: 'mention_reply', rationale: 'The learner addressed Max by name.' },
    text:
      'You called, so: what I would want to see in an answer here is the *bearer* named, not just the ' +
      'mechanism. Most answers to this stop at "it is private" and never say from whom.',
  },
];

/** §6: the learner's own doc text, marked exactly as a chat attempt would be. */
export const NOTES_DOCTEXT_BEAT: ScriptedBeat = {
  cue: 'doctext:1',
  decision: {
    role: 'challenger',
    move: 'quiz_feedback',
    targetElementId: 'C2',
    challenges: ['C2'],
    rationale: 'The learner wrote in the document; it is an attempt like any other (§6).',
  },
  text:
    'Well done. What you wrote in the notes has it: the forwarding decision is the learner’s, and ' +
    'that is where the cost sits. p. 5: "did not actually do so, memory protected".',
  ledger: {
    elements: [{ id: 'C2', level: 3, confidence: 0.9, evidence: 'last_student' }],
    notesForAgents: 'Written in their own notes, in their own words.',
  },
};

/**
 * The private threads (§4.1). **Two of them**, which is the point: one with Ellie and one with
 * Max, and neither ever reaches a shared surface. `context.test.ts`'s canary is the enforcement;
 * these are the words.
 */
export const NOTES_WHISPERS: ScriptedWhisperBeat[] = [
  {
    cue: 'whisper:1',
    text:
      "Nothing leaves this thread. The short version: it's private from the other agents, which is " +
      "not the same as private full stop — and that's the distinction the question is after.",
    relayOffer: {
      draftText: 'The side channel is private from the other agents, which is not the same as private full stop.',
      defaultAttribution: 'as_me',
    },
  },
  {
    cue: 'whisper:2',
    text:
      "Between us: you're closer than your last answer sounded. You had the decision point; you just " +
      "didn't say whose decision it was. That's one word, not a rethink.",
  },
];

/**
 * The neutral REFERENCE voice. Retired as a *surface* by `collab-doc.md` §9 — the doc is the
 * artefact now — and kept here so a room that still calls the scope gets the deck's register
 * rather than an empty string.
 */
export const NOTES_REFERENCES: ScriptedReferenceBeat[] = [
  {
    cue: 'reference:1',
    text: 'The deck introduces /btw on p. 3 as a way to ask one agent something without the group seeing it.',
  },
];

/**
 * The closure beat, registered for every question number this script can leave open. Written as a
 * fan-out rather than as copies, so the words stay in one place.
 */
const CLOSURE = NOTES_BEATS.find((b) => b.cue === 'closure:1')!;
const CLOSURE_BEATS: ScriptedBeat[] = [2, 3].map((n) => ({ ...CLOSURE, cue: `closure:${n}` }));

const ALL: ScriptedBeat[] = [...NOTES_BEATS, ...CLOSURE_BEATS, NOTES_DOCTEXT_BEAT];

export function notesBeatFor(cue: string): ScriptedBeat | undefined {
  return ALL.find((b) => b.cue === cue);
}

export function notesWhisperBeatFor(cue: string): ScriptedWhisperBeat | undefined {
  return NOTES_WHISPERS.find((b) => b.cue === cue);
}

export function notesReferenceBeatFor(cue: string): ScriptedReferenceBeat | undefined {
  return NOTES_REFERENCES.find((b) => b.cue === cue);
}

export const NOTES_SCRIPT: ScriptSource = {
  conceptId: NOTES_CONCEPT_ID,
  beatFor: notesBeatFor,
  whisperBeatFor: notesWhisperBeatFor,
  referenceBeatFor: notesReferenceBeatFor,
};

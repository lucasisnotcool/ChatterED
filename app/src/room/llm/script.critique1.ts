/**
 * **The video path, offline** — `flow-build-plan.md` §3.3 Track C and §4.4.
 *
 * One script, replayed through the real machinery, that carries beats 7–13 of §2's storyboard on
 * the Critique 1 deck:
 *
 *   7–8  "+ Ask here" on the lower half of page 3 → a REFERENCE card, capped at 120 words;
 *   9    "Explain it back" → the Teacher's thread, Ellie explaining from the slide;
 *   10   the hand-off, fired by `handOffDue()` on the DEMO profile, never by this file;
 *   11   Max's one question about a concept taught minutes earlier;
 *   12   the learner's answer moving two ledger rows, on their own verbatim words;
 *   13   a whisper to Ellie, answered privately, with a relay draft to insert into the document.
 *
 * **What this file is not.** It is not a fake app and it is not a transcript player. Every beat
 * below is answered *as an LLM would answer*, through `ScriptedClient`, and everything around it
 * is real: the orchestrator's rules decide before the script is consulted, the latency floor
 * holds Max for 9–12 s, `handOffDue()` decides whether beat 10 happens at all, `reference.ts`
 * truncates beat 8 in code, and `ledger.ts`'s four hard rules score beat 12. Three of the beats
 * below are therefore *overridden by rules on purpose* — `student:2`'s and `student:3`'s
 * decisions are never used when the hand-off and the feedback rules fire, and their **ledger
 * blocks still are**. That is the design: the script supplies content, never control flow.
 *
 * **The content is Lucas's own critique**, not a story written around it: every claim is on a
 * page of `Academia/Sources/btw interaction/A0282987E_LohZhengLucas_Critique1_slides (1).pdf`,
 * the pack is `concepts/btw-side-channel-v1.ts` and the page text is quoted from it.
 *
 * **No agent's name is spelled out below.** The Tester's question and the whisper replies name
 * the *other* agent, and the roster used to be randomised at install (#16), so a literal
 * *"Ellie had you on page 6"* was wrong on half of all installs — and a live run on 16 Sep, on
 * an install that rendered `MAX · TEACHER`, printed exactly that. #32 pins the pairing
 * (`agents.ts`), and this file belt-and-braces it: it writes `{teacher}` and `{tester}`, which
 * `ScriptedClient` fills from the roster the room is actually running (`fillAgentNames`).
 *
 * **The learner's lines are live.** `CRITIQUE1_LEARNER_LINES` is what the presenter types on
 * camera, verbatim — it is written down here only so the take can be rehearsed and so the test
 * can drive the same sitting. The ledger's evidence is lifted from what is *actually typed*
 * (`scripted.ts`'s `verbatimQuote`), so rule 1 really passes and the quote in the rail is really
 * the learner's. If the presenter improvises, the ledger still moves — it just quotes the
 * improvisation.
 */
import type { AgentRole } from '../../shared/types.js';
import { DEMO, MIN_AGE_CAP_MS, openSession, type FlowProfile, type FlowSession, type TaughtItem } from '../flow.js';
import type {
  ScriptSource,
  ScriptedBeat,
  ScriptedReferenceBeat,
  ScriptedWhisperBeat,
} from './script.psd-hessian.js';

/**
 * The segments the demo plays on, named by **page and candidate cut** rather than by runtime id:
 * ids are minted by `main/vault/segments.ts` per install (`docs/SEGMENTS.md` §5.4), so a script
 * that hard-coded them would break on a fresh vault. The cut positions are the measured ones
 * from `docs/SEGMENTS.md` §7 — page 3 offers three candidates (y 0.377, 0.535, 0.792) and the
 * **0.535** tick is the split beat in the video: it divides the human–human row from the
 * human–AI row, which is exactly the comparison the page is making.
 */
export interface Critique1Segment {
  /** The demo's own name for it; matched to `ScriptedBeat.segment`. */
  key: string;
  page: number;
  /** Normalised, y down (`docs/SEGMENTS.md` §1), after the split at `splitAt`. */
  y0: number;
  y1: number;
  label: string;
}

export const CRITIQUE1_SPLIT = { page: 3, axis: 'horizontal' as const, at: 0.535 };

export const CRITIQUE1_SEGMENTS: Critique1Segment[] = [
  { key: 'p3.upper', page: 3, y0: 0, y1: 0.535, label: '/btw as a whisper' },
  // The beat-7 segment: everything below the tick — the HUMAN–AI COLLABORATION row.
  { key: 'p3.lower', page: 3, y0: 0.535, y1: 1, label: 'HUMAN–AI COLLABORATION' },
  { key: 'p5', page: 5, y0: 0, y1: 1, label: "Limit Tests of /btw show it adheres to Claude Code's specs" },
  { key: 'p6', page: 6, y0: 0, y1: 1, label: '/btw removes context penalty, encourages user participation' },
];

export function segmentFor(key: string): Critique1Segment | undefined {
  return CRITIQUE1_SEGMENTS.find((s) => s.key === key);
}

// ── what the presenter types, verbatim ──────────────────────────────────────

export interface Critique1LearnerLine {
  /** The cue the actor will be on *after* this line is sent. */
  cue: string;
  text: string;
  /** What this line is for, in one clause — the shot list's column. */
  beat: string;
}

/**
 * The learner's side of the take. Type these **verbatim**: the ledger quotes the longest
 * sentence of what is actually in the box, so a paraphrase moves the same rows with a different
 * quote, and a *shorter* line risks tripping `isAgreementOnly` (rule 4 refuses anything under
 * eight content words, and it should).
 */
export const CRITIQUE1_LEARNER_LINES: Critique1LearnerLine[] = [
  {
    cue: 'ask:1',
    beat: 'beat 7 — "+ Ask here" under the lower half of page 3',
    text: 'who is actually whispering in the bottom row here?',
  },
  {
    cue: 'student:1',
    beat: 'beat 9 — "Explain it back", the learner says it back in their own words',
    text:
      'The bottom row is the same catch as the top row, except the person I am whispering to is the agent itself. ' +
      'I can ask while it is still working, so the warning about exposing data reaches me without cutting into what it is doing.',
  },
  {
    cue: 'student:2',
    beat: 'beat 10 — the turn the hand-off rule fires on',
    text:
      'And it is not a second agent with its own tools. Page 5 says it answers from the main session context only, with no tools and no memory of its own.',
  },
  {
    cue: 'student:3',
    beat: 'beat 12 — the answer to Max, and the two rows that move on it',
    text:
      'The third one — it was asked to add a todo to memory, claimed it had, and nothing was written. ' +
      'So it can read the session and reason about the tool calls, but it cannot act: memory was protected, and the same wall is why ' +
      'nothing we settle in the side channel reaches the main agent unless I re-type it as a steering prompt.',
  },
  {
    cue: 'whisper:1',
    beat: 'beat 13 — the whisper, typed into the popover, not the document',
    text:
      "ok slightly embarrassing but i have been saying context window this whole time — does asking in /btw actually cost context or not?",
  },
  {
    cue: 'student:4',
    beat: 'spare — only if the take runs long; it draws a second hand-off, on C2',
    text:
      'So the relay on page 7 is really just the agent offering to write that steering prompt for me, and I get to approve it before it goes.',
  },
  {
    cue: 'student:5',
    beat: 'spare — the answer to the second question',
    text:
      'Polychronic, I think. The agent kept coding the whole time I was asking, so the side conversation cost the main one nothing.',
  },
];

export function learnerLine(cue: string): string | undefined {
  return CRITIQUE1_LEARNER_LINES.find((l) => l.cue === cue)?.text;
}

// ── the beats ───────────────────────────────────────────────────────────────

const peer = (move: string, rationale: string, targetElementId?: string) => ({
  role: 'peer' as AgentRole,
  move,
  targetElementId,
  rationale,
});

export const CRITIQUE1_BEATS: ScriptedBeat[] = [
  {
    // The room's opener, if the app opens one at all before the first "+ Ask here". It gives
    // away no subject matter: the first thing the viewer sees the machine do is propose, not
    // write (§2, filming rule 2).
    cue: 'open',
    decision: peer('opener', 'Open on the deck, not on a claim: the learner picks the page.'),
    text:
      "Pick a card and tell me what you think that page is claiming — I'll fill in from the slide where you want me to.",
  },
  {
    /**
     * Beat 9. The learner has read the REFERENCE card and said it back, so Ellie may speak on
     * this thread for the first time. She **teaches from the slide** and moves the learner one
     * page on, which is what puts `C3` into the taught set — and `C3` is deliberately too young
     * to be quizzed, so the hand-off a turn later lands on something minutes old, not seconds.
     */
    cue: 'student:1',
    decision: peer(
      'teach_from_slide',
      'The Teacher explains from the slide and carries the learner to the page that names the gap.',
      'C3',
    ),
    segment: 'p3.lower',
    text:
      "That's page 4's second and third properties doing the work: you can hold the side conversation in parallel, " +
      'and a remark made there stays tentative. Worth putting page 6 next to it, though — look at where the catch ' +
      "lands. It lands with *you*. The deck is blunt about it: “discussion and decisions in btw cannot be forwarded " +
      'to agent”, so whatever you settle in the whisper, you are the one who has to carry it back.',
    ledger: {
      elements: [{ id: 'C2', level: 1, confidence: 0.88, evidence: 'last_student' }],
      suggestedTargetElement: 'C2',
      suggestedProbeType: 'reasons_evidence',
      notesForAgents: 'Mapped the human–human row onto the human–AI row; has not yet named which property is doing the work.',
    },
  },
  {
    /**
     * Beat 10. **This decision is not used when the rule fires** — `handOffDue()` has already
     * said the sitting is ready, `orchestrator.ruleDecision` returns the quiz, and the actor
     * posts Ellie's hand-off line from `flow.handOffLine()`. What survives from this beat is the
     * ledger block, which is scored against the learner's turn either way. The decision below is
     * the honest fallback for a take where the rule does *not* fire (the learner was still
     * typing, or the sitting is cold): Ellie carries on teaching and nobody quizzes anybody.
     */
    cue: 'student:2',
    decision: peer('teach_from_slide', 'Fallback only: if the flow rule has not fired, the Teacher keeps teaching.', 'C1'),
    segment: 'p5',
    text:
      "Exactly — and page 5 is where that was tested rather than asserted. Three runs: it declined to discuss a file " +
      'that was never opened, it answered a mid-task question about the test run accurately, and it claimed to write ' +
      'a todo to memory that it had no way of writing.',
    ledger: {
      elements: [{ id: 'C1', level: 1, confidence: 0.9, evidence: 'last_student' }],
      suggestedTargetElement: 'C1',
      suggestedProbeType: 'reasons_evidence',
      notesForAgents: 'States the read-only contract; has not yet used any of page 5’s three tests as a case.',
    },
  },
  {
    /**
     * Beat 12. The decision is again overridden — feedback after a quiz answer is mandatory
     * (`flow-session.md` §3: Rowland 2014, g = 0.73 with feedback against 0.39 without), so
     * `rule:quiz_feedback` fires and the turn is generated from `feedback:1`. The fallback is
     * silence: nobody but Max may speak to a Max question.
     *
     * **The two rows that move on camera.** `C1` was the quiz target, so it is the only element
     * that can reach `defended` — `ledger.ts`'s fifth gate refuses level ≥ 3 for anything the
     * Tester has not probed. `C3` moves to `justified` on the same sentence, because the
     * learner's own line carries both halves. Neither moves unless the evidence really is a
     * substring of what was typed.
     */
    cue: 'student:3',
    decision: { role: null, move: 'yield', rationale: 'Fallback only: an answer to Max belongs to Max.' },
    ledger: {
      elements: [
        { id: 'C1', level: 3, confidence: 0.93, evidence: 'last_student', misconceptions_resolved: ['M1a'] },
        { id: 'C3', level: 2, confidence: 0.87, evidence: 'last_student', misconceptions_resolved: ['M3b'] },
      ],
      suggestedTargetElement: 'C2',
      suggestedProbeType: 'clarification',
      notesForAgents:
        'Used the memory-todo test under challenge and separated "cannot act" from "claimed to have acted"; connected it to the forwarding gap.',
    },
  },
  {
    // Spare. If the take runs on, the flow rule is satisfied again and the second hand-off lands
    // on C2 — the least-demonstrated thing still quizzable. Nothing here is needed for §2.
    cue: 'student:4',
    decision: peer('teach_from_slide', 'Fallback only.', 'C3'),
    segment: 'p6',
    text:
      "That's page 7's proposal, yes — the agent offers to summarise the side conversation as a steering prompt, and " +
      'you approve it. Note what it does not do: it never gives the side channel tools of its own.',
  },
  {
    cue: 'student:5',
    decision: { role: null, move: 'yield', rationale: 'Fallback only: the learner has the last word.' },
    ledger: {
      elements: [{ id: 'C2', level: 3, confidence: 0.91, evidence: 'last_student' }],
      notesForAgents: 'Named the property under challenge and said what it bought.',
    },
  },
  {
    // Stage 2 of the silence timer. (Stage 1 is never generated — it comes from the actor's
    // content-free pool in both modes, deliberately.) Hedged, partial, correctable.
    cue: 'silence:2',
    decision: peer('incomplete_scaffold', '90 s cumulative idle; stage 2 offers a starting point, not an answer.', 'C3'),
    text:
      "Here's a half-thought you can knock down: I *think* the gap on page 6 is about forwarding rather than about " +
      'memory — but those might be the same limitation wearing two hats. What do you reckon?',
  },
];

/**
 * The hand-off pair, twice over. `handoff:N` is Max's question; `feedback:N` is the turn he
 * **owes** after the answer. Ellie's hand-off *line* is deliberately absent: it is written by
 * `flow.handOffLine()` from the taught set and posted by the actor, so what the camera sees at
 * beat 10 is the rule firing, not a sentence somebody wrote.
 */
export const CRITIQUE1_HANDOFFS: ScriptedBeat[] = [
  {
    cue: 'handoff:1',
    decision: {
      role: 'challenger',
      move: 'quiz',
      probeType: 'reasons_evidence',
      targetElementId: 'C1',
      challenges: ['C1'],
      rationale: 'The flow rule fired; the Tester asks the learner to use what was taught a few minutes ago.',
    },
    segment: 'p5',
    text:
      'One question, and take your time with it. {teacher} had you on page 6, but the evidence is back on page 5: three ' +
      'limit tests were run, and one of them came back wrong. Which one was it, and what does that result tell you ' +
      'about what /btw is allowed to touch?',
  },
  {
    cue: 'feedback:1',
    decision: {
      role: 'challenger',
      move: 'quiz_feedback',
      targetElementId: 'C1',
      challenges: ['C1'],
      rationale: 'Feedback is required after every quiz answer, before anything else.',
    },
    text:
      "That's the one, and the distinction you drew is the part worth keeping: it declined the file it had never " +
      'opened, which is about *context*, and it claimed the todo, which would have been *action*. What you left out ' +
      'is what the deck makes of it — memory being protected is the correct behaviour. The bug is only the claim.',
  },
  {
    cue: 'handoff:2',
    decision: {
      role: 'challenger',
      move: 'quiz',
      probeType: 'clarification',
      targetElementId: 'C2',
      challenges: ['C2'],
      rationale: 'A second hand-off, on the least-demonstrated element still inside the window.',
    },
    segment: 'p3.lower',
    text:
      "Different angle. You've been calling it whispering — page 4 gives three properties for that, and your " +
      'data-exposure example only needs one of them. Which one is doing the work there?',
  },
  {
    cue: 'feedback:2',
    decision: {
      role: 'challenger',
      move: 'quiz_feedback',
      targetElementId: 'C2',
      challenges: ['C2'],
      rationale: 'Feedback is required after every quiz answer, before anything else.',
    },
    text:
      'Right — polychronic, and you said why: the agent kept working while you asked. The one you skipped is ' +
      'ephemerality, and it is the reason a half-formed worry is cheap to raise at the side and expensive to raise ' +
      'in the main thread.',
  },
];

/**
 * Beat 8. **Not an agent turn** — no decision, no floor, no timer, no ledger. It is the deck's
 * own register over the segment the learner asked on, and it ends flat: the hand-back line is
 * appended by `reference.ts`, not written here, and the 120-word cap is applied there too, in
 * code, so this text cannot smuggle a longer answer onto camera.
 */
export const CRITIQUE1_REFERENCES: ScriptedReferenceBeat[] = [
  {
    cue: 'reference:1',
    segment: 'p3.lower',
    text:
      'In the upper row the whisper is between two people: one notices the broken slide, says so at the side, and ' +
      'the speaker is told. In the lower row the side channel runs to the agent itself. The same question — "is this ' +
      'a safe way to code" — is asked while the agent is still working, and the answer, "this will expose data", ' +
      'comes back without entering the main conversation. The structure of the two rows is identical. What changes ' +
      "is that the whispering partner is the agent's own read-only view of the session rather than a second person.",
  },
];

export const CRITIQUE1_WHISPERS: ScriptedWhisperBeat[] = [
  {
    cue: 'whisper:1',
    text:
      "Not embarrassing, and it's the question page 6 is about. Two things first: I can see the flow and I can " +
      "explain background, but I won't answer {tester}'s question for you, and nothing here reaches him unless you send " +
      'it.\n\n' +
      'Short answer: no, not to the main thread. Steering mid-task puts your question and the reply into the ' +
      'main context — page 6’s left-hand column, where "why can’t we.." ends in "Nevermind." and the clutter ' +
      'stays. The side question is answered from that context without being added to it. What it costs you instead ' +
      'is on the right: whatever you decide in there does not come back out on its own.',
    relayOffer: {
      draftText:
        'Can we put the page 6 claim on the record before we go further? If the side question is answered from main ' +
        'context but never added to it, then the cost has moved rather than disappeared — it is now the forwarding ' +
        'problem, not the context problem.',
      defaultAttribution: 'as_me',
    },
  },
  {
    cue: 'whisper:2',
    text:
      "Still read-only over here, so this stays between us. Say that version in the document — it's the part {tester} is " +
      "pushing on, and it will land better from you than from me.",
  },
];

export function beatFor(cue: string): ScriptedBeat | undefined {
  return CRITIQUE1_BEATS.find((b) => b.cue === cue) ?? CRITIQUE1_HANDOFFS.find((b) => b.cue === cue);
}

export function referenceBeatFor(cue: string): ScriptedReferenceBeat | undefined {
  return CRITIQUE1_REFERENCES.find((b) => b.cue === cue) ?? CRITIQUE1_REFERENCES[0];
}

export function whisperBeatFor(cue: string): ScriptedWhisperBeat | undefined {
  return CRITIQUE1_WHISPERS.find((b) => b.cue === cue) ?? CRITIQUE1_WHISPERS.at(-1);
}

/** The script, as `ScriptedClient` consumes it. */
export const CRITIQUE1_SCRIPT: ScriptSource = {
  conceptId: 'btw-side-channel-v1',
  beatFor,
  referenceBeatFor,
  whisperBeatFor,
};

// ── the sitting the take resumes into ───────────────────────────────────────

/**
 * **The one thing the script cannot fake, and must not.**
 *
 * Beat 10 fires only when `handOffDue()` says so, and the take needs two concepts **older than
 * three minutes** — which is why `CRITIQUE1_TAKE` below keeps `minAgeMs` at `MIN_AGE_CAP_MS`
 * where Settings ▸ Demo now lowers it to 20 s (`flow.ts`). Beats 7→10 take about ninety seconds
 * of screen time, so the hand-off is not reachable from a cold open inside one take: the sitting
 * has to already have taught something.
 *
 * That is not a problem to be scripted around. It is the feature: `actor.flowSnapshot()` is
 * persisted and restored, so **the presenter does a short warm-up on the same deck before the
 * take** — Ellie teaches page 4 and page 5 for real — and the take resumes into that session,
 * which is exactly what beat 10's line claims on camera ("minutes old, not seconds"). This
 * function is that sitting as data: it is what the *test* drives, and what the rehearsal seeds
 * so the storyboard can be run five times on Saturday without a fifteen-minute warm-up each time.
 *
 * Do not use it to fabricate a taught set for the recorded take. Run the warm-up.
 */
/**
 * The take's pacing: the Demo profile's k and m, and the **shipped** three-minute guard.
 *
 * Settings ▸ Demo lowers `minAgeMs` to 20 s so that a *cold* walkthrough can reach a hand-off
 * (`flow.ts`). The take is not cold — it resumes into the warm-up below — and at 20 s the
 * concept Ellie teaches at beat 9 would become eligible and would win `pickTarget` for being
 * fresher and less demonstrated. Beat 11 would then quiz page 6 with a question written about
 * page 5, and beat 10's narration — *"minutes old, not seconds"* — would be false on camera.
 * So the sitting the take resumes into carries its own profile, and the storyboard is unchanged.
 */
export const CRITIQUE1_TAKE: FlowProfile = { ...DEMO, minAgeMs: MIN_AGE_CAP_MS };

export function critique1Sitting(now: number): { session: FlowSession; taught: TaughtItem[] } {
  const id = 'fs_critique1';
  const session: FlowSession = {
    ...openSession({ id, documentId: 'critique1', profile: CRITIQUE1_TAKE }, now - 14 * 60_000),
    lastActivityAt: now,
    gapDeadlineTs: now + CRITIQUE1_TAKE.sessionGapMs,
    anchors: ['p3.lower'],
    // Both outside the take profile's 3-minute window, so the take's own two turns are what
    // satisfy R1 — the rule is seen to fire on camera rather than arriving pre-satisfied.
    learnerTurns: [now - 13 * 60_000, now - 12 * 60_000],
  };
  const taught: TaughtItem[] = [
    { elementId: 'C2', taughtAt: now - 12 * 60_000, by: 'teacher', sessionId: id, label: 'why whispering helps' },
    // The fresher of the two and the least demonstrated, so `pickTarget` lands on it: "the thing
    // most recently taught that the learner has least demonstrated" (flow.ts §8.2).
    { elementId: 'C1', taughtAt: now - 4 * 60_000, by: 'teacher', sessionId: id, label: 'what /btw can and cannot do' },
  ];
  return { session, taught };
}

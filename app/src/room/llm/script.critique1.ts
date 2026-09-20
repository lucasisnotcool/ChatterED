/**
 * **The video path, offline** — `flow-build-plan.md` §2 (re-cut for #47) and §3.3 Track C.
 *
 * One script, replayed through the real machinery, that carries the **attempt loop** — the hero
 * interaction of `docs/research/attempt-first.md` §2 and §6 — on the Critique 1 deck:
 *
 *   `try:1`      "+ Try this" under the lower half of page 3; the Tester asks **one** question on
 *                the objective that card teaches (the whisper analogy, `C2`);
 *   `attempt:1`  the learner's own attempt, typed on camera, **partly right** on purpose;
 *   `feedback:1` grounded feedback (§3): what landed, what was missing, the correction, each with
 *                a `p. N: "…"` quote of the deck's own words — and the ledger moves on the
 *                learner's sentence, not on this text;
 *   `try:2`      "+ Try this" on page 5, the objective still at ○ (the three limit tests, `C1`);
 *   `hint:2`     the learner asks for the answer with none given yet, so the answer is **withheld**:
 *                one narrowing hint and one clause saying that one try unlocks it;
 *   `student:N`  the explain path — "+ Ask here", and the Teacher explains the prerequisite the
 *                deck assumes and never teaches (a session's *context*);
 *   `attempt:2`  the second attempt;
 *   `feedback:2` grounded feedback again, on page 5;
 *   `answer:2`   **Show the answer** — available now, and only now. It moves nothing.
 *
 * **What this file is not.** It is not a fake app and it is not a transcript player. Every beat
 * below is answered *as an LLM would answer*, through `ScriptedClient`, and everything around it
 * is real: the orchestrator's rules decide **before** the script is consulted, the latency bands
 * hold the Tester's feedback for 9–12 s while his *question* uses the short band (the learner
 * asked for it — `attempt-first.md` §2.1), and `ledger.ts`'s four hard rules score the attempt.
 *
 * **Which of these decisions are nominal.** The same convention this file has always used for the
 * hand-off, now over four more cues: `try:N`, `hint:N`, `answer:N` and `feedback:N` are all
 * reached by **rules in the orchestrator** (`rule:try_here`, `rule:answer_withheld`,
 * `rule:answer_shown`, `rule:quiz_feedback`), which run before any model or script is asked
 * anything. The `decision` on those beats is therefore never used on the take; it is written down
 * because it is the honest fallback for a run where the rule did not fire, and because a beat
 * with no decision would make `decisionFor` say "the room stays quiet".
 *
 * **Two seams the take runs into, both on the other side of the contract.** The actor side landed
 * while this was being written, so the loop below is driven end to end in the test — and two beats
 * of §2 do not yet arrive:
 *
 *  1. **The rail does not move on an attempt** (§2 beat 8). The ledger blocks are on `feedback:1`
 *     and `feedback:2`, because a judgement of the attempt belongs to the turn that judges it — but
 *     `actor.ts` cues the *turn* with `feedback:N` and the *ledger call* with the learner cue
 *     (`#updateLedger(cue, …)`, `cue` = `student:N`), which reaches the explain beat and proposes
 *     nothing. The proposal has to travel with the turn it judges.
 *  2. **An Ask into a card with an open question is given to the Tester** (§2 beat 11). `askHere`
 *     runs an ordinary learner turn, so §2.2 classifies it; the take's Ask is 39 words, over the
 *     25-word ceiling on `question`, so it is read as an *attempt* and draws `rule:quiz_feedback`
 *     — and it unlocks the answer. An Ask is an explicit request for the Teacher and should take
 *     `rule:teacher_answers` whether or not a quiz is open on that card.
 *
 * Both are bugs in `actor.ts` / `orchestrator.ts` against `attempt-first.md` §2.3 and §6, not in
 * this file, and both are pinned in `script.critique1.test.ts` with the fix named — so they fail
 * loudly when they are fixed rather than silently staying broken.
 *
 * **The content is Lucas's own critique**, not a story written around it: every claim is on a
 * page of `Academia/Sources/btw interaction/A0282987E_LohZhengLucas_Critique1_slides (1).pdf`,
 * the pack is `concepts/btw-side-channel-v1.ts`, and **every `p. N: "…"` in a feedback or answer
 * beat below is a verbatim substring of `CRITIQUE1_PAGE_TEXT[N]`** — asserted in the test, which
 * is the code-side half of §3's promise that grounds can be checked. §3 leaves the *live*
 * backend's quotes unverified on purpose (A2's first job); the scripted path has no excuse.
 *
 * **No agent's name is spelled out below.** The Tester's questions and the whisper replies name
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
 * improvisation. Both attempts are **partly right on purpose**: feedback with nothing to correct
 * is a compliment, and `findings.md` RQ4 (11 of 21 verdicts wrong, 9 false negatives) is the
 * reason the correction has to be checkable rather than merely present.
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
  // Where the attempt loop starts: everything below the tick — the HUMAN–AI COLLABORATION row.
  { key: 'p3.lower', page: 3, y0: 0.535, y1: 1, label: 'HUMAN–AI COLLABORATION' },
  // Where it goes for its second question, and where the Ask lands.
  { key: 'p5', page: 5, y0: 0, y1: 1, label: "Limit Tests of /btw show it adheres to Claude Code's specs" },
  { key: 'p6', page: 6, y0: 0, y1: 1, label: '/btw removes context penalty, encourages user participation' },
];

export function segmentFor(key: string): Critique1Segment | undefined {
  return CRITIQUE1_SEGMENTS.find((s) => s.key === key);
}

// ── what the presenter types, verbatim ──────────────────────────────────────

export interface Critique1LearnerLine {
  /**
   * The take's name for this line. For the two attempts and the answer request it names the
   * **learner move** (`attempt:1`, `askanswer:2`) rather than a script cue — those moves are
   * classified in code (`attempt.ts`'s `classifyLearnerTurn`), and what comes back is cued by
   * the rule that fired, not by the line. For `ask:1` and `whisper:1` it is the cue the agent
   * answers under.
   */
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
    cue: 'attempt:1',
    beat: 'the first attempt — answers `try:1` on the page 3 card; partly right, so feedback has work to do',
    text:
      'The whisper is going to the agent itself rather than to a second person, and I think the property doing the ' +
      'work is politeness, because asking in the main thread would have been a rude interruption while it was ' +
      'still coding.',
  },
  {
    cue: 'askanswer:2',
    beat: 'the answer request, in R6’s own words — attempts are 0, so the answer is withheld (`hint:2`)',
    // findings.md RQ5: R6 asked in exactly these words, five times before L20 and twice after.
    text: "what's the answer?",
  },
  {
    cue: 'ask:1',
    beat: 'the explain path — "+ Ask here" on the page 5 card, on the prerequisite the deck assumes',
    text:
      'before I try that — what does page 5 mean by context being a strict subset of the main session? i keep ' +
      'reading context as the context window and I do not think that is what it is saying here.',
  },
  {
    cue: 'attempt:2',
    beat: 'the second attempt — the row and the falsehood, but not which half of it is the bug',
    text:
      'I think it is the third one — it was asked to write a todo into memory and said it had, so its answer was ' +
      'false, and that is the bug because the other two tests came back true.',
  },
  {
    cue: 'whisper:1',
    beat: 'the whisper, typed into the popover, not the document',
    text:
      "ok slightly embarrassing but i have been saying context window this whole time — does asking in /btw actually cost context or not?",
  },
  {
    cue: 'warmup:1',
    beat:
      'spare — **not on the take**. A read-back question, for rehearsing the *secondary* door: the time-based ' +
      'hand-off needs k learner turns in the window and this is one of them.',
    text:
      'Let me try saying it back. Both rows have the same structure, and the only thing that changes ' +
      'underneath is that the whispering partner is the agent itself. Is that the whole of it, or does the bottom row ' +
      'buy something the top one does not?',
  },
  {
    cue: 'warmup:2',
    beat: 'spare — not on the take; the second turn the secondary door needs, and it points at page 5',
    text:
      'And where is any of that tested rather than asserted? Page 5 has a table of limit tests on it, and I have not ' +
      'worked out yet what the three of them add up to.',
  },
];

export function learnerLine(cue: string): string | undefined {
  return CRITIQUE1_LEARNER_LINES.find((l) => l.cue === cue)?.text;
}

/** The two lines the take types as *attempts*, which is what the ledger is allowed to quote. */
export const CRITIQUE1_ATTEMPT_CUES = ['attempt:1', 'attempt:2'] as const;

// ── the beats ───────────────────────────────────────────────────────────────

const peer = (move: string, rationale: string, targetElementId?: string) => ({
  role: 'peer' as AgentRole,
  move,
  targetElementId,
  rationale,
});

/** The Tester, for the four rule-driven moves of `attempt-first.md` §2.3. Nominal, all of them. */
const tester = (move: string, targetElementId: string, rationale: string, probeType?: string) => ({
  role: 'challenger' as AgentRole,
  move,
  probeType,
  targetElementId,
  challenges: [targetElementId],
  rationale,
});

export const CRITIQUE1_BEATS: ScriptedBeat[] = [
  {
    /**
     * The room's opener, if the app opens one at all before the first door is used. It gives away
     * no subject matter: the first thing the viewer sees the machine do is propose, not write
     * (§2, filming rule 2). It now names **both** doors, because the one the take uses is the one
     * that did not exist when this line was written.
     */
    cue: 'open',
    decision: peer('opener', 'Open on the deck, not on a claim: the learner picks the page and the door.'),
    text:
      "Pick a card. **+ Ask here** and I'll explain it from the slide; **+ Try this** and {tester} will ask you " +
      'something about it instead — your call which way round.',
  },
  {
    /**
     * **The explain path, and the only Teacher beat in the take** (`attempt-first.md` §6: "Ellie's
     * '+ Ask here' appears once, as the explain path, when the second question needs a
     * prerequisite"). It sits between `hint:2` and `attempt:2`: the learner has been told the
     * answer is withheld, realises they do not have the prerequisite, and asks for *that* instead
     * of for the answer — which is the whole argument for keeping the answer-first Ask one click
     * away (#41) next to a door that withholds.
     *
     * The prerequisite is `session-context` from `main/objectives/critique1.ts` — `assumedByDeck`,
     * because page 2 says "without affecting main session context" and page 5 says "strict subset"
     * and the deck defines neither. She answers in her first sentence (#36 ANSWER FIRST), teaches
     * in a sentence or two per step, and stays **under 180 words** (§4, house rule 3 as revised).
     *
     * **It must not answer `try:2`.** The question on the floor is which of the three limit tests
     * is the bug; what she explains is what "context" means. The distinction is the reason the two
     * doors can be open at once, and `rule:answer_withheld` is what keeps her honest — she says so.
     *
     * **This is the only beat any `student:N` cue can reach** (see `beatFor`), which is deliberate:
     * the cue counts the *process's* learner turns, the take's Ask is somewhere around the third of
     * them, and a script that guessed the ordinal would put the wrong explanation on camera.
     */
    cue: 'student:1',
    decision: peer(
      'answer_then_teach',
      'The learner asked in a segment thread; the thread is the Teacher’s and she answers it.',
      'C3',
    ),
    segment: 'p5',
    text:
      'Not the context window — the **session**, which is everything this run of the agent can see: your prompts, ' +
      'its replies, and the output of every tool call it has made. Page 5 calls the side channel a strict subset of ' +
      'that. Two halves to it. It can *see* the session, which is why the mid-task question about the test run came ' +
      'back accurate; and it cannot *add* to it, which is why the file that was never opened was simply not there ' +
      'to discuss. A window is a size. A subset is a boundary, and the boundary is what the page is about.\n\n' +
      "One thing I will not do: {tester}'s question is his, and I am not going to answer it for you. Ask me for " +
      'background as often as you like.',
    ledger: {
      // A question, not a claim. Nothing of the learner's to quote, so nothing is proposed — and
      // no gate fires, which is different from a gate refusing an advance.
      elements: [],
      // C3, not C1: what the strict-subset idea sets up next is the forwarding gap (nothing
      // decided in there comes back out), and naming C1 here would re-teach the element the
      // second question is about, which on the secondary door would move the hand-off's target.
      suggestedTargetElement: 'C3',
      suggestedProbeType: 'clarification',
      notesForAgents:
        'Asked what "a strict subset of the main session" means — a prerequisite the deck assumes. A question, ' +
        'not a claim, and not an attempt at the open quiz.',
    },
  },
];

/**
 * **The questions.** Two doors, one counter: `attempt-first.md` §2.4 keeps the time-based
 * hand-off as the secondary path, and N counts the Tester's questions across both of them — so
 * `try:1` and `handoff:1` are alternative *first* questions and share `feedback:1`.
 *
 * Which is why **both doors ask in the same order**: `C2` (the whisper analogy, page 3–4) first,
 * `C1` (the three limit tests, page 5) second. It used to be the other way round for the
 * hand-off, and a hand-off that fired during the attempt loop would then have drawn feedback
 * written about the other page. The warm-up's taught set is ordered to match (`critique1Sitting`),
 * so `pickTarget` agrees with the script instead of racing it.
 *
 * **No beat here carries a `ledger` block**, which is what makes the "repeat the last question of
 * the same kind" fallback in `beatFor` safe: a repeated question cannot move a row.
 */
export const CRITIQUE1_QUESTIONS: ScriptedBeat[] = [
  {
    /**
     * **Beat: "+ Try this"** — `attempt-first.md` §2.1. The objective is the one the card teaches
     * (`whisper-analogy`, refs pages 3 and 4 → pack element `C2`), and the question is built from
     * that objective's two `quizSeeds`: *"Whispering to whom, in the bottom row of page 3?"* and
     * *"Which of Dennis's three properties is doing the work in the page 3 example?"*
     *
     * One question mark, because one question is the contract. The *latency* is the short band
     * here and not the Tester's 9–12 s: the learner pressed the button, and Tan et al.'s
     * considered-judgement finding is about the judgement, which is `feedback:1`.
     */
    cue: 'try:1',
    decision: tester(
      'quiz',
      'C2',
      'Nominal: `rule:try_here` fired on the learner pressing "+ Try this" under this card.',
      'reasons_evidence',
    ),
    segment: 'p3.lower',
    text:
      'You asked for it, so here it is — one question on the row you have just split out. In the bottom row of ' +
      'page 3 the catch comes back through the side channel instead of interrupting the work: who is the whisper ' +
      'going to there, and which of page 4’s three properties is doing the work in that example?',
  },
  {
    /**
     * **Beat: "Try another", on the objective still at ○.** After `feedback:1` the whisper analogy
     * is at ◐ and the three limit tests are still at ○, so the lowest-level pick is page 5's — the
     * form response behind `attempt-first.md` §1 ("I prompted it to ask questions based on my
     * weaknesses") as a button rather than as a prompt.
     *
     * Near-verbatim from `limit-tests`'s first `quizSeed`.
     */
    cue: 'try:2',
    decision: tester(
      'quiz',
      'C1',
      'Nominal: `rule:try_here` again, on the card whose objective is the lowest on the rail.',
      'reasons_evidence',
    ),
    segment: 'p5',
    text:
      'Page 5, then — and this one you have shown me nothing on yet. Three limit tests were run and one of them ' +
      'came back wrong: which one is the bug, and what makes it a bug rather than a limit?',
  },
  {
    /**
     * The **secondary** door's first question (`flow-session.md` §8.2, unchanged and now secondary).
     * Ellie's hand-off *line* is deliberately absent: it is written by `flow.handOffLine()` from
     * the taught set and posted by the actor, so what the camera would see is the rule firing,
     * not a sentence somebody wrote. On the take this never fires — `CRITIQUE1_TAKE` puts `k` out
     * of the take's reach on purpose — and it is kept because the rule it belongs to is still
     * shipped, and because a hand-off with nothing behind it is the one failure this file must
     * not have.
     */
    cue: 'handoff:1',
    decision: tester(
      'quiz',
      'C2',
      'Nominal: the flow rule fired; the Tester asks the learner to use what was taught a few minutes ago.',
      'clarification',
    ),
    segment: 'p3.lower',
    text:
      "Different angle, and {teacher} has done the teaching. You've been calling it whispering — page 4 gives three " +
      'properties for that, and the data-exposure example on page 3 only needs one of them: which one is doing the ' +
      'work there?',
  },
  {
    cue: 'handoff:2',
    decision: tester(
      'quiz',
      'C1',
      'Nominal: a second hand-off, on the least-demonstrated element still inside the window.',
      'reasons_evidence',
    ),
    segment: 'p5',
    text:
      '{teacher} had you on page 6, but the evidence is back on page 5: three limit tests were run, and one of them ' +
      'came back wrong. Which one was it, and what does that result tell you about what /btw is allowed to touch?',
  },
];

/**
 * **What the Tester says after the learner's turn** — the four rules of `attempt-first.md` §2.3,
 * one beat each, per question.
 *
 * Every `feedback:N` and `answer:N` below **cites its grounds** in §3's form: `p. N: "…"`, quoting
 * the deck's own words verbatim. That is prompt-level in the live backend and unverified there on
 * purpose; here the test verifies every quote against `CRITIQUE1_PAGE_TEXT`, because a scripted
 * beat that misquotes the deck on camera would be the demo telling the lie the demo is about.
 *
 * Word budgets from §4: feedback **under 100 words**, an answer **under 150**. No feedback beat
 * asks a question (Rowland's constraint: the next question is a click, not a clause).
 */
export const CRITIQUE1_QUIZ_TURNS: ScriptedBeat[] = [
  {
    /**
     * **The hero beat.** What landed, what was missing, the correction — each with its grounds,
     * and one clause that says where the deck does *not* settle the point rather than settling it
     * anyway. `findings.md` RQ4 is the reason: 11 of 21 verdicts in the SQL session were wrong, 9
     * of them called a correct answer wrong, and the learner said "ok" to them. A verdict the
     * learner can check is the only kind that earns the trust it is asking for.
     *
     * **The ledger block is the judgement of the attempt**, and the rail moves on the *learner's*
     * sentence: `evidence: 'last_student'` makes `scripted.ts` lift the longest sentence of what
     * was actually typed, so rule 1 passes honestly.
     *
     * `C2` to **2, justified** — the attempt maps the two rows of page 3 (criterion 3) and names
     * the interruption cost (criterion 1), which is a mechanism, so ◐ is earned. Not 3: `defended`
     * needs the element challenged *and* the answer to survive the challenge, and this one does
     * not — it reaches for politeness, which is `M2a`, and the misconception rides along with the
     * advance rather than being quietly dropped.
     *
     * `C1` is named at **0 on purpose**, with no evidence: the attempt says nothing about the
     * limit tests. It is a no-op through `applyLedgerRules` (no advance, no gate, no history row)
     * and it is what makes the next beat legible — the row "Try another" picks is the one still at
     * ○, and the rail shows it standing still while its neighbour moves.
     */
    cue: 'feedback:1',
    decision: tester('quiz_feedback', 'C2', 'Nominal: `rule:quiz_feedback` fired — feedback after an attempt is mandatory.'),
    text:
      'Partly there. The partner is right: the whisper goes to the agent, and p. 3: "Oops, this will expose ' +
      'data.." is the catch coming back through it, not through the main thread. The interruption cost is real ' +
      'too — p. 3: "*Coding...*" runs straight through your question. What is missing is the property: politeness ' +
      'is one of page 4’s *benefits*, not one of its three properties. The one your example needs is p. 4: ' +
      '"Polychronic — hold conversation in parallel". Whether ephemerality is also at work, the deck does not ' +
      'settle. So, in your own words: why polychronic rather than polite?',
    ledger: {
      elements: [
        { id: 'C2', level: 2, confidence: 0.86, evidence: 'last_student', misconceptions_present: ['M2a'] },
        { id: 'C1', level: 0, confidence: 0.9, evidence: 'none' },
      ],
      suggestedTargetElement: 'C1',
      suggestedProbeType: 'reasons_evidence',
      notesForAgents:
        'Mapped the human–human row onto the human–AI row and named the interruption cost, so justified; ' +
        'reached for politeness, which is a benefit rather than one of the three properties (M2a open). Nothing ' +
        'shown on the limit tests — that is the lowest row and the next question.',
    },
  },
  {
    /**
     * `rule:answer_withheld` (§2.3), the decision the video is *about*: **attempts = 0**, so the
     * answer is not given. One hint that narrows, one clause saying that one try unlocks the
     * answer, and no answer. It is a rule in the orchestrator, not a line in a prompt — the model
     * is never asked whether to answer its own question — which is the "one important design
     * decision" of `attempt-first.md` §6 and of beat 16.
     *
     * Deliberately **not** grounded with a `p. N: "…"`: a hint that quotes the page's own sentence
     * at the learner is half an answer. It says which page to look at and what to look for.
     */
    cue: 'hint:1',
    decision: tester('quiz_hint', 'C2', 'Nominal: `rule:answer_withheld` — no attempt yet, so one hint and no answer.'),
    text:
      'Not yet — have one go at it and the answer is yours straight after, that is the deal. To narrow it: two of ' +
      'page 4’s three properties are about *when* you are allowed to speak, and one is about how binding the ' +
      'remark is. Your example turns on what the agent was doing while you asked.',
  },
  {
    /**
     * `rule:quiz_clarify` (§2.3). A clarification is not an attempt: the quiz stays open, nothing
     * is logged against the learner, and the answer lock is untouched. It exists because
     * `findings.md` RQ1 has the case — R5 sent a slide and asked "what is I?" — and a door that
     * treated that as a failed attempt would be punishing the most honest turn in the corpus.
     */
    cue: 'clarify:1',
    decision: tester('quiz_clarify', 'C2', 'Nominal: `rule:quiz_clarify` — a clarification, so the question stays open.'),
    text:
      "That's vocabulary, not an answer, so the question is still open and this costs you nothing. Page 4 takes " +
      'three properties from Dennis et al. — interactivity, polychronicity, ephemerality — and gives each of them a ' +
      'clause. I am asking which of the three your own example needs, not for the list.',
  },
  {
    /**
     * `rule:answer_shown` (§2.3): the model answer, **with grounds**, and what the attempt already
     * had of it. Reachable only at `attempts ≥ 1`, logged `quiz.answer_shown`, and **the ledger is
     * not run on this turn** — hence no `ledger` block here, on any answer beat. The learner did
     * not write it, so it moves nothing, and the turn says so out loud.
     */
    cue: 'answer:1',
    decision: tester('quiz_answer', 'C2', 'Nominal: `rule:answer_shown` — one attempt is on the record, so the answer is available.'),
    text:
      'Here it is, and it moves nothing on the rail — you have read it, not written it.\n\n' +
      'Polychronicity. The whisper goes to the agent, and p. 3: "*Coding...*" is printed between your question and ' +
      'the answer: the work did not stop for it. That is p. 4: "Polychronic — hold conversation in parallel", and ' +
      'it is the property the page 3 example needs. Politeness is real, but page 4 lists it under its four ' +
      '*benefits* rather than among the three properties, and it follows from the property rather than being it.\n\n' +
      'You had the partner and you had the cost of interrupting, which is most of it. What you did not have is the ' +
      'difference between the three properties and the four benefits they buy.',
  },
  {
    /**
     * The second feedback, on page 5. `C1` to **2, justified**: the attempt names the row and the
     * falsehood (criterion 2 of `limit-tests`) and resolves `M1a` — it does not think the side
     * channel wrote anything. Not 3, although `try:2` did challenge `C1` and the `defended` gate
     * would therefore allow it: the attempt gets the *reason* wrong, calling the other two results
     * "true" and the protected memory a failure, and `answer:2` is what supplies the missing half.
     * That is the point the take makes out loud — the shown answer is the thing that would have
     * earned ●, and it does not earn it, because the learner did not write it.
     */
    cue: 'feedback:2',
    decision: tester('quiz_feedback', 'C1', 'Nominal: `rule:quiz_feedback` — feedback after an attempt is mandatory.'),
    text:
      'Partly there. Right row: p. 5: "asked to add a todo to memory → claimed to do so (inaccurate) — bug". ' +
      'What you have not said is which half is broken: p. 5: "did not actually do so, ' +
      'memory protected" is the *correct* behaviour, not the failure. The bug is the claim, not the refusal. And ' +
      'the other two did not simply come back true — one declined, one answered, and p. 5: "context is a strict ' +
      'subset of the main session" is what they establish. So, in one sentence: what is the bug, if having no ' +
      'memory is not it?',
    ledger: {
      elements: [
        { id: 'C1', level: 2, confidence: 0.88, evidence: 'last_student', misconceptions_resolved: ['M1a'] },
      ],
      suggestedTargetElement: 'C1',
      suggestedProbeType: 'assumptions',
      notesForAgents:
        'Named the third test and that the claim was false, so justified; has not separated "cannot act" from ' +
        '"claimed to have acted", and reads the protected memory as the failure. M1a resolved.',
    },
  },
  {
    cue: 'hint:2',
    decision: tester('quiz_hint', 'C1', 'Nominal: `rule:answer_withheld` — no attempt yet, so one hint and no answer.'),
    /**
     * The beat the whole design decision hangs on, in the learner's own words from `findings.md`
     * RQ5: *"what's the answer?"*, asked before any attempt, five times in R6 before the learner
     * imposed attempt-first by hand. The app's answer is this turn.
     */
    text:
      'Not yet — one try first, and then I will show you the answer straight after; that is the only thing standing ' +
      'between you and it. To narrow it: page 5 has three rows and two of them say *correctly*. Look at the one that ' +
      'does not, and then ask whether the deck is calling the missing capability the bug, or calling something else ' +
      'the bug.',
  },
  {
    cue: 'clarify:2',
    decision: tester('quiz_clarify', 'C1', 'Nominal: `rule:quiz_clarify` — a clarification, so the question stays open.'),
    text:
      'Still not an answer, so the question stays open. A "limit test" is only the deck’s word for a probe run at ' +
      'the edge of what the side channel is supposed to be able to do; page 5 has three of them, one per row, with ' +
      'what each one returned next to it. I am asking which row is the bug.',
  },
  {
    /**
     * **Show the answer**, the beat the take ends the loop on. Under 150 words (§4), grounded
     * throughout, and it names what the attempt already had — which is the difference between an
     * answer and a verdict. No `ledger` block: §2.3's last row says the ledger is not run on a
     * shown answer and never moves on one, and the presenter says so over this beat.
     */
    cue: 'answer:2',
    decision: tester('quiz_answer', 'C1', 'Nominal: `rule:answer_shown` — one attempt is on the record, so the answer is available.'),
    text:
      'Here it is, and watch the rail while I say it: nothing moves, because you did not write it.\n\n' +
      'The bug is the third test — p. 5: "asked to add a todo to memory → claimed to do so (inaccurate) — bug". It ' +
      'is a bug rather than a limit because the limit is *correct*: p. 5: "did not actually do so, memory protected". ' +
      'Having no memory is the specification, not the defect — p. 5: "/btw has no memory, cannot affect the main ' +
      'agent" — so the protected memory is the right outcome and the false report of having written is the whole of ' +
      'the bug. The other two rows are the specification working.\n\n' +
      'You had the row and you had the falsehood. What you did not have is that the refusal is the feature.',
  },
];

export const CRITIQUE1_REFERENCES: ScriptedReferenceBeat[] = [
  /**
   * **The summary card** (#41): what *Summarise into the document* writes when the take reaches it.
   *
   * It replaces the REFERENCE entry card of `pivot-spec.md` §B1, which is retired — the Teacher
   * answers the entry question now. What §B1 was right about survives here: a typeset block in
   * the deck's own register, capped in code rather than in this text, written from the **thread**
   * rather than from the slide, and inserted only when the learner asks for it.
   */
  {
    cue: 'summary:1',
    segment: 'p3.lower',
    text:
      'Both rows of page 3 have the same structure: a question asked at the side, answered without entering the ' +
      'main conversation. What changes in the lower row is the partner — the whispering partner is the agent’s own ' +
      'read-only view of the session rather than a second person. The side channel can therefore answer from the ' +
      'main context without adding to it; what it cannot do, by page 6, is carry anything back.',
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

/**
 * Every cue the take can produce resolves to a beat, including the ones the actor's counters can
 * run past. Four fallbacks, and each one is a claim about what must never happen on camera:
 *
 *  1. **A question the rules fired must always have a question behind it.** `actor.ts` counts the
 *     Tester's questions over the life of the *process* — reopening the document resumes the same
 *     sitting rather than starting a new one, which is the product behaviour and is right — so a
 *     second walkthrough in one session reaches `try:3`, which nothing above answers, and the
 *     camera would see the thread open with nothing in it. Falling back to the latest scripted
 *     beat of the same kind repeats a question rather than dropping a turn, and repeating is safe
 *     because `CRITIQUE1_QUESTIONS` carries no `ledger` block.
 *  2. **The same, for everything the Tester says after the learner's turn**: `feedback:`, `hint:`,
 *     `clarify:`, `answer:`. A repeated `feedback:N` re-proposes a level the rail has already
 *     reached, which `applyLedgerRules` treats as a no-op (rule 2 is monotonic and an equal level
 *     is not an advance), so no row can move twice on one fallback.
 *  3. **The Teacher must not go quiet either.** `student:N` counts the learner turns of the
 *     process, and in this take the Ask lands on whichever ordinal the attempt loop leaves it —
 *     so the explain path is **one** beat and every `student:N` reaches it. The safety property is
 *     structural rather than conventional: that beat proposes no ledger element, so an unexpected
 *     ordinal can never score a turn it was not written for.
 *  4. **A silence is filled only where the learner owes an answer** (`attempt-first.md` §5):
 *     `rule:silence_reexplain` and `offer_step_back` are retired, stage 1 is the actor's
 *     content-free pool in both modes and never reaches this file, and stage 2 is the Tester's
 *     hint on the open question — which is the same turn as `hint:N`, so it resolves to it.
 */
export function beatFor(cue: string): ScriptedBeat | undefined {
  const exact =
    CRITIQUE1_BEATS.find((b) => b.cue === cue) ??
    CRITIQUE1_QUESTIONS.find((b) => b.cue === cue) ??
    CRITIQUE1_QUIZ_TURNS.find((b) => b.cue === cue);
  if (exact) return exact;

  const latest = (prefix: string, pool: ScriptedBeat[]): ScriptedBeat | undefined =>
    [...pool].reverse().find((b) => b.cue.startsWith(`${prefix}:`));

  const quiz = /^(try|handoff|feedback|hint|clarify|answer):\d+$/.exec(cue);
  if (quiz) return latest(quiz[1]!, quiz[1] === 'try' || quiz[1] === 'handoff' ? CRITIQUE1_QUESTIONS : CRITIQUE1_QUIZ_TURNS);

  // A silence the learner owes an answer into is the hint, by another name (§5).
  if (/^silence:\d+$/.test(cue)) return latest('hint', CRITIQUE1_QUIZ_TURNS);

  const learner = /^student:\d+$/.exec(cue);
  if (!learner) return undefined;
  const explain = CRITIQUE1_BEATS.filter(
    (b) => b.cue.startsWith('student:') && (b.text ?? '').length > 0 && (b.ledger?.elements?.length ?? 0) === 0,
  );
  return explain.at(-1);
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
 * **The take's pacing, and what the new door changed about it.**
 *
 * The attempt loop does not depend on the k-in-m rule at all: "+ Try this" is a learner gesture,
 * so the Tester's first question needs no warm-up, no taught set and no three-minute guard
 * (`attempt-first.md` §2.1). Everything this profile used to buy — `turnsK: 3` timed so the
 * hand-off landed on storyboard beat 10, `minAgeMs` back at the shipped cap so the concept Ellie
 * taught seconds ago could not win `pickTarget` — is buying the opposite thing now: the take must
 * get through four learner turns of one attempt loop **without** a hand-off interrupting it.
 *
 * So `turnsK` goes **up**, to one more turn than the take contains. The secondary door is not
 * disabled (it is shipped, and `handoff:1/2` are written for it); it is simply out of reach of a
 * take that only ever presses the button. Settings ▸ Demo is untouched at `k = 2`: a walkthrough
 * that wants to *see* the hand-off should use the shipped profile, which is what the rehearsal
 * does by passing `DEMO` to `critique1Sitting`.
 *
 * `minAgeMs` stays at the shipped cap for the same reason as before — nothing taught on camera
 * should be quizzable seconds later — and it costs the take nothing now that the door it guarded
 * is not the door being used.
 */
/**
 * `silenceScale: 1` with the rest of Demo: the take's beats are timed against the brief's own
 * `clamp(…, 120 s, 300 s)` — beat 10 says "minutes old, not seconds" on camera — and Demo's
 * shortened cue (20 Sep, §4.3) is for a *cold* walkthrough, not for the scripted take.
 */
export const CRITIQUE1_TAKE: FlowProfile = { ...DEMO, minAgeMs: MIN_AGE_CAP_MS, turnsK: 5, silenceScale: 1 };

/**
 * **The warm-up, as data — simplified, because the hero interaction no longer needs one.**
 *
 * This used to be load-bearing: the hand-off needed two concepts older than three minutes, so the
 * presenter had to teach page 4 and page 5 for real before the take and resume into that sitting.
 * The attempt loop needs none of that. What is left has two jobs:
 *
 *  1. **A session exists**, so "+ Try this" logs into a sitting rather than opening one on camera,
 *     and the flow-session freshness weight has something to rank.
 *  2. **If the secondary door ever does fire, it asks in the script's order** — `C2` first, `C1`
 *     second, matching `try:1` and `try:2`, so `feedback:1` is right whichever door asked question
 *     one. `pickTarget` scores `recency × 1/(1+level)` with both rows at ○, so the *fresher* item
 *     wins: `C2` is the four-minute-old one now, and `C1` the twelve-minute-old one. That swap is
 *     the only change to this function's data.
 *
 * It is still not a licence to fabricate a taught set for the recorded take: the rehearsal and the
 * test drive this, the camera does not. `profile` is a parameter so the rehearsal can drive the
 * secondary door on the shipped `DEMO` pacing without the take's suppressed `k`.
 */
export function critique1Sitting(
  now: number,
  profile: FlowProfile = CRITIQUE1_TAKE,
): { session: FlowSession; taught: TaughtItem[] } {
  const id = 'fs_critique1';
  const session: FlowSession = {
    ...openSession({ id, documentId: 'critique1', profile }, now - 14 * 60_000),
    lastActivityAt: now,
    gapDeadlineTs: now + profile.sessionGapMs,
    anchors: ['p3.lower'],
    // Outside the flow window, so the take's own turns are the only ones that count toward k.
    learnerTurns: [now - 13 * 60_000, now - 12 * 60_000],
  };
  const taught: TaughtItem[] = [
    { elementId: 'C1', taughtAt: now - 12 * 60_000, by: 'teacher', sessionId: id, label: 'what /btw can and cannot do' },
    // The fresher of the two and the least demonstrated, so `pickTarget` lands on it first —
    // which is the order `try:1` / `try:2` ask in, and therefore the order `feedback:N` answers.
    { elementId: 'C2', taughtAt: now - 4 * 60_000, by: 'teacher', sessionId: id, label: 'why whispering helps' },
  ];
  return { session, taught };
}

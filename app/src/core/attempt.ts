/**
 * **What the learner's turn is, while a Tester question is open** (issue #47,
 * `docs/research/attempt-first.md` §2.2).
 *
 * The brief's evidence is the whole reason this file exists. In five of the six study sessions
 * (`ai-use-transcripts/analysis/findings.md` §3.0) the learner never produced an attempt, the AI
 * never asked for one, and every offer to quiz was declined; the one productive session became
 * productive only after the learner typed *"I will attempt the question"* and *"do not send the
 * answer"*. Both of R6's hints were followed by a bare `answer?`.
 *
 * So the app owes the learner that protocol by default, and it owes it as **code**: the rules in
 * `orchestrator.ts` that withhold the answer read this classification, and the model is never
 * asked whether it should answer its own question (§2.3: *"All are code; the model is never asked
 * whether to answer its own question"*).
 *
 * Four kinds, and the order they are decided in:
 *
 *  - **`other`** — nothing was said, or the turn is agreement only. The same predicate ledger
 *    rule 4 uses (`isAgreementPhrase`), because "ok" is the reply R6 gave to eleven wrong
 *    verdicts and it is exactly as much an attempt here as it is evidence there.
 *  - **`answer_request`** — R6's own phrasings, at most 25 words. The list is a constant so the
 *    tests can quote the transcript rather than paraphrase it.
 *  - **`question`** — one short interrogative sentence: a clarification of the question, not an
 *    answer to it. It does not lift the answer lock and it is not an attempt. **A hedged answer is
 *    not a question**: *"is it an action, or a series of actions that lead to the goal?"* opens
 *    like a question and carries the learner's candidate answer, and Lucas's 2026-09-19 run showed
 *    what treating it as a clarification does — Max clarified, nothing was marked, and the learner
 *    did not know whether he had answered. So a sentence that opens *is it / could it be / is the
 *    answer …* or that offers alternatives (*A, or B?*) is an **attempt**.
 *  - **`attempt`** — everything else. **A two-word answer is an attempt.** It may not move the
 *    ledger (rule 4's eight-word floor stands, untouched) but it lifts the answer lock: the lock
 *    is about having tried, and the ledger is about having explained.
 */
const AGREEMENT =
  /^(ok(ay)?|yes|yeah|yep|sure|right|true|fair|agreed|i agree|makes sense|got it|i see|fine|exactly|correct)\b/i;

/**
 * **The agreement half of rule 4, on its own** (issue #47).
 *
 * Ledger rule 4 (`room/ledger.ts`) refuses to advance a row on a message with no student-generated
 * claim, and it refuses on two grounds: the message is too short to contain one
 * (`MIN_CONTENT_WORDS`), or it is agreement rather than a claim. The attempt loop needs the
 * *second* ground alone — `classifyLearnerTurn` below classifies a two-word answer as an attempt on
 * purpose, because the answer lock is about having tried and the ledger is about having explained
 * (`attempt-first.md` §2.2). It lives here, in the core, and the ledger imports it, so there is
 * one definition of what agreement sounds like instead of two that can drift.
 */
export function isAgreementPhrase(body: string): boolean {
  const words = body.trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  const stripped = body.trim().replace(/[.!,]/g, '');
  return AGREEMENT.test(stripped) && words.length < 14;
}

/**
 * **`give_up` replaces `answer_request`** (#48, `collab-doc.md` §4.4).
 *
 * `attempt-first.md` §2.3 had two outcomes for an ask: withheld before one attempt, shown after.
 * The collab-doc brief deletes the first — *"a learner must never see a question they never get
 * the answer to, and a refused answer teaches less than a lowered question"* — so the class that
 * used to mean *"they asked for the answer"* now means *"they are done trying"*, and it absorbs
 * the don't-know and frustration phrasings the brief lists alongside R6's own asks. One class,
 * because the rule it feeds is one rule: Max releases the answer, and the next question on that
 * objective is pitched lower (`pitch.ts`).
 */
export type LearnerTurnKind = 'attempt' | 'give_up' | 'question' | 'other';

/** Above this a turn is too long to be a bare request or a one-line clarification. */
export const SHORT_TURN_WORDS = 25;

export interface AnswerRequestPhrase {
  phrase: string;
  /**
   * `whole` matches the entire message (punctuation stripped), `contains` matches anywhere.
   *
   * The distinction is load-bearing, not tidiness: R6's request is the single word `answer?`, and
   * a `contains` match on "answer" would classify *"my answer is that the Hessian is PSD"* as a
   * request for the answer — the exact turn the loop exists to reward.
   */
  match: 'whole' | 'contains';
}

/**
 * **R6's own lines** (`findings.md` §3.0, RQ5), plus the near-neighbours of each. Extend it here
 * and nowhere else: `classifyLearnerTurn` is the only reader, and the rules that withhold the
 * answer are the only readers of *that*.
 */
export const ANSWER_REQUEST_PHRASES: readonly AnswerRequestPhrase[] = [
  // R6, twice, each straight after a hint: "answer?"
  { phrase: 'answer', match: 'whole' },
  { phrase: 'the answer', match: 'whole' },
  { phrase: 'whats the answer', match: 'contains' },
  { phrase: 'what is the answer', match: 'contains' },
  { phrase: 'tell me the answer', match: 'contains' },
  { phrase: 'give me the answer', match: 'contains' },
  { phrase: 'send me the answer', match: 'contains' },
  { phrase: 'show me the answer', match: 'contains' },
  { phrase: 'just tell me', match: 'contains' },
  // R6: "please solve the question"
  { phrase: 'please solve', match: 'contains' },
  { phrase: 'solve the question', match: 'contains' },
  { phrase: 'solve it', match: 'whole' },
  // R6: "how would you do it?"
  { phrase: 'how would you do it', match: 'contains' },
  { phrase: 'how do you do it', match: 'contains' },
  { phrase: 'i give up', match: 'contains' },
  { phrase: 'give up', match: 'whole' },
  { phrase: 'skip', match: 'whole' },
  { phrase: 'skip it', match: 'whole' },
];

/**
 * **The give-up phrasings the collab-doc brief adds** (`collab-doc.md` §4.4, verbatim: *"I don't
 * know"*, *"idk"*, *"no idea"*, *"I give up"*, *"just tell me"*, *"what's the answer"*, *"this is
 * too hard"*, *"I'm lost"* — the last four already sit in `ANSWER_REQUEST_PHRASES`).
 *
 * The line this list draws against `HINT_REQUEST_PHRASES` is deliberate and is the one thing to
 * argue with here. *"I'm stuck"*, *"hint?"*, *"where do I start"* stay a **hint request** (`other`
 * → `rule:quiz_nudge`): they are a learner still inside the question asking for a way in. *"I'm
 * lost"*, *"I don't know"*, *"this is too hard"* are a learner saying the question is beyond them,
 * which is §4.4's own reading of a give-up (*"a give-up is read as 'too hard': the next question
 * is pitched lower"*, §4.5) — and the cost of getting it wrong is asymmetric, because a released
 * answer fills nothing and an easier next question costs the learner nothing either.
 */
export const GIVE_UP_PHRASES: readonly AnswerRequestPhrase[] = [
  ...ANSWER_REQUEST_PHRASES,
  // §4.4's own list, in its own words.
  { phrase: 'i dont know', match: 'contains' },
  { phrase: 'i do not know', match: 'contains' },
  { phrase: 'dont know', match: 'whole' },
  { phrase: 'idk', match: 'whole' },
  { phrase: 'idk sorry', match: 'whole' },
  { phrase: 'no idea', match: 'contains' },
  { phrase: 'i have no idea', match: 'contains' },
  { phrase: 'this is too hard', match: 'contains' },
  { phrase: 'too hard', match: 'whole' },
  { phrase: 'thats too hard', match: 'contains' },
  { phrase: 'im lost', match: 'contains' },
  { phrase: 'i am lost', match: 'contains' },
  { phrase: 'i cant do this', match: 'contains' },
  { phrase: 'i cannot do this', match: 'contains' },
];

/**
 * Openers that make a sentence a question about the question. A turn that ends in `?` without one
 * of these is a learner thinking aloud, which is an attempt.
 */
const INTERROGATIVE =
  /^(what|why|how|when|which|where|who|whose|whom|does|do|did|is|are|was|were|can|could|should|would|will|shall|may|might|have|has|am)\b/;

/**
 * A hedge, not a question: *"…, is that right?"* is an answer with its uncertainty disclosed,
 * and treating it as a clarification would withhold the feedback the answer has earned.
 */
const CONFIRMATION_TAG = /\b(is that (right|correct)|right|correct|isn'?t it|no|yes|yeah|ok(ay)?|true)\s*\?\s*$/i;

/**
 * **A guess phrased as a question is an attempt.** *"is it X?"*, *"could it be X?"*, *"is the answer
 * X?"* — the learner is putting a candidate up, not asking what the question means. The subject is
 * deliberately narrow: *"is that the same as the gradient?"* (`is that …`) stays a clarification,
 * because there the learner is asking about a term rather than offering an answer.
 */
const HEDGED_ANSWER = /^(is|isn't|could|would|might|can|should|does|will) (it|the answer|this one)\b/;

/**
 * **Alternatives are an attempt too.** *"is it an action, or a series of actions?"*,
 * *"deterministic, or fully observable?"* narrow the answer to candidates the learner has produced;
 * Max can mark that. It takes a comma before the *or*, or an article after it, so *"what does the
 * or in step 3 mean?"* is not caught.
 */
const OFFERS_ALTERNATIVES = /,\s*or\s+\w|\bor\s+(a|an|the|that|just|only)\s/;

/** Lower case, straight apostrophes, collapsed whitespace. Punctuation survives. */
function normalise(body: string): string {
  return body.trim().toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ');
}

function contentWords(body: string): string[] {
  return body.trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
}

/**
 * Sentences, for the "one sentence" half of the `question` rule. An ellipsis ends one too: the
 * #49 line was pasted as *"…are encoded… I am not familiar with SAT format"*.
 */
function sentences(body: string): string[] {
  return body
    .split(/[.!?\u2026]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * **A request for help is a request for a hint, not an attempt** — Lucas, 2026-09-19, mid-quiz:
 * *"can you help me out here"*. It carries no candidate answer, so marking it (`attempt`) is
 * marking nothing, and it is not a request for the answer either. It classifies as `other`, which
 * `rule:quiz_nudge` turns into one hint and no answer — the same turn a silence draws.
 */
export const HINT_REQUEST_PHRASES: readonly AnswerRequestPhrase[] = [
  { phrase: 'hint', match: 'whole' },
  { phrase: 'a hint', match: 'whole' },
  { phrase: 'give me a hint', match: 'contains' },
  { phrase: 'any hint', match: 'contains' },
  { phrase: 'help me out', match: 'contains' },
  { phrase: 'help me', match: 'whole' },
  { phrase: 'help', match: 'whole' },
  { phrase: 'can you help', match: 'contains' },
  { phrase: 'im stuck', match: 'contains' },
  { phrase: 'i am stuck', match: 'contains' },
  { phrase: 'not sure where to start', match: 'contains' },
  { phrase: 'where do i start', match: 'contains' },
];

function bareWords(body: string): string {
  return normalise(body).replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function matchesAny(body: string, phrases: readonly AnswerRequestPhrase[]): boolean {
  const normalised = normalise(body);
  if (normalised.length === 0) return false;
  if (contentWords(normalised).length > SHORT_TURN_WORDS) return false;
  const bare = bareWords(normalised);
  return phrases.some((p) => (p.match === 'whole' ? bare === p.phrase : bare.includes(p.phrase)));
}

/**
 * **A request for background is a question, however many sentences it runs to** (#49).
 *
 * Lucas's 2026-09-23 run, with Max's question on the CNF encoding open: *"Can you give me example
 * of how SAT instances are encoded, format for CNF vars and clauses? I am not familiar with SAT
 * format"*. Two sentences, so the one-sentence `question` rule missed it and it fell through to
 * `attempt` — Max marked it **Not yet**, said it was "a request for background, not an attempt",
 * and the learner, who had asked for exactly what they needed to try, was refused it. The same
 * learner's *"what is a sat based planner?"*, one sentence, drew `rule:quiz_clarify` and the
 * background they wanted.
 *
 * So a turn that **asks to be told something** — *can you explain / give me an example / show me*,
 * or *I'm not familiar with / I don't know what X is* — and carries no candidate answer is a
 * `question`, up to `BACKGROUND_TURN_WORDS`. It is decided before the give-up list, because *"I
 * don't know what CNF means, can you explain it?"* is a learner asking for a way in, not one saying
 * they are done; a bare *"I don't know"* still matches neither pattern here and is still a give-up.
 */
const BACKGROUND_TURN_WORDS = 45;

/**
 * **What a request for background looks like** (#49, widened 2026-09-25).
 *
 * The first cut matched three phrasings, and replaying eighteen realistic ones through it found
 * thirteen still marked *Not yet* — *"What's CNF? We never covered it."*, *"wait what is a
 * fluent"*, *"Sorry, what do you mean by frame axioms?"* — and two that were worse: *"I don't know
 * how SAT encoding works"* and *"I don't know SAT format"* were **give-ups**, so the learner who
 * asked for the format was handed the answer and the question was closed. So the rule is now read
 * clause by clause, after the fillers a learner opens with, and in two strengths:
 *
 *  - **strong** — a clause that asks to be told or shown something (`TELL_ME`), or a phrase that
 *    says which idea they are missing (`NOT_FAMILIAR`). Either makes the turn a request, unless it
 *    also carries a candidate answer.
 *  - **weak** — *"what is X"*, with or without its `?`. That is a request only when every sentence
 *    of the turn is asking something: *"What's CNF? It's the clause form, so each action is a
 *    clause"* is a learner answering their own question, and that is an attempt.
 *
 * A bare *"I don't know"*, *"no idea"*, *"I don't know how to do this"* match neither and are
 * still give-ups: they say the learner is done, not what they are missing.
 */

/** What a learner opens a clause with before the part that says what they want. Stripped. */
const FILLER =
  /^(?:(?:please|pls|so|ok(?:ay)?|hmm+|sorry|but|wait|um+|uh+|oh|and|actually|also|hey|first|quick question|before i (?:try|answer|attempt|start)(?: (?:it|this|that))?)\b[\s,]*)+/;

/** A turn's clauses, fillers stripped: sentences, then commas, semicolons, colons and dashes. */
function clauses(body: string): string[] {
  return sentences(body)
    .flatMap((s) => s.split(/\s*(?:[,;:]|\s-+\s|[—–])\s*/))
    .map((c) => c.replace(FILLER, '').trim())
    .filter((c) => c.length > 0);
}

/** A clause that asks to be told or shown something. Anchored to the clause, after its fillers. */
const TELL_ME = new RegExp(
  [
    // "can you give me example of how…", "could you just explain…", "would you walk me through…"
    String.raw`^(?:can|could|would|will) you (?:please |pls |just |maybe |quickly |briefly )?(?:give|show|explain|tell|walk|define|remind|go (?:over|through)|describe|clarify|elaborate|expand|unpack|break (?:it |that |this )?down|spell (?:it |that |this )?out)\b`,
    String.raw`^(?:can|could|may) i (?:get|have|see) (?:an? |some )?(?:example|explanation|definition|refresher|primer|overview|background)`,
    String.raw`^(?:explain|define|describe|clarify|elaborate|remind me|show me|walk me through|give me (?:an? |some )?(?:example|explanation|definition|quick|brief|refresher|primer|overview|background|idea)|tell me (?:what|how|about|more about))\b`,
    String.raw`^i(?:'d| would) like (?:an? |some |to (?:see|know|understand) )`,
    String.raw`^i need (?:an? |some )?(?:example|explanation|refresher|background|definition)`,
  ].join('|'),
);

/** Saying which idea they are missing. Anywhere in the turn. */
const NOT_FAMILIAR: readonly RegExp[] = [
  /\b(?:not (?:familiar|sure what)|unfamiliar)\b/,
  // "I don't know how SAT encoding works", "idk what a fluent is" — but not "…how to do this",
  // "…what it is", "…what the answer is": those are a learner who is done, not one missing a term.
  /(?:\bi (?:don'?t|dont|do not) (?:know|understand|get|remember|recall)|\bidk) (?:what|how|why|which|where|when)\b(?! (?:to|i|i'm|im|it|it's|its|the answer)\b)/,
  // "I don't know SAT format", "I don't know anything about CNF"
  /\bi (?:don'?t|dont|do not) (?:know|remember|recall) (?:(?:anything|much) about (?!(?:this|it|that)\b)|(?:the |this |that )?(?:[\w-]+ ){0,2}(?:format|notation|syntax|encoding|representation|definition|term|terminology|formula)s?\b)/,
  /\bi (?:don'?t|dont|do not) (?:understand|get) (?:the |your |this |that )?(?:question|term|word|notation|format|syntax|symbol)s?\b/,
  // "we never covered it", "I haven't seen CNF", "we didn't learn that"
  /\b(?:never|haven'?t|havent|have not|hasn'?t|didn'?t|didnt|did not) (?:heard|seen|learn(?:ed|t)?|covered?|done|used|studied|come across|taught)\b/,
  /\b(?:not|wasn'?t|weren'?t|never) (?:covered|taught|explained)\b/,
  /\bwhat do you mean\b/,
  /\bwhat (?:does|did) (?:that|this|it|you) mean\b/,
  /\bwhat are you asking\b/,
];

/**
 * *"what is X"*, *"what's X"*, *"what does X look like"* — a short clause, `?` optional. A second
 * copula after the opener makes it a statement: *"what is lost is the privacy"* is an answer.
 */
const WHAT_IS = /^(?:what'?s|whats|what (?:is|are|does|do)|who (?:is|are)) (?:an? |the )?[\w()'-]+(?: [\w()'-]+){0,3}$/;
const SECOND_COPULA = /^\S+ \S+ .*\b(?:is|are|was|were)\b/;

/** Any clause that opens as a question, for the weak rule's "every sentence is asking". */
const ASKS = /^(?:what|why|how|which|where|who|when|does|do|is|are|can|could|would)\b/;

/**
 * Words that mark a candidate answer rather than a request: the learner is putting something up
 * to be marked, and that is an attempt however it is phrased. **Not `because`** (#49): *"I'm not
 * familiar with CNF because we didn't cover it"* explains the request, it does not answer anything.
 */
const CANDIDATE = /\b(i think|i guess|i'd say|i would say|my answer|maybe it'?s|probably|so it'?s|it'?s like)\b/;

const HINT_WORD = /\b(?:hint|clue|tip)s?\b/;

/** Asking to be told the answer itself is not asking for background. */
const ASKS_FOR_ANSWER = /\b(?:the|your|model) (?:answer|solution)\b/;

function isWhatIs(clause: string): boolean {
  return WHAT_IS.test(clause) && !SECOND_COPULA.test(clause);
}

export function isBackgroundRequest(body: string): boolean {
  const normalised = normalise(body);
  if (normalised.length === 0) return false;
  if (contentWords(normalised).length > BACKGROUND_TURN_WORDS) return false;
  // "show me the answer" asks to be shown something too, and it is still R6's give-up.
  if (isAnswerRequest(normalised)) return false;
  const parts = clauses(normalised);
  if (CANDIDATE.test(normalised) || parts.some((c) => HEDGED_ANSWER.test(c))) return false;
  // "can you give me a hint" asks for a way in, not for background: that is `rule:quiz_nudge`'s.
  // "could you explain the answer" asks for the answer, however politely: that is a give-up's.
  const tellMe = parts.some((c) => TELL_ME.test(c) && !HINT_WORD.test(c) && !ASKS_FOR_ANSWER.test(c));
  if (tellMe || NOT_FAMILIAR.some((re) => re.test(normalised))) return true;
  // The weak rule: a "what is X" turn in which nothing is anything but a question.
  if (OFFERS_ALTERNATIVES.test(normalised) || !parts.some(isWhatIs)) return false;
  return sentences(normalised).every((sentence) => {
    const own = clauses(sentence);
    // A sentence that is all filler ("Sorry.") asks nothing and answers nothing.
    return own.length === 0 || own.some((c) => ASKS.test(c) || isWhatIs(c));
  });
}

export function isHintRequest(body: string): boolean {
  return matchesAny(body, HINT_REQUEST_PHRASES);
}

/** Apostrophes are dropped too (`bareWords`), so "what's the answer" and "whats the answer" are one phrase. */
export function isAnswerRequest(body: string): boolean {
  return matchesAny(body, ANSWER_REQUEST_PHRASES);
}

/** §4.4: R6's asks plus the don't-know and frustration phrasings. The superset of the above. */
export function isGiveUp(body: string): boolean {
  return matchesAny(body, GIVE_UP_PHRASES);
}

/**
 * **A question typed without its `?`** (#49): *"how does SAT encoding work"*, *"wait why is it
 * convex"*. Only a *wh-* opener followed by its verb, and only in a short turn, because a *wh-*
 * word can also open an answer — *"what the learner gives up is privacy"* has no verb after
 * *what*, and *"what is lost is the privacy"* has a second one — and a yes/no opener without its
 * `?` is too often a statement to read as one.
 */
const WH_ASK =
  /^(?:what|why|how|which|where|who|when)(?:'s| (?:is|are|was|were|does|do|did|can|could|should|would|will|exactly|about|if|happens|makes))\b/;
const UNMARKED_QUESTION_WORDS = 12;

function unmarkedQuestion(asked: string, words: number): boolean {
  return words <= UNMARKED_QUESTION_WORDS && WH_ASK.test(asked) && !SECOND_COPULA.test(asked);
}

/**
 * §2.2, to implement literally. Pure, so the rules that read it are testable without a room.
 */
export function classifyLearnerTurn(body: string): LearnerTurnKind {
  const trimmed = body.trim();
  if (trimmed.length === 0) return 'other';
  // Ledger rule 4's own predicate. "ok" is not an attempt, and it is the reply R6 actually gave.
  if (isAgreementPhrase(trimmed)) return 'other';
  // #49: asking to be told something is not an answer to mark, however many sentences it takes.
  if (isBackgroundRequest(trimmed)) return 'question';
  // §4.4, and it is checked **before** the hint list: a turn that reads both ways ("I don't know,
  // any hint?") is a learner who has said they cannot answer, and the release is the safe side —
  // it fills nothing and it lowers the next question rather than refusing anything.
  if (isGiveUp(trimmed)) return 'give_up';
  // A request for help carries nothing to mark; one hint, no answer (`rule:quiz_nudge`).
  if (isHintRequest(trimmed)) return 'other';

  const words = contentWords(trimmed);
  const normalised = normalise(trimmed);
  // "wait, what does T mean?" opens on the question once the filler is off.
  const asked = normalised.replace(FILLER, '').trim();
  const endsInQuestion = /\?\s*$/.test(trimmed) || unmarkedQuestion(asked, words.length);
  if (
    endsInQuestion &&
    words.length <= SHORT_TURN_WORDS &&
    sentences(trimmed).length === 1 &&
    !CONFIRMATION_TAG.test(trimmed) &&
    INTERROGATIVE.test(asked) &&
    !HEDGED_ANSWER.test(asked) &&
    !OFFERS_ALTERNATIVES.test(normalised)
  ) {
    return 'question';
  }
  return 'attempt';
}

/**
 * **The script cue for a Tester turn** (issue #47; the same pattern as `handoff:N`).
 *
 * `n` counts Tester *questions* in the actor's lifetime across both doors — the time-based
 * hand-off and "+ Try this" — so every turn that belongs to question 3 carries a `:3`. The
 * scripted backend's beats are written against exactly these names, which is why they are one
 * pure function rather than six template literals at the call site.
 */
export type QuizCueKind =
  | 'handoff'
  | 'try'
  | 'feedback'
  | 'hint'
  | 'clarify'
  | 'answer'
  /**
   * The collab-doc loop's own beats (#48). Same rule: every turn that belongs to question *N*
   * carries `:N`, so `script.notes.ts` can hold the whole loop — answer, follow-up, attempt,
   * feedback, cue, prompt, give-up, release — as named beats that cannot play out of order.
   */
  | 'followup'
  | 'cue'
  | 'prompt'
  | 'release'
  | 'closure'
  | 'doctext';

export function quizCue(kind: QuizCueKind, n: number): string {
  return `${kind}:${n}`;
}

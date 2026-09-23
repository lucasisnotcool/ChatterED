/**
 * **The pitch this learner has asked for, on this file** (issue #41,
 * `conversation-refinement.md` §3 item 4).
 *
 * All three of Lucas's #41 transcripts contain the learner correcting the level of an answer —
 * *"hmm can you explain it simpler"*, *"you are justing reading the slides back to me"*, *"too
 * complicated, can you explain stochastic as a concept… then the rigorous version"*. Each time the
 * next turn was better, and each time the system forgot. On the third transcript he had to write
 * the explanation's *shape* himself, having already twice said the same thing about its level.
 *
 * So the signal is caught and kept. Deliberately a **word list and not a model**, the same
 * argument `shared/scope.ts` makes for `guessScope`: it runs on every learner turn, it has to be
 * instant, it is advisory — it tilts one line of a prompt — and a classifier that is wrong
 * sometimes in front of a learner who can say "simpler" again is a better product than a
 * twenty-second call behind a wait.
 *
 * Three levels and no more. `-1` is the state the #41 transcripts kept asking for and never got
 * twice; `0` is the default; `+1` is the learner who wants the derivation. It is clamped, so ten
 * "simpler"s do not produce an explanation for a five-year-old and one "actually be rigorous"
 * takes it straight back to `0`.
 */

/** −1 plain · 0 default · +1 rigorous. Clamped; there is no level 2 in either direction. */
export type PitchLevel = -1 | 0 | 1;

export interface PitchState {
  level: PitchLevel;
  /**
   * What the learner actually said to move it, most recent first, capped at three. Quoted back
   * into the prompt, because *"they asked for it simpler"* is weaker than the phrase they used —
   * and because a learner who reads the log should be able to see why the app decided this.
   */
  signals: string[];
  /** When the level last moved. Zero when it never has. */
  updatedAt: number;
}

export const DEFAULT_PITCH: PitchState = { level: 0, signals: [], updatedAt: 0 };

/** How many remembered phrases the prompt carries. Three is enough to show a pattern. */
const MAX_SIGNALS = 3;

/**
 * **Lower the pitch.** Read `conversation-refinement.md` §1: every one of these is a phrase a
 * learner used in #36, #37 or #41 to say the answer was above them. "No idea" is here as well as
 * in the Teacher's no-question rule (#36) — it means both things at once.
 */
const LOWER: RegExp[] = [
  /\bsimpl(er|y|est|ify)\b/i,
  /\beli ?5\b/i,
  /\bexplain (it )?like (i'?m|i am) (5|five)\b/i,
  /\bno idea\b/i,
  /\b(i )?(don'?t|do not|didn'?t) (get|understand|follow)\b/i,
  /\btoo (complicated|complex|technical|abstract|much|fast)\b/i,
  /\breading the slides? back\b/i,
  /\brepeating the slides?\b/i,
  /\bjust reading\b/i,
  /\blost me\b/i,
  /\bwhat does that (even )?mean\b/i,
  /\b(in )?plain (english|terms|words)\b/i,
  /\bdumb(ed)? (it )?down\b/i,
  /\blay ?man'?s?\b/i,
  /\bfrom scratch\b/i,
  /\bbasics?\b/i,
  /\bslow(er)? down\b/i,
  /\bconcrete example\b/i,
];

/** **Raise it.** The learner who wants the derivation, and says so. */
const RAISE: RegExp[] = [
  /\brigor(ous|ously|our)\b/i,
  /\bformal(ly|ise|ize)?\b/i,
  /\bprov(e|es|ed|ing)\b|\bproof\b/i,
  /\bderiv(e|es|ed|ation)\b/i,
  /\bprecise(ly)?\b/i,
  /\bmathematical(ly)?\b/i,
  /\btechnical(ly)? (detail|version|definition)\b/i,
  /\bfull(y)? general\b/i,
  /\bi (already )?know (that|this)\b/i,
];

export interface PitchSignal {
  direction: -1 | 1;
  /** The matched phrase, as the learner wrote it. Quoted into the prompt. */
  phrase: string;
}

/**
 * The first signal in one learner message, or null.
 *
 * **Lower wins over raise when both appear**, and that is not arbitrary: the one message in #41
 * that contains both is *"too complicated, can you explain stochastic as a concept, what it means,
 * then the rigorous version"*. The learner is asking to be taken from the bottom **up** — the
 * complaint is about where the answer started, not where it ended — and `conversation-refinement.md`
 * §4's explanation shape delivers both halves anyway.
 */
export function pitchSignal(text: string): PitchSignal | null {
  const body = text.trim();
  if (body.length === 0) return null;
  for (const pattern of LOWER) {
    const hit = pattern.exec(body);
    if (hit) return { direction: -1, phrase: hit[0] };
  }
  for (const pattern of RAISE) {
    const hit = pattern.exec(body);
    if (hit) return { direction: 1, phrase: hit[0] };
  }
  return null;
}

const clamp = (n: number): PitchLevel => (n < 0 ? -1 : n > 0 ? 1 : 0);

/** Fold one learner message into the file's pitch. Returns the same object when nothing fired. */
export function notePitch(state: PitchState, text: string, now: number): PitchState {
  const signal = pitchSignal(text);
  if (!signal) return state;
  const level = clamp(state.level + signal.direction);
  const signals = [signal.phrase, ...state.signals.filter((s) => s !== signal.phrase)].slice(0, MAX_SIGNALS);
  return { level, signals, updatedAt: now };
}

// ── how hard the next question is (#48, collab-doc.md §4.5) ────────────────

/**
 * **No fixed rungs.** `collab-doc.md` §4.5, verbatim: *"Max is given the learner's recent results
 * on this file (the last few verdicts and releases, and the objective's current fill) and pitches
 * freely, with two hard instructions: after a `give_up`, the next question on that objective is
 * **easier** (recall, or one part of the idea); after a *Well done*, the next may be harder
 * (explain why, apply to a case)."*
 *
 * The evidence is R6, twice over: L20 lowered the difficulty in the same message that set
 * attempt-first, and L34 read *"this query seems too complex"* (`convergence.md`). A give-up is a
 * statement about the question, not about the learner, and the app's answer to it is a smaller
 * question rather than a refused answer.
 *
 * So this file gets a second pure function beside `pitchSignal`: the *level* stays the learner's
 * stated preference about **how an explanation is written**, and this is about **how hard the next
 * question is**. They are deliberately not merged — a learner who asks for the rigorous version
 * has not asked for a harder quiz, and one who gives up on a question has not asked for simpler
 * prose. The wording of the question is the model's; the two instructions are not.
 */
export type QuestionPitch = 'easier' | 'level' | 'harder';

/** One resolved question on this file, newest last. The only history the pitch reads. */
export interface PitchOutcome {
  objectiveId: string | null;
  /** `verdict` is the learner's own answer being marked; `released` is a give-up, pass or closure. */
  kind: 'verdict' | 'released';
  verdict: 'complete' | 'partial' | 'not_yet' | null;
  releasedBy: 'give_up' | 'pass' | 'closure' | null;
}

export interface PitchInputsRequest {
  /** The objective the *next* question is about. The two hard rules are scoped to it. */
  objectiveId: string | null;
  /** Every resolved question on this file, oldest first. Only the tail is read. */
  outcomes: readonly PitchOutcome[];
  /** The objective's current fill (brief §6): 0, 0.5 or 1. */
  fill: 0 | 0.5 | 1;
}

export interface PitchInputs {
  pitch: QuestionPitch;
  /** Why, in one clause, for the prompt and for the log. Never the model's guess. */
  reason: string;
  /** The last few results on this file, newest first, capped — what §4.5 hands Max. */
  recent: PitchOutcome[];
  fill: 0 | 0.5 | 1;
  /** True when the most recent result **on this objective** was a release. Drives `easier`. */
  lastWasRelease: boolean;
  /** True when the most recent result on this objective was a *Well done*. Permits `harder`. */
  lastWasComplete: boolean;
  /** True when nothing has been asked on this objective yet (#49): the question is the easy end. */
  firstOnObjective: boolean;
}

/** How much history the block carries. Three is enough to show a direction without a wall. */
const MAX_RECENT = 4;

/**
 * Pure, and unit-tested against fixed inputs — which is what §4.5 asks for in as many words
 * (*"The pitch inputs are a pure function (`room/pitch.ts`), unit-tested; the wording is the
 * model's"*).
 *
 * **Precedence: a release beats a completion.** Both can be true of the same objective — a
 * learner who gave up on question 2 after a *Well done* on question 1 — and the most recent one
 * wins, because the pitch is about the question being asked *now*. That is the one ordering
 * decision in here and it is the one §4.5's own evidence is about: R6's give-up is the signal the
 * next question has to answer.
 */
export function pitchInputs(input: PitchInputsRequest): PitchInputs {
  const recent = [...input.outcomes].reverse().slice(0, MAX_RECENT);
  // Scoped to the objective: a give-up on *another* objective says nothing about this one.
  const onObjective = recent.filter(
    (o) => input.objectiveId === null || o.objectiveId === null || o.objectiveId === input.objectiveId,
  );
  const last = onObjective[0] ?? null;
  const lastWasRelease = last?.kind === 'released';
  const lastWasComplete = last?.kind === 'verdict' && last.verdict === 'complete';

  const pitch: QuestionPitch = lastWasRelease ? 'easier' : lastWasComplete ? 'harder' : 'level';
  const reason = lastWasRelease
    ? `the last question on this objective ended in ${last?.releasedBy === 'pass' ? 'a pass' : last?.releasedBy === 'closure' ? 'a release at closure' : 'a give-up'}`
    : lastWasComplete
      ? 'the last answer on this objective was marked Well done'
      : last === null
        ? 'nothing has been asked on this objective yet'
        : `the last answer on this objective was marked ${last.verdict === 'not_yet' ? 'Not yet' : 'Partly there'}`;

  return { pitch, reason, recent, fill: input.fill, lastWasRelease, lastWasComplete, firstOnObjective: last === null };
}

/**
 * **What Max is told**, rendered from `pitchInputs`. Facts first, then the one instruction they
 * add up to — the same shape `pitchLine` uses, and for the same reason.
 *
 * The two hard instructions are stated as rules of the app rather than as suggestions, because
 * §4.5 makes them rules: *"two hard instructions"*. Everything else about the question — its
 * wording, its angle, whether it uses the objective's seed — stays the model's.
 */
export function pitchBlock(inputs: PitchInputs): string {
  const lines = ['HOW HARD THIS QUESTION SHOULD BE'];
  if (inputs.recent.length === 0) {
    lines.push('Nothing has been asked on this file yet. Pitch it where the slide pitches it.');
  } else {
    lines.push('Recent results on this file, most recent first:');
    for (const o of inputs.recent) {
      lines.push(
        o.kind === 'released'
          ? `- answer released (${o.releasedBy ?? 'released'}) — fills nothing`
          : `- marked ${o.verdict === 'complete' ? 'Well done' : o.verdict === 'not_yet' ? 'Not yet' : 'Partly there'}`,
      );
    }
  }
  lines.push(
    `This objective is ${inputs.fill === 1 ? 'complete' : inputs.fill === 0.5 ? 'half filled' : 'not filled yet'}.`,
  );
  if (inputs.pitch === 'easier') {
    lines.push(
      `**Ask an easier question than the last one** — ${inputs.reason}. Ask for recall, or for one`,
      'part of the idea on its own: a definition, a single step, the name of the thing. Do not',
      'reword the question they just gave up on, and do not say it is easier.',
    );
  } else if (inputs.pitch === 'harder') {
    lines.push(
      `**You may go harder than the last one** — ${inputs.reason}. Ask them to explain why, or to`,
      'apply it to a case the slide does not work through. Still one question.',
    );
  } else if (inputs.firstOnObjective) {
    /**
     * **The first question on an objective is not a construction** (#49). The 2026-09-23 run's
     * first question on p. 7's objective asked the learner to build a CNF encoding the deck only
     * names, and "pitch it where the slide pitches it" did nothing to stop it. The slide pitches
     * p. 7 as a list to distinguish, and the question should ask for that.
     */
    lines.push(
      `This is the first question on this objective — ${inputs.reason}. Ask them to say it in their`,
      'own words, or to name or tell apart what the page shows. Not a construction, a derivation, or',
      'a case the page does not work through: that is for after they have got this one.',
    );
  } else {
    lines.push(`Pitch it at the same level as the last one — ${inputs.reason}.`);
  }
  lines.push('There are no fixed difficulty rungs: the wording and the angle are yours.');
  return lines.join('\n');
}

/**
 * The sentence the Teacher reads. One line, in the imperative, because the surrounding block is
 * facts and this is the instruction they add up to.
 */
export function pitchLine(state: PitchState): string {
  const said = state.signals.length > 0 ? ` They said: ${state.signals.map((s) => `“${s}”`).join(', ')}.` : '';
  if (state.level < 0) {
    return (
      'PITCH: **lower than the slide’s.** This learner has asked you to come down a level on this' +
      ` file, and it is remembered across turns — do not drift back up.${said}` +
      ' Everyday words first, notation only after the idea has landed, and one concrete example every time.'
    );
  }
  if (state.level > 0) {
    return (
      'PITCH: **rigorous.** This learner has asked for the formal version on this file, so give the' +
      ` statement, the conditions and the properties, not only the intuition.${said}` +
      ' Keep one plain sentence at the top anyway; it costs a line and it is what they come back to.'
    );
  }
  return 'PITCH: ordinary. Nothing on this file says they want it simpler or more formal yet.';
}

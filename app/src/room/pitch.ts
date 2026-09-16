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

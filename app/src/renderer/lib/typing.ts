/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE TYPING SCHEDULE (`docs/research/collab-doc.md` §5)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * > An edit is typed in at reading speed with the cursor, **not pasted**, and the doc scrolls to
 * > it only if the learner is not typing.
 *
 * This file is the arithmetic of that sentence and nothing else: no DOM, no ProseMirror, no
 * timers. It answers two questions a test can ask —
 *
 *   1. *When is each part of an agent's edit revealed?* (`typingSchedule`)
 *   2. *Is the learner typing right now?* (`learnerIsTyping`)
 *
 * — and `pm/reveal.ts` turns the answers into decorations and a `setTimeout` chain.
 *
 * ## Why "reveal" and not "insert character by character"
 *
 * The document is applied **in full, in one transaction**, the moment the edit passes the guard;
 * the animation only decides what is *visible*. That ordering is deliberate and it is what keeps
 * three separate promises true at once:
 *
 *  - the agent's text carries its `author` mark and `editId` **from the first frame** (§5.4), so
 *    a learner who clicks Remove half a second in removes the whole edit, not a prefix of it;
 *  - the guard runs once, against one transaction, instead of once per keystroke-sized step —
 *    a learner who starts typing into the same paragraph mid-animation cannot slip text between
 *    two halves of an agent edit and have the second half overwrite it;
 *  - a save that lands mid-animation stores the finished document, so a crash at 40 % of the
 *    animation does not persist 40 % of a sentence.
 *
 * ## The speed
 *
 * ~32 characters per second is the middle of the 25–40 the brief's build note asks for: fast
 * enough to read along with, slow enough to see the words arrive. A *long* edit would take
 * forty seconds at that rate, so the whole schedule is clamped to `MAX_MS` and the effective
 * rate rises to fit — the point of the animation is presence, not a faithful simulation of
 * somebody's wpm, and nobody watches a paragraph land for forty seconds twice.
 */

/** Characters per second at the unhurried end — the rate a short edit actually gets. */
export const CHARS_PER_SECOND = 32;

/** No edit, however long, animates for more than this. */
export const MAX_MS = 7_000;

/** Nor for less than this: a three-word insertion still has to read as typing. */
export const MIN_MS = 420;

/**
 * At most this many reveal steps. A 3,000-character edit at one step per word would dispatch
 * ~500 transactions; merging word boundaries into ~110 steps keeps the cadence visible (a step
 * every ~60 ms at the cap) and the transaction count sane.
 */
export const MAX_STEPS = 110;

/**
 * How many characters an atom (a display formula, an inline slide figure) is worth when the
 * schedule counts length. It is revealed in one step — a KaTeX block cannot half-appear — but it
 * should not be free either, or a figure would flash past between two words.
 */
export const ATOM_COST = 12;

export interface TypingStep {
  /** Milliseconds from the start of the animation. */
  at: number;
  /** How many characters of the edit are visible from this moment. */
  revealed: number;
}

export interface TypingOptions {
  charsPerSecond?: number;
  minMs?: number;
  maxMs?: number;
  maxSteps?: number;
}

/**
 * Word boundaries: the index **after** each run of non-space characters.
 *
 * Revealing at word boundaries rather than per character is what makes this read as typing
 * rather than as a progress bar — a human typist emits a word and a space, and the eye follows
 * words. Trailing whitespace is folded into the word before it, so a step never reveals a lone
 * space (which looks like a stall).
 */
export function wordBoundaries(text: string): number[] {
  const bounds: number[] = [];
  let index = 0;
  while (index < text.length) {
    // Skip the word.
    while (index < text.length && !/\s/.test(text[index]!)) index++;
    // Then the whitespace that follows it: the boundary is after both.
    while (index < text.length && /\s/.test(text[index]!)) index++;
    bounds.push(index);
  }
  if (bounds.length === 0 && text.length > 0) bounds.push(text.length);
  return bounds;
}

/**
 * The reveal schedule for one edit.
 *
 * The returned steps are cumulative and strictly increasing in both fields; the last one always
 * reveals the whole edit. An empty edit returns an empty schedule, and the caller should treat
 * that as "nothing to animate" rather than as an error.
 *
 * The timing is linear in characters, not in steps: a step that reveals a nine-letter word waits
 * longer than one that reveals "of". That is the difference between a typist and a metronome.
 */
export function typingSchedule(text: string, options: TypingOptions = {}): TypingStep[] {
  const total = text.length;
  if (total === 0) return [];

  const cps = options.charsPerSecond ?? CHARS_PER_SECOND;
  const minMs = options.minMs ?? MIN_MS;
  const maxMs = options.maxMs ?? MAX_MS;
  const maxSteps = Math.max(1, options.maxSteps ?? MAX_STEPS);

  const duration = Math.min(maxMs, Math.max(minMs, Math.round((total / cps) * 1000)));

  let bounds = wordBoundaries(text);
  // Merge boundaries evenly when there are more words than steps, so the cadence stays regular
  // instead of racing through the first half and crawling through the second.
  if (bounds.length > maxSteps) {
    const stride = bounds.length / maxSteps;
    const merged: number[] = [];
    for (let i = 1; i <= maxSteps; i++) {
      merged.push(bounds[Math.min(bounds.length - 1, Math.round(i * stride) - 1)]!);
    }
    bounds = merged;
  }

  const steps: TypingStep[] = [];
  for (const revealed of bounds) {
    const at = Math.round((revealed / total) * duration);
    const last = steps[steps.length - 1];
    if (last && last.revealed >= revealed) continue;
    steps.push({ at, revealed });
  }
  // The final step is the whole edit, whatever the rounding did.
  const last = steps[steps.length - 1];
  if (!last || last.revealed < total) steps.push({ at: duration, revealed: total });
  else last.at = duration;
  return steps;
}

/**
 * The quiet window after a keystroke during which the doc must not scroll itself (§5: "the doc
 * scrolls to it only if the learner is not typing").
 *
 * Two seconds, because a learner composing a sentence pauses for a word more often than they
 * pause for a thought, and a viewport that jumps between two words of the learner's own sentence
 * is the single most hostile thing a collaborative editor can do.
 */
export const TYPING_QUIET_MS = 2_000;

export function learnerIsTyping(lastKeyAt: number, now: number, quietMs = TYPING_QUIET_MS): boolean {
  if (lastKeyAt <= 0) return false;
  return now - lastKeyAt < quietMs;
}

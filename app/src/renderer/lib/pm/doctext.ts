/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * "THE LEARNER'S OWN DOC TEXT COUNTS" (`collab-doc.md` §6)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * > When the learner writes in the doc (their own provenance span, at least one sentence, in a
 * > segment mapped to an objective), it is assessed as an attempt on that objective **once they
 * > pause**.
 *
 * Three of those four conditions are the renderer's to detect and one is not. **The renderer
 * decides only "this looks like an attempt worth showing to main"**; whether it maps to an
 * objective, whether it is long enough to move the ledger, and whether Max should assess it are
 * main's (`notes:docText` says so in its own docstring: "Main decides whether it maps to an
 * objective and is long enough to be an attempt"). Keeping the split there is what stops the
 * renderer from becoming a second, quieter authority on progress — the same reason
 * `store.svelte.ts` opens by saying it holds nothing authoritative.
 *
 * So this file answers exactly one question, purely, from a clock and a string:
 *
 *   *Has the learner stopped typing in this block long enough, with enough of their own words in
 *   it, that we have not already reported?*
 *
 * ## The two numbers
 *
 * **Four seconds** of quiet. Long enough to be a pause and not a word-search (the typing quiet
 * window in `typing.ts` is two seconds and is a different question — that one is "may the
 * viewport move", this one is "has a thought finished"). Short enough that Max's feedback still
 * feels like it is about what the learner just wrote.
 *
 * **Eight words**, standing in for "at least one sentence". A word count is the honest version of
 * that test: sentence-boundary detection on a half-written note misfires on every abbreviation
 * and every bullet without a full stop, and the cost of a miss here is a wasted model call on
 * "the answer is" — which is exactly the "5 of 6 questions handed back unattempted" pattern the
 * brief is built against.
 */

import type { Node } from 'prosemirror-model';
import { learnerSpans } from '../../../shared/doc/schema.js';

/** Quiet after the last keystroke in a block before its text is reported. */
export const DOC_TEXT_PAUSE_MS = 4_000;

/** "At least one sentence", counted the only way that does not misfire on notes. */
export const DOC_TEXT_MIN_WORDS = 8;

export interface LearnerBlockText {
  blockId: string;
  text: string;
}

/** Words, by the same rule the chat composer counts them: runs of non-space. */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * The learner's own writing, one entry per block, their spans joined.
 *
 * `learnerSpans` already merges the runs a mark boundary split, so a sentence with a bold word
 * in it is one span; what is left to do here is join the *separate* spans of one block — the
 * learner who wrote a clause, let Ellie insert a phrase, then finished the sentence. A single
 * space joins them, because the agent's words in between are not the learner's evidence and
 * concatenating without a gap would invent a word that nobody typed.
 */
export function learnerTextByBlock(doc: Node): LearnerBlockText[] {
  const byBlock = new Map<string, string[]>();
  for (const span of learnerSpans(doc)) {
    if (!span.blockId) continue;
    const list = byBlock.get(span.blockId) ?? [];
    list.push(span.text);
    byBlock.set(span.blockId, list);
  }
  return [...byBlock].map(([blockId, parts]) => ({ blockId, text: parts.join(' ').trim() }));
}

export interface DocTextOptions {
  pauseMs?: number;
  minWords?: number;
}

/**
 * The pause detector.
 *
 * Deliberately a plain class over two `Map`s and no reactivity: it is called on every document
 * change and polled on a timer, and a `$state` proxy on this path would be both pointless (no
 * UI reads it) and a hazard (`text` goes straight out over IPC).
 */
export class DocTextWatch {
  readonly pauseMs: number;
  readonly minWords: number;

  /** blockId → when its learner text last changed. */
  #changedAt = new Map<string, number>();
  /** blockId → the text we last handed to `notes:docText`. */
  #reported = new Map<string, string>();
  /** blockId → its learner text as of the last `observe`. */
  #seen = new Map<string, string>();

  constructor(options: DocTextOptions = {}) {
    this.pauseMs = options.pauseMs ?? DOC_TEXT_PAUSE_MS;
    this.minWords = options.minWords ?? DOC_TEXT_MIN_WORDS;
  }

  /**
   * Take a reading of the document's learner text. Call it on every change.
   *
   * A block whose learner text is unchanged does **not** restart its clock — otherwise an agent
   * edit three paragraphs away, or the learner typing somewhere else, would postpone a pause
   * that has already happened. A block whose learner text has vanished is forgotten entirely,
   * including its report, so text deleted and retyped is reported again.
   */
  observe(blocks: readonly LearnerBlockText[], now: number): void {
    const present = new Set<string>();
    for (const block of blocks) {
      present.add(block.blockId);
      if (this.#seen.get(block.blockId) !== block.text) {
        this.#seen.set(block.blockId, block.text);
        this.#changedAt.set(block.blockId, now);
      }
    }
    for (const blockId of [...this.#seen.keys()]) {
      if (present.has(blockId)) continue;
      this.#seen.delete(blockId);
      this.#changedAt.delete(blockId);
      this.#reported.delete(blockId);
    }
  }

  /** The blocks that are due to be reported right now. Usually none; at most a couple. */
  due(now: number): LearnerBlockText[] {
    const out: LearnerBlockText[] = [];
    for (const [blockId, text] of this.#seen) {
      const changedAt = this.#changedAt.get(blockId) ?? now;
      if (now - changedAt < this.pauseMs) continue;
      if (wordCount(text) < this.minWords) continue;
      if (this.#reported.get(blockId) === text) continue;
      out.push({ blockId, text });
    }
    return out;
  }

  /** Remember that this exact text went to main, so only a *further* edit reports again. */
  markReported(blockId: string, text: string): void {
    this.#reported.set(blockId, text);
  }

  /** The next moment `due()` could return something, or null when nothing is pending. */
  nextDueAt(now: number): number | null {
    let soonest: number | null = null;
    for (const [blockId, text] of this.#seen) {
      if (wordCount(text) < this.minWords) continue;
      if (this.#reported.get(blockId) === text) continue;
      const at = (this.#changedAt.get(blockId) ?? now) + this.pauseMs;
      if (soonest === null || at < soonest) soonest = at;
    }
    return soonest;
  }
}

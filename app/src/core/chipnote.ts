/**
 * **Max's one sentence on the self-check chip** (Lucas's decision 12 of 6 Oct afternoon, #67;
 * `notebooks.md` §11.10.5, which settles §11.9's open question about the chip).
 *
 * > The self-check chip after *Well done* shows the learner's answer plus one sentence from Max,
 * > visibly marked as his.
 *
 * The model proposes, code decides. On a *Well done* Max's turn ends with one line of its own,
 * `Chip: …`, holding the sentence (`room/prompts.chip.ts` asks for it). This module takes that
 * line out of the chat text, where it would repeat what the turn already said, and decides whether
 * the sentence may stand on the chip:
 *
 *  - **one sentence**, at most `CHIP_NOTE_MAX_WORDS` words, a formula counting as one word;
 *  - **about the material**: no "you" or "your", so it can never read as the learner's words or
 *    as a remark on them ("you said…"), and no question and no verdict;
 *  - **never the learner's words quoted back**: a run of `CHIP_NOTE_QUOTE_RUN` words shared with
 *    their answer refuses it. The learner's answer is on the chip already, in their own mark.
 *
 * A refused or missing sentence leaves the chip with the learner's answer alone, as it was before
 * decision 12. Nothing is rewritten: a sentence either passes as Max wrote it or is not shown.
 *
 * Pure: strings in, strings out, nothing outside `core/`.
 */

/**
 * **Twenty-five words.** One sentence that names the idea in the deck's terms and says what it
 * does; the Lecture-sdm *Well done* (#11) had one such sentence of 26 words with its formula, 23
 * counting the formula as one. Longer is a paragraph, which is what D4 took out of the notes.
 */
export const CHIP_NOTE_MAX_WORDS = 25;

/** Six words in a row from the learner's answer is quoting it, not saying the idea again. */
export const CHIP_NOTE_QUOTE_RUN = 6;

/** The line's label. Case and emphasis around it are forgiven; the colon is not. */
const CHIP_LINE = /^[\s>*_]*chip[\s*_]*:[\s*_]*(.*)$/i;

export type ChipNoteRefusal =
  | 'missing'
  | 'empty'
  | 'too_long'
  | 'not_one_sentence'
  | 'addresses_learner'
  | 'question'
  | 'verdict'
  | 'quotes_learner';

export interface ChipNote {
  /** The turn with every `Chip:` line taken out, for the chat. Unchanged when there was none. */
  text: string;
  /** The sentence for the chip, or null when there was none or it was refused. */
  note: string | null;
  /** Why there is no note; null when there is one. */
  refused: ChipNoteRefusal | null;
  /** Words in the offered sentence (formulas as one), 0 when none was offered. */
  words: number;
}

/** Inline and display formulas, each standing for one word. */
const MATH = /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g;

function maskMath(text: string): string {
  return text.replace(MATH, 'FORMULA');
}

function wordsOf(text: string): string[] {
  return maskMath(text)
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/**
 * More than one sentence: a full stop, ! or ? followed by a space and a capital or a quote, with
 * formulas masked and the abbreviations a note may use ("p. 12", "e.g.", "i.e.", "vs.") skipped.
 */
function sentenceCount(text: string): number {
  const masked = maskMath(text)
    .replace(/\b(?:pp?|e\.g|i\.e|vs|cf|etc|eq|fig|no)\./gi, (m) => m.replace(/\./g, ''))
    .trim();
  const inner = masked.match(/[.!?]["”')\]]*\s+(?=["“([]?[\p{Lu}\p{N}])/gu) ?? [];
  return inner.length + 1;
}

function normalise(text: string): string[] {
  return maskMath(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function quotes(note: string, answer: string, run: number): boolean {
  const a = normalise(answer);
  if (a.length < run) return false;
  const grams = new Set<string>();
  for (let i = 0; i + run <= a.length; i += 1) grams.add(a.slice(i, i + run).join(' '));
  const n = normalise(note);
  for (let i = 0; i + run <= n.length; i += 1) if (grams.has(n.slice(i, i + run).join(' '))) return true;
  return false;
}

/** Why a sentence may not stand on the chip, or null when it may. */
export function refuseChipNote(note: string, learnerAnswer: string | null = null): ChipNoteRefusal | null {
  const text = note.trim();
  if (text.length === 0) return 'empty';
  if (/\b(?:you|your|yours|yourself|you're|you’re|you've|you’ve)\b/i.test(maskMath(text))) return 'addresses_learner';
  if (/\?\s*["”')\]]*\s*$/.test(text)) return 'question';
  if (/\b(?:well done|partly there|not yet)\b/i.test(maskMath(text))) return 'verdict';
  if (sentenceCount(text) > 1 || text.includes('\n')) return 'not_one_sentence';
  if (wordsOf(text).length > CHIP_NOTE_MAX_WORDS) return 'too_long';
  if (learnerAnswer && quotes(text, learnerAnswer, CHIP_NOTE_QUOTE_RUN)) return 'quotes_learner';
  return null;
}

/**
 * Take Max's `Chip:` line out of a turn and decide whether it stands. The last such line is the
 * one offered; every one is removed from the chat text, whatever the verdict, so a stray label
 * never reaches the learner.
 */
export function extractChipNote(turn: string, learnerAnswer: string | null = null): ChipNote {
  const lines = turn.split('\n');
  let offered: string | null = null;
  const kept: string[] = [];
  for (const line of lines) {
    const m = CHIP_LINE.exec(line);
    if (m) offered = (m[1] ?? '').trim();
    else kept.push(line);
  }
  if (offered === null) return { text: turn, note: null, refused: 'missing', words: 0 };
  const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  const refused = refuseChipNote(offered, learnerAnswer);
  return { text, note: refused === null ? offered : null, refused, words: wordsOf(offered).length };
}

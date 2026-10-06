/**
 * **The line Max adds to a *Well done* for the self-check chip** (Lucas's decision 12 of 6 Oct
 * afternoon, #67; `notebooks.md` §11.10.5).
 *
 * The chip that a closed question folds into shows the learner's answer, and since decision 12
 * one sentence from Max, marked as his. The sentence comes from the turn that gives the *Well
 * done*, as one line of its own that `core/chipnote.ts` takes out of the chat and checks: one
 * sentence, at most `CHIP_NOTE_MAX_WORDS` words, about the material, never the learner's words.
 * Its own file, beside `prompts.doc.ts`, so the marking prompts can change without touching it.
 */

import { CHIP_NOTE_MAX_WORDS } from '../core/chipnote.js';

export function chipNoteBlock(): string {
  return [
    'THE SELF-CHECK CHIP',
    'Only if your verdict is **Well done.**: end the message with one more line of its own, starting',
    `exactly "Chip: ", then one sentence of at most ${String(CHIP_NOTE_MAX_WORDS)} words that states the idea in the`,
    "deck's terms, for the learner's notes. The app moves that line out of the chat and shows it on",
    "the question's chip, marked as yours. Write it about the material, in the third person: no",
    '"you" or "your", no question, no verdict, and none of the learner\'s own phrasing (their answer',
    'is on the chip already). On any other verdict, write no such line.',
  ].join('\n');
}

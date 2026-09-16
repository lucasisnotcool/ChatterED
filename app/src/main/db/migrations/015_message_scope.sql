-- 015 — a message says what the model was allowed to see.
--
-- `whole-file-context.md` §4 recommendation 6: *"Each AI card's footer already shows model and
-- timings; add the scope so the learner can tell why an answer is narrow."* Until now every
-- REFERENCE answer was built from one page's text and the card said nothing about it, so an
-- answer that was narrow because it had only been shown one slide read as an answer that was
-- narrow because the model was not very good.
--
-- The column holds the **rendered phrase**, not a code: `p. 14`, `p. 14 + outline`,
-- `whole deck`, `outline + pp. 3, 14, 40`. Formatting it once in `shared/scope.ts` and storing
-- the result means the footer, the debug drawer and the event log all quote the same string,
-- and a phrase that was written under one build still reads correctly under the next.
--
-- Nullable: it is null on every message that is not a REFERENCE answer, and on every message
-- written before this build, both of which are honest absences rather than zeroes.
--
-- Forward-only; 001-014 are not touched.

ALTER TABLE messages ADD COLUMN scope_shown TEXT;

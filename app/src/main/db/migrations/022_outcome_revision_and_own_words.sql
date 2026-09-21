-- 022 — an outcome row says which attempt it marked, and how much of that attempt was the
-- learner's own words (`docs/research/measurement.md` §4, M2 and M3).
--
-- 020 gave the bar its rows. What those rows could not answer is the second half of the learning
-- goal: *"answer in their own words, **and revise that answer after feedback**"*. `progressFill`
-- keeps the best verdict by design, so a learner who is right first try and a learner who goes
-- *Partly there*, revises, and earns *Well done* produce an identical bar. The second learner is
-- the point of the design, and the baseline says they are the rare one: 0 of 17 attempts in the
-- observed sessions was a second try at the same question.
--
--   attempt_index    which attempt at this question the verdict marked, 1-based. A verdict with
--                    attempt_index >= 2 **is** a revision; nothing else has to be recorded, and
--                    `progressFill` is untouched, which is why this is a column and not a new
--                    `kind`. (A new kind would have to be skipped by the fill, and then a revision
--                    that earned *Well done* would fill nothing.)
--
--   own_words_*      the three overlap shares of M3, against the anchored block, Ellie's cue and
--                    Max's question. A flag, never a gate: the fill never reads them.
--                    NULL means "not measured here" (no cue fired, no anchored block, an answer
--                    with no content words), which is not the same as 0.0.
--
-- Nullable and forward-only: every row written before this build has no honest value for any of
-- them, and a 1 in attempt_index would claim a first attempt that nobody counted. 001-021 are
-- not touched.

ALTER TABLE quiz_outcomes ADD COLUMN attempt_index INTEGER;
ALTER TABLE quiz_outcomes ADD COLUMN own_words_block REAL;
ALTER TABLE quiz_outcomes ADD COLUMN own_words_cue REAL;
ALTER TABLE quiz_outcomes ADD COLUMN own_words_question REAL;

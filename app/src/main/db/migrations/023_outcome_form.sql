-- 023 — an outcome row says what form its question took (`docs/research/collab-doc.md` §4.5, as
-- amended 2026-10-01).
--
-- After a release the next question on that objective is a fill-in-the-blank: one sentence from
-- the page with one term blanked. It is a way back into the objective and not a demonstration of
-- it, so a *Well done* on one must not fill the bar, and must not license a harder question.
--
--   form    'open'  the question every row before this build was about: answered in the
--                   learner's own words.
--           'cloze' a fill-in-the-blank. `progressFill` skips these rows and `pitchInputs`
--                   does not read a cloze *Well done* as one to build on.
--
-- A column and not a new `kind`, for the reason 022 gives in reverse: the row is still a verdict
-- on an attempt, and `revisionStats` should still see a second try at a blank as a revision. What
-- differs is only whether it fills.
--
-- Nullable and forward-only. NULL means a row written before this build, and every one of those
-- was an open question; the reader treats NULL as 'open'. 001-022 are not touched.

ALTER TABLE quiz_outcomes ADD COLUMN form TEXT;

-- 019 — the REFERENCE entry cards become summary cards.
--
-- Issue #41, `docs/research/conversation-refinement.md` §6. The entry card of `pivot-spec.md` §B1
-- is retired: the Teacher answers "+ Ask here" now. That leaves the rows already on disk in every
-- vault that has been used — real answers to real questions, sitting in the learner's documents,
-- and the *only* kind of row in the app that was already what §B1 was right about: a typeset,
-- capped, REFERENCE-register block in the document rather than a turn in a conversation.
--
-- So they are not deleted and they are not left as orphans of a retired feature. They become what
-- they always were: `kind = 'summary'`, with `source_thread_id` pointing at the thread they belong
-- to, so a click on one expands the conversation that produced it exactly as a new card does.
--
-- **The hand-back line goes.** Every one of these bodies ends `…\n\n───\nNow say it back in your
-- own words and I'll tell you what's missing.` — appended by `composeReferenceBody`, above a
-- button that no longer exists. Leaving it would be the document telling the learner to press
-- something that is not there. The answer itself is untouched; only the rule and the line after it
-- are cut, and only on rows this migration is converting.
--
-- **`answer` stays legal** in `MessageKind` and is deliberately not written here. Nothing mints it
-- and this migration converts every row that had it, but a vault restored from a backup taken
-- between 018 and 019 would carry rows the renderer still has to draw, and drawing them as
-- somebody's conversation turn is the one wrong answer.
--
-- Identified by the author, which is how the REFERENCE voice has always been identified
-- (`src/room/reference.ts`): `kind = 'agent'` with a **null** `agent_key` — the schema's own way
-- of saying "not an agent" — and the display name it was created with. `kind IS NULL` restricts
-- this to rows written before 018, so a summary card made on this build is never touched.
--
-- Forward-only; 001-018 are not touched.

-- The body first, while `kind IS NULL` still identifies exactly the rows to cut.
--
-- `rtrim(X)` on its own strips spaces and **not** newlines, and the two characters being cut here
-- are exactly a newline pair — so the character set is given explicitly.
UPDATE messages
SET body = rtrim(substr(body, 1, instr(body, '───') - 1), char(10) || char(13) || ' ')
WHERE kind IS NULL
  AND instr(body, '───') > 0
  AND participant_id IN (
    SELECT id FROM participants
    WHERE kind = 'agent' AND agent_key IS NULL AND display_name = 'REFERENCE'
  );

UPDATE messages
SET kind = 'summary',
    -- A thread is identified by its anchor everywhere in the flow. A card that was written at the
    -- room level has no thread to point at, and null is the honest answer rather than a guess.
    source_thread_id = anchor_id
WHERE kind IS NULL
  AND participant_id IN (
    SELECT id FROM participants
    WHERE kind = 'agent' AND agent_key IS NULL AND display_name = 'REFERENCE'
  );

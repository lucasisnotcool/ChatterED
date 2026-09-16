-- 018 — what a card in the flow *is*, and the thread a summary was written from.
--
-- Issue #41, `docs/research/conversation-refinement.md` §5. Until now every row in `messages` was
-- a conversation turn, and the one exception — the REFERENCE entry card of `pivot-spec.md` §B1 —
-- was told apart by its author having a null `agent_key`. That worked while there was exactly one
-- kind of non-turn. There are two now, and the difference between them is not who wrote it:
--
--   * `turn`    — the learner's message, or an agent's reply. Everything, until this build.
--   * `summary` — **the artefact**: a typeset block in the deck's register, capped in code,
--                 written from a *thread* rather than from a slide, inserted under the segment
--                 only when the learner presses "Summarise into the document". It is what
--                 survives of §B1 after the entry card is retired.
--   * `answer`  — the retired entry card. Nothing mints it; migration 019 rewrites the rows that
--                 exist. The value stays legal so that a vault which skipped 019 still renders
--                 them as what they were rather than as somebody's conversation turn.
--
-- **`source_thread_id` is an `anchor_id`, not a fourth kind of identifier.** A thread in the flow
-- is identified by the segment it hangs off, everywhere — `messages.anchor_id`,
-- `FlowThreadView.anchorId`, `flow:markSeen`, the REFERENCE lock that used to be. A summary card
-- sits under the same segment as the thread it came from, so the two are usually equal; it is
-- stored anyway, because *which conversation produced this* is the claim the card makes and it
-- must not be inferred from where the card happens to sit.
--
-- Both nullable, and null is read as `turn` by `messageView()`: every row written before this
-- migration is a conversation turn, which is true.
--
-- Forward-only; 001-017 are not touched. (Numbered 018, not 017: `017_llm_usage.sql` landed on
-- the cost track first, and `runMigrations` keys on the number, so two 017s would silently skip
-- one of them.)

ALTER TABLE messages ADD COLUMN kind TEXT;
ALTER TABLE messages ADD COLUMN source_thread_id TEXT;

-- The click path: card → its thread. One card per thread in practice, so this is small.
CREATE INDEX IF NOT EXISTS idx_messages_source_thread ON messages (room_id, source_thread_id);

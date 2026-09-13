-- A Socratic probe often puts more than one claim under test — Max's turn-3 question in
-- design-brief.md §G tests both the definition (R2) and the quantifier (R1). The ledger's
-- `defended` gate needs to know every element a challenge covered, not just the primary
-- target, so record them all. Forward-only: 001 has shipped and is never edited.
ALTER TABLE turn_decisions ADD COLUMN challenged_element_ids TEXT NOT NULL DEFAULT '[]';

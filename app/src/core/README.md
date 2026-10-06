# `app/src/core`: the shared core

Pure TypeScript learner-turn logic that ChatterED's A1 design and Valerie's A1 design (Nudge:
response-contingent help, fading) both need. It is part of the one shared app (`AGENTS.md`); until
2026-10-01 it was also mirrored to the group repo's `core/`, which is now archived. It stays pure
and self-contained so that Nudge's planner can plug into it.

## What is in it (v0, 2026-09-26, #54)

| File | What it decides | The same idea in Nudge |
|---|---|---|
| `attempt.ts` | What a learner turn is: `attempt`, `give_up`, `question` or `other` (`classifyLearnerTurn`), plus what counts as bare agreement (`isAgreementPhrase`, which the ledger also uses) | Its input classes: partial reasoning, "give me the proof", stuck |
| `pitch.ts` | The level the learner has asked for (−1/0/+1, clamped, quoting their own phrase), how the next question is pitched from recent results, and its form: after a release it is a fill-in-the-blank (`QuestionForm`), which fills nothing and does not license a harder question. Also when a run of follow-ups ends in a blank: past two open follow-ups, or after a guess (`followUpPlan`, `isGuess`), and whether a blank gives its own answer away, its sentence, term or mirror already on screen (`blankGiveaway`, `blankTerm`, `blankSentence`; 2026-10-06) | Contingent help that fades after a strong response |
| `ownwords.ts` | How much of an answer is the learner's own words, against the source, the cue and the question | A claim becomes Done only when the learner states it |
| `planning.ts` | Tutorial parts that are formal, decided by computation, not by a model (2026-10-03, `tutorials.md` §5): literals read in any notation (`parseLiterals`), STRIPS plans simulated and searched (`runPlan`, `parsePlan`, `solvePlan`), HLA preconditions and angelic effects derived (`hlaSummary`), action sequences run (`runSequence`), and a learner's answer judged (`judgeFormal`, `validateCheck`, `solveCheck`) | Checking a learner's step by computation rather than by the LLM that only labels |
| `tutor.ts` | A tutorial part's help ladder (point → break it down → a worked step, `nextHintLevel`) and status (`statusAfterCheck`, `statusAfterEdit`), and its fill: full credit whatever help was used, nothing after a reveal (`fillFor`) | Response-contingent help; the least explicit move first |

`attempt.ts` and `pitch.ts` still carry ChatterED's cue and prompt wording (`quizCue`,
`pitchBlock`). Making those agent-neutral is group-project work.

## Rules

1. **It imports nothing outside itself.** No `room`, `main`, `renderer` or `shared` module, and
   no package; tests may import `vitest`. This is enforced in `app/eslint.config.mjs`. The app
   depends on the core, never the reverse. A type the core needs is defined here and imported
   by the app.
2. **Pure.** No clock (take `now` as an argument), no I/O, no model call, no storage.
3. **Nothing from anyone's private A2 work** and no participant data, in code or in comments.
   Comments may cite A1 evidence (R1–R6, P1–P3) and the design briefs.
4. **Every export is tested here** (`*.test.ts` beside it). A change to the core changes what
   the teammate can see, so keep changes small, and record them in the commit.

## What is not in it yet, and why

- **The ledger's hard rules** (`room/ledger.ts`) and **the Concept Pack schema**
  (`room/records.ts`): the authored claims a learner must state. This is the closest match to
  Nudge's Proof route, but both depend on the database row types and on `shared/types.ts`'s
  `LedgerLevel`, so moving them means defining those types here first.
- **A `Planner` seam**, turning the rule layer of `room/orchestrator.ts` into
  `decide(state, turn, pack) → move`: this is where Nudge's controller would plug in. Its shape
  is a group-project decision, so it is not settled in A2.

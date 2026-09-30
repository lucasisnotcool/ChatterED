# `app/src/core`: the shared core

Pure TypeScript learner-turn logic that ChatterED's A1 design and the teammate's A1 design
(Nudge: response-contingent help, fading) both need. It lives in two places:

- **In ChatterED** (`app/src/core/`) it is the source, `SCOPE.md` zone 2. Everything else in
  ChatterED's `app/` is the ChatterED app, which is Lucas's individual A2.
- **In the group repo** (`core/`) it is a mirror of that source, pinned by `core/SOURCE`, until the
  group project starts. Paths below such as `room/ledger.ts` are ChatterED files.

## What is in it (v0, 2026-09-26, #54)

| File | What it decides | The same idea in Nudge |
|---|---|---|
| `attempt.ts` | What a learner turn is: `attempt`, `give_up`, `question` or `other` (`classifyLearnerTurn`), plus what counts as bare agreement (`isAgreementPhrase`, which the ledger also uses) | Its input classes: partial reasoning, "give me the proof", stuck |
| `pitch.ts` | The level the learner has asked for (−1/0/+1, clamped, quoting their own phrase), how the next question is pitched from recent results, and its form: after a release it is a fill-in-the-blank (`QuestionForm`), which fills nothing and does not license a harder question | Contingent help that fades after a strong response |
| `ownwords.ts` | How much of an answer is the learner's own words, against the source, the cue and the question | A claim becomes Done only when the learner states it |

`attempt.ts` and `pitch.ts` still carry ChatterED's cue and prompt wording (`quizCue`,
`pitchBlock`). Making those agent-neutral is group-project work, not A2 work.

## Rules

1. **It imports nothing outside itself.** No `room`, `main`, `renderer` or `shared` module, and
   no package; tests may import `vitest`. This is enforced in `app/eslint.config.mjs`. The app
   depends on the core, never the reverse. A type the core needs is defined here and imported
   by the app.
2. **Pure.** No clock (take `now` as an argument), no I/O, no model call, no storage.
3. **Nothing from A2 deliverables.** No Study A data, results or quotes, and no participant data,
   in code or in comments. Comments may cite A1 evidence (R1–R6, P1–P3) and the design briefs.
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

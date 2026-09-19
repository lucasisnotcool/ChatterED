# Attempt-first: the learner tries before anyone answers

**Status.** Decision brief, 19 Sep 2026; reconciled with the code the same evening (§2.1 latency band and pick fallback, §2.2 `other`) after Track A of #47 landed. Decided by Lucas the same day, after the coded study of six
real AI study sessions (`ai-use-transcripts/analysis/findings.md`) and the six form rows behind them.
This brief is the **source of truth** for the change; the sections it supersedes in older briefs are
listed in §7. Code that contradicts it is a bug in the code.

**Read alongside.** `ai-use-transcripts/analysis/findings.md` (the evidence), `flow-session.md` (the
hand-off rule, unchanged), `learning-objectives.md` (the tree the Tester quizzes from),
`conversation-refinement.md` (the Teacher-first Ask, unchanged), `progress-tracking.md` §4.4 (the
ledger's hard rules, unchanged).

---

## 0. The decision in one box

**The difficulty is reduced persistence.** In five of six sessions the learner never produced an
attempt, the AI never asked for one, and every offer to quiz was declined. The one productive session
became productive only after the learner wrote *"I will attempt the question"* and *"do not send the
answer"*.

**So the app's default structure becomes the one that learner imposed by hand.** On any slide the
learner can ask Max for a question; Max asks one; the learner attempts; Max gives feedback that cites
the slide; the ledger moves on the learner's words; the next question is one click away and is chosen
from what the learner has not yet shown. **Max does not give the answer until the learner has typed one
attempt.** After one attempt the answer is available, logged, and moves nothing.

Ellie's answer-first Ask (#41) is unchanged and stays one click away. The attempt loop is the **hero
interaction** of the Assignment 1 prototype, the video and the report.

Three smaller corrections ride with it, each from the same evidence: feedback cites grounds
(prompt-level, §3); explanations get shorter (§4); the silence nudge fires only when the learner owes
an answer, and not before they could have read the last turn (§5).

## 1. Evidence, one line each

| Finding | Where | What it changes |
|---|---|---|
| No learner turn in R1–R5 contains an attempt; no AI turn asks for one; self-test offers declined 0/10 (R2), 0/3 (R5); both hints in R6 followed by "answer?" | findings §3.0, RQ3 | A declinable offer of a quiz is what learners decline. The Tester must be **askable and default**, not offered after a rate rule. |
| R6 after L20 ("I will attempt"): attempts 4 → 17, early answer requests 5 → 2 | RQ5 | "No answer before one attempt" is the learner's own protocol, made default. |
| R6: 11 of 21 Tester-style verdicts wrong, 9 false negatives; learner replies "ok" | RQ4 | Feedback must show its grounds so it can be checked. |
| AI words per turn 246–1,190; R2 93 AI words per typed learner word; answers not read in full | RQ5, metrics | Cap the Teacher near 120–150 words; Xu et al. ran agents at ~80. |
| Median gap before the next learner turn 3–6 min | RQ5 | A 45 s silence is reading. Nudges scale to reading time and fire only when an answer is owed. |
| "I could not track my learning progress, so I prompted it to ask questions based on my weaknesses" (form, R6) | CSV | The next question is picked by ledger level: lowest first. |
| "jargon… pitched too complicatedly", "very complicated mathematically heavy notations" (form, R2, R5) | CSV | Already fixed by the learner model and pitch (#41). Cite it. |
| R2 sent four bare slide images; R5 asked "what is I?" at a slide | RQ1 | Asking **at** the segment is observed behaviour, not a design preference. Promote in the report. |

## 2. The attempt loop, exactly

### 2.1 Entry: "+ Try this"

Every segment card carries two faint lines: **"+ Ask here"** (Ellie, unchanged) and **"+ Try this"**
(Max). "+ Try this" opens the segment's thread and Max asks **one** question.

- **Which objective.** The objectives the card teaches (`objectivesForCard` in
  `renderer/lib/objectives.ts`: a ref with the card's `segmentId`, else the card's page), lowest ledger
  level first, deck order as the tie-break. If the card teaches none, the nearest objective by page
  earlier in the deck, and failing that the nearest later one (page 1 of a deck whose first objective
  is on page 4 must still have a question); `ObjectivePick.reason` records which clause answered. If
  the tree is `pending` or `failed`, the line is disabled with the reason
  ("Ellie is still reading the deck" / "needs a live backend"). The pick is **one pure function**,
  unit-tested, and it lives where both main and renderer can call it (`src/shared/` or `src/room/`).
- **Which question.** The objective's `quizSeeds`, via the existing `quizBlock`; Max may ask a seed
  verbatim or his own on the same objective (unchanged).
- **Mechanics.** `flow:tryHere({ segmentId, objectiveId? })` → `RoomActor.tryHere({ anchorId,
  objectiveId })` → a Tester turn, `moveType: 'quiz'`, `decidedBy: 'rule:try_here'`, `challenges:
  [elementId]`, `openQuiz(...)`. The thread is tagged with the objective (`#objectiveByAnchor`), the
  page travels with it (`whereBlock`), and the request carries `meta.scriptCue = 'try:N'` where N
  counts Try-this questions in the actor's lifetime (the same pattern as `handoff:N`).
- **Latency.** The *question* uses the short band (the Teacher's, `agents.LATENCY.peer`, 4–6 s):
  the learner asked for it. The *feedback* keeps the Tester's 9–12 s: that is the considered
  judgement Tan et al. is about.

### 2.2 What the learner's next turn is

`src/room/attempt.ts`, pure, unit-tested, `classifyLearnerTurn(body): 'attempt' | 'answer_request' |
'question' | 'other'`:

- **`answer_request`** — at most 25 words and matches one of the R6 phrasings, e.g. `answer?`,
  `what's the answer`, `what is the answer`, `just tell me`, `give me the answer`, `send me the
  answer`, `show me the answer`, `solve it`, `please solve`, `how would you do it`, `how do you do
  it`, `i give up`, `skip`. The list is a constant, exported, and the tests quote R6's own lines
  (`answer?`, `please solve the question`, `what's the answer`, `send me the answer`).
- **`question`** — one sentence, at most 25 words, ending in `?`, and not an answer request. A
  clarification ("what does T mean?"), not an attempt.
- **`other`** — empty, or an agreement phrase alone ("ok", "makes sense", "got it": the phrase list
  behind ledger rule 4, `isAgreementPhrase`, without rule 4's eight-word floor).
- **`attempt`** — everything else. A two-word answer is an attempt: it may not move the ledger
  (rule 4's eight-word floor is a separate gate and is unchanged), but it lifts the answer lock.

### 2.3 The rules, in the orchestrator, checked before `rule:quiz_feedback`

All apply only while `pendingQuiz` is open and its feedback has not been given. All are code; the model
is never asked whether to answer its own question.

| Learner turn | Rule | Speaker, move | What happens |
|---|---|---|---|
| `attempt` | `rule:quiz_feedback` (existing) | Max, `quiz_feedback` | `pendingQuiz.attempts += 1`. Feedback with grounds (§3). The ledger runs on the attempt as it does on every learner turn. |
| `answer_request`, attempts = 0 | **`rule:answer_withheld`** | Max, `quiz_hint` | The directive says: the answer is not given before one attempt; give one hint that narrows it; say in one clause that one try unlocks the answer. Logged `quiz.answer_withheld`. |
| `answer_request`, attempts ≥ 1 | **`rule:answer_shown`** | Max, **`quiz_answer`** | The model answer, with grounds (§3), and what the attempt had of it. Logged `quiz.answer_shown`. The quiz closes; **the ledger is not run on this turn** and never moves on a shown answer. |
| `question` | **`rule:quiz_clarify`** | Max, **`quiz_clarify`** | Answers the clarification without answering the quiz question. Quiz stays open; not an attempt. |
| `other` | `rule:quiz_nudge` | Max, `quiz_hint` | One content-free line from the pool, or a hint. |

`PendingQuiz` gains `attempts: number` and `answerShown: boolean`; `answerQuiz()` increments only on
an `attempt`. `feedbackDue` is unchanged in meaning: it becomes true only after an `attempt`.

### 2.4 After feedback: the next question is a click

The feedback turn does **not** ask a new question (Rowland's constraint, unchanged: feedback carries
no question). The thread then shows two controls:

- **Try another** — `flow:tryHere` on the same segment; the pick in §2.1 chooses the objective with
  the lowest level, so a missed objective comes round again and a landed one gives way to the next.
  This is *"questions based on my weaknesses"* as a button.
- **Show the answer** — visible only when `attempts ≥ 1` and `answerShown` is false; calls
  `flow:showAnswer({ threadId })` → the `rule:answer_shown` turn. Before the first attempt the
  composer shows one quiet line instead: *"Max won't give the answer until you've tried once."*

The time-based hand-off (`flow-session.md` §8.2, `rule:handoff`) is **unchanged** and now secondary:
the question it produces opens the same `pendingQuiz` and obeys the same rules.

## 3. Feedback cites its grounds (prompt-level for A1)

Lucas chose the prompt-level version. `quizBlock({ feedback: true })` and the new `quiz_answer`
directive add:

> For each point you make about the answer — what landed, what was missing, the correction — say
> where the deck settles it, as `p. N: "…"` quoting the page's own words, verbatim. If the deck does
> not settle a point, say so in that clause ("the deck doesn't settle this; in general…") rather
> than stating it as if it did. Never call an answer wrong on a rule you cannot ground.

No code-side gate on the quote (A2: verify the quote against the deck text the way ledger rule 1
verifies the learner's). The renderer renders the quote as it renders any markdown; a `p. N` that
matches a card's page may be made clickable (scroll to that card), which is a nice-to-have.

**Contest never lowers a row.** Ledger rule 2 already allows a downgrade only on self-contradiction;
state it in the Tester's block: a learner who disputes a verdict is not marked down for it, and
house rule 5 (drop a contested point and say so) applies to feedback.

## 4. Shorter turns

House rule 3 becomes: a check-in is a sentence or two; teaching a concept from the ground up aims at
**about 120 words, ceiling 180**; the explanation shape (#41) is kept but each step is a sentence or
two; the learner asks for more and gets more. Tester feedback aims at **under 100 words**; a
`quiz_answer` at under 150. Prompt-level only, as #36 argued: a code-side cap re-creates the
truncation failure. Justification for the report: Xu et al. ran every agent reply near 80 words; the
sessions studied ran 246–1,190 AI words per turn and were not read in full.

## 5. Silence: only when an answer is owed, and not before it could have been read

`product-design.md` §C5's original argument returns in full: **the only silence the app fills is the
one where the learner owes an answer.**

- After a **Teacher explanation**: no nudge at any stage. `rule:silence_reexplain` and
  `offer_step_back` are retired (#46: the first reply was good enough; the re-explanation added
  little; "step back" was opaque). Silence after an explanation is reading or leaving, and both are
  the learner's.
- After a **Tester question**: stage 1 is the content-free line (unchanged); stage 2 is Max's hint
  (unchanged, `rule:silence_hint`).
- **Thresholds scale to the last agent turn.** Stage 1 fires at `clamp(2 × words / 238 wpm, 120 s,
  300 s)` of idle; stage 2 at stage 1 + 90 s. The 45 s / 90 s constants (#8) go; the keystroke pause,
  the epoch fence and the two-fires-per-round cap in `timer.ts` stay. Brysbaert 2019 for 238 wpm;
  the ×2 is a designer's margin and says so.

## 6. What the video shows, and the report's Step 2

**Hero interaction, ~6 of 10 minutes, one slide of the Critique 1 deck.** "+ Try this" → Max's
question → the learner's attempt (typed live) → grounded feedback with a `p. N` quote → the ledger
moves on the learner's words → "Try another" → a second question on the objective still at ○ →
a second attempt → feedback → "Show the answer" now available; the presenter says why it was not
before. Ellie's "+ Ask here" appears once, as the explain path, when the second question needs a
prerequisite. Document machinery (ticks, split, Original pages) gets one 40 s beat. Whisper gets one
sentence.

**One important design decision** (video, report): *the answer is withheld until one attempt, and it
is a rule in the orchestrator, not a prompt.* **One limitation:** feedback grounds are asked for, not
verified; the SQL session shows why verification is A2's first job.

**Step 2, restated.** Learning goal: *the learner can answer a question about a concept on their own
slide in their own words, and revise the answer after feedback.* Progress: the objective tree's levels
○ ◐ ●, moved only by the learner's verbatim words. Learner: attempts, revises, challenges, decides
when to see the answer. CUI: asks first, withholds the answer until one attempt, cites the slide in
feedback, picks the next question from the lowest level, explains on request. Design goals: DG1
attempt-first (retrieval practice with feedback, Rowland 2014; R6), DG2 checkable feedback (trust
calibration, Lee & See 2004; R6's 11/21), DG3 sized replies and reading-time pacing (Xu et al.;
Brysbaert; R2's 93:1), DG4 the learner authors the document and asks at the segment (Joshi & Vogel;
R2's bare images), DG5 progress by objective (R6's form response).

## 7. What this supersedes

| Older text | Status |
|---|---|
| `flow-session.md` §8.2 "The hand-off is an offer" as the Tester's **only** door | Superseded as the only door; the rule itself is unchanged and stays as the secondary path. |
| `product-design.md` §C5 silence stages 45 s / 90 s; `design-brief.md` §D3; issue #8 | Superseded by §5. |
| `orchestrator.ts` `silenceDecision` case (a), `rule:silence_reexplain`, `offer_step_back` (#37) | Retired. |
| House rule 3's 200 / 250 words | Superseded by §4. |
| `flow-build-plan.md` §2 storyboard, `docs/report/video-storyboard.md` | Superseded by §6; re-cut. |
| `docs/report/assignment1-draft.md` Step 1 "uncritical use" | Superseded: reduced persistence, with the transcript study as the observed evidence. |
| `pivot-spec.md` §B1 entry card | Already superseded by `conversation-refinement.md`; unchanged here. |

## 8. Out of scope for A1, and said so

Verifying feedback quotes against the deck in code; a "Challenge this" control (house rule 5 covers
the behaviour; the control is A2); the summary card's slide-like rendering (#44, kept as a review
artefact, demoted from the video); adaptive difficulty beyond level-ordered picking; spaced review.
